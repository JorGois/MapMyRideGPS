import { BlobReader, ZipReader, type Entry } from '@zip.js/zip.js'
import { parseName, type ParsedName } from './filenames'
import { parseHeader, type MapsforgeHeader } from './mapsforge'
import {
  copyFile, deleteEntry, removeAppleDouble, removeLeftovers, digestFile, FOLDERS, listFiles, readManifests, setEntry, writeManifests, writeStream,
  type Device, type DeviceFile, type Folder, type Manifests,
} from './device'
import { MANIFEST_FILES } from './manifest'

export type Log = (msg: string) => void
export type Progress = (label: string, done: number, total: number) => void

/** A file that will be written to the device. */
export interface Incoming extends ParsedName {
  folder: Folder
  name: string
  size: number
  open: () => Promise<ReadableStream<Uint8Array>>
  header?: MapsforgeHeader
}

/** Reads the first 4 KB of a stream and cancels the rest. */
async function peekHeader(stream: ReadableStream<Uint8Array>): Promise<MapsforgeHeader | undefined> {
  const reader = stream.getReader()
  const buf = new Uint8Array(4096)
  let n = 0
  try {
    while (n < buf.length) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, buf.length - n)
      buf.set(value.subarray(0, take), n)
      n += take
    }
  } finally { reader.cancel().catch(() => {}) }
  const b = buf.subarray(0, n)
  return new TextDecoder().decode(b.subarray(0, 20)) === 'mapsforge binary OSM' ? (() => { try { return parseHeader(b) } catch { return undefined } })() : undefined
}

/** Stable id of a file on the GPS, e.g. "Maps/PT00000000.map". */
export const fileKey = (f: { folder: Folder; name: string }) => `${f.folder}/${f.name}`

export interface InstallPlan {
  incoming: Incoming[]
  /** Existing device files that will be overwritten or replaced by a newer file in the same slot. */
  replaced: DeviceFile[]
  warnings: string[]
  close: () => Promise<void>
}

const folderFor = (name: string): Folder | undefined =>
  /\.map$/i.test(name) ? 'Maps' : /\.rtd$/i.test(name) ? 'Router' : undefined

/** Accepts official ZIP packages and/or loose .map/.rtd files. */
export async function readPackages(inputs: File[]): Promise<{ incoming: Incoming[]; close: () => Promise<void> }> {
  const incoming: Incoming[] = []
  const readers: ZipReader<unknown>[] = []
  for (const file of inputs) {
    if (/\.zip$/i.test(file.name)) {
      const zr = new ZipReader(new BlobReader(file))
      readers.push(zr)
      const entries: Entry[] = await zr.getEntries()
      for (const e of entries) {
        const base = e.filename.split('/').pop()!
        const folder = folderFor(base)
        if (e.directory || !folder || base.startsWith('._')) continue
        incoming.push({
          ...parseName(base), folder, name: base, size: e.uncompressedSize,
          open: async () => {
            const ts = new TransformStream<Uint8Array, Uint8Array>()
            void e.getData!(ts.writable)
            return ts.readable
          },
        })
      }
    } else {
      const folder = folderFor(file.name)
      if (!folder) throw new Error(`Unsupported file: ${file.name} (expected .zip, .map or .rtd)`)
      incoming.push({ ...parseName(file.name), folder, name: file.name, size: file.size, open: async () => file.stream() })
    }
  }
  return { incoming, close: async () => { await Promise.all(readers.map(r => r.close())) } }
}

export async function planInstall(device: Device, inputs: File[], opts: { restore?: boolean } = {}): Promise<InstallPlan> {
  const { incoming, close } = await readPackages(inputs)
  const existing = await listFiles(device)
  const warnings: string[] = []
  for (const i of incoming) if (i.folder === 'Maps') i.header = await peekHeader(await i.open()).catch(() => undefined)
  if (!incoming.length) warnings.push('No .map or .rtd files found in the selection.')
  const replaced = existing.filter(f => incoming.some(i => i.folder === f.folder && (i.name === f.name || i.slot === f.slot)))
  for (const i of incoming) {
    const old = existing.find(f => f.folder === i.folder && f.slot === i.slot && f.name !== i.name)
    if (!opts.restore && old?.date && i.date && i.date < old.date) warnings.push(`${i.name} (${i.date}) is OLDER than installed ${old.name} (${old.date}).`)
    if (i.kind === 'region' && existing.some(f => f.country === i.country && f.kind === 'base')) {
      warnings.push(`${i.name} is a sub-region map but a whole-country ${i.country} base map is installed; they overlap. Consider removing one.`)
    }
    const same = existing.find(f => f.folder === 'Maps' && f.country === i.country && f.header)
    if (i.folder === 'Maps' && i.header && same?.header && same.header.vendorFlag !== i.header.vendorFlag) {
      warnings.push(`${i.name}: Mapsforge format differs from the maps on your GPS (${i.header.vendorFlag ? 'vendor-flagged' : 'plain'} v${i.header.version} vs ${same.header.vendorFlag ? 'vendor-flagged' : 'plain'} v${same.header.version}). The device may not display it — test it, the backup lets you roll back.`)
    }
    if (i.kind === 'unknown') warnings.push(`${i.name}: unrecognised name; it will be copied but the device may ignore it.`)
  }
  const countries = new Set(incoming.map(i => i.country))
  for (const c of countries) {
    const kinds = new Set(incoming.filter(i => i.country === c).map(i => i.kind))
    const hasLayer = existing.some(f => f.country === c && f.kind === 'layer')
    if (kinds.has('base') && !kinds.has('layer') && hasLayer) {
      warnings.push(`${c}: package updates the base map only; the installed extra layer (00A0), contours and routing stay at their old version.`)
    }
  }
  return { incoming, replaced, warnings: [...new Set(warnings)], close }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/** Copy files + manifests into `<backupRoot>/MapMyRideGPS-backup-<stamp>/<Folder>/`. */
export async function backup(device: Device, files: DeviceFile[], backupRoot: FileSystemDirectoryHandle, log: Log, progress: Progress) {
  const dir = await backupRoot.getDirectoryHandle(`MapMyRideGPS-backup-${stamp()}`, { create: true })
  const total = files.reduce((s, f) => s + f.size, 0)
  let done = 0
  for (const folder of FOLDERS) {
    const sub = await dir.getDirectoryHandle(folder, { create: true })
    for (const name of Object.values(MANIFEST_FILES)) {
      try { await device.dirs[folder].getFileHandle(name) } catch { continue } // manifest absent
      await copyFile(device.dirs[folder], name, sub)
    }
    for (const f of files.filter(f => f.folder === folder)) {
      log(`Backing up ${folder}/${f.name} (${(f.size / 1e6).toFixed(1)} MB)`)
      await copyFile(device.dirs[folder], f.name, sub, b => progress('Backup', done + b, total))
      done += f.size
    }
  }
  log(`Backup verified and saved to ${backupRoot.name}/${dir.name}`)
}

/** `onFile` reports each file as it starts ('writing') and once it is written and listed in the manifests ('done'). */
export async function install(device: Device, plan: InstallPlan, log: Log, progress: Progress,
  onFile?: (inc: Incoming, state: 'writing' | 'done') => void) {
  const manifests: Record<Folder, Manifests> = {
    Maps: await readManifests(device.dirs.Maps),
    Router: await readManifests(device.dirs.Router),
  }
  for (const folder of FOLDERS) {
    const junk = await removeLeftovers(device.dirs[folder])
    if (junk.length) log(`Removed ${junk.length} leftover file(s) from an interrupted write in ${folder}.`)
  }
  const total = plan.incoming.reduce((s, f) => s + f.size, 0)
  let base = 0
  try {
    for (const inc of plan.incoming) {
      const dir = device.dirs[inc.folder]
      log(`Writing ${inc.folder}/${inc.name}`)
      onFile?.(inc, 'writing')
      const digest = await writeStream(dir, inc.name, await inc.open(), b => progress('Install', base + b, total),
        () => progress(`Finishing ${inc.name}`, base + inc.size, total))
      base += inc.size
      for (const old of plan.replaced.filter(o => o.folder === inc.folder && o.slot === inc.slot && o.name !== inc.name)) {
        log(`Removing old ${old.folder}/${old.name}`)
        await dir.removeEntry(old.name).catch(() => {})
        deleteEntry(manifests[inc.folder], old.stem)
      }
      setEntry(manifests[inc.folder], inc.stem, digest)
      await writeManifests(dir, manifests[inc.folder])
      onFile?.(inc, 'done')
    }
  } finally {
    await plan.close()
  }
  let junk = 0
  for (const folder of FOLDERS) junk += await removeAppleDouble(device.dirs[folder])
  if (junk) log(`Removed ${junk} hidden macOS "._" file(s) from the GPS.`)
  log('Install complete. Eject the drive safely and restart the GPS.')
}

export async function removeFiles(device: Device, files: DeviceFile[], log: Log) {
  for (const folder of FOLDERS) {
    const sel = files.filter(f => f.folder === folder)
    if (!sel.length) continue
    const m = await readManifests(device.dirs[folder])
    for (const f of sel) {
      log(`Deleting ${folder}/${f.name}`)
      await device.dirs[folder].removeEntry(f.name)
      deleteEntry(m, f.stem)
    }
    await writeManifests(device.dirs[folder], m)
  }
  log('Removal complete.')
}

export interface HealthIssue {
  folder: Folder
  stem: string
  problem: 'missing-entry' | 'orphan-entry' | 'size-mismatch'
  detail: string
}

/** Fast check: compares manifests with what's on disk (sizes only). */
export async function checkHealth(device: Device): Promise<HealthIssue[]> {
  const files = await listFiles(device)
  const issues: HealthIssue[] = []
  for (const folder of FOLDERS) {
    const m = await readManifests(device.dirs[folder])
    const onDisk = new Map(files.filter(f => f.folder === folder).map(f => [f.stem, f]))
    for (const [stem, f] of onDisk) {
      const s = m.size.entries.get(stem)
      if (s === undefined || !m.checksum.entries.has(stem) || !m.md5.entries.has(stem)) {
        issues.push({ folder, stem, problem: 'missing-entry', detail: `${f.name} is not listed in every manifest` })
      } else if (Number(s) !== f.size) {
        issues.push({ folder, stem, problem: 'size-mismatch', detail: `manifest says ${s} bytes, file is ${f.size}` })
      }
    }
    for (const stem of new Set([...m.size.entries.keys(), ...m.md5.entries.keys(), ...m.checksum.entries.keys()])) {
      if (!onDisk.has(stem)) issues.push({ folder, stem, problem: 'orphan-entry', detail: 'listed in manifest but file not found' })
    }
  }
  return issues
}

export async function repairHealth(device: Device, issues: HealthIssue[], log: Log, progress: Progress) {
  for (const folder of FOLDERS) {
    const mine = issues.filter(i => i.folder === folder)
    if (!mine.length) continue
    const m = await readManifests(device.dirs[folder])
    const ext = folder === 'Maps' ? '.map' : '.rtd'
    for (const i of mine) {
      if (i.problem === 'orphan-entry') { deleteEntry(m, i.stem); log(`Removed stale entry ${folder}/${i.stem}`); continue }
      log(`Hashing ${folder}/${i.stem}${ext}`)
      const d = await digestFile(device.dirs[folder], i.stem + ext, b => progress('Hashing', b, 0))
      setEntry(m, i.stem, d)
    }
    await writeManifests(device.dirs[folder], m)
  }
  log('Manifests repaired.')
}
