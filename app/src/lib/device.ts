import SparkMD5 from 'spark-md5'
import { emptyManifest, MANIFEST_FILES, parseManifest, serializeManifest, type FileDigest, type Manifest } from './manifest'
import { parseName, type ParsedName } from './filenames'
import { readMapsforgeHeader, type MapsforgeHeader } from './mapsforge'

export type Folder = 'Maps' | 'Router'
export const FOLDERS: Folder[] = ['Maps', 'Router']
const EXT: Record<Folder, string> = { Maps: '.map', Router: '.rtd' }

export interface DeviceFile extends ParsedName {
  folder: Folder
  name: string
  size: number
  lastModified: number
  /** Mapsforge header (Maps folder only). */
  header?: MapsforgeHeader
}

export interface BBox { minLat: number; minLon: number; maxLat: number; maxLon: number }

export interface Region {
  country: string
  files: DeviceFile[]
  size: number
  /** Newest OSM date among dated map files. */
  date?: string
  /** Union of the coverage of its map files (from Mapsforge headers). */
  bbox?: BBox
}

export interface Device {
  root: FileSystemDirectoryHandle
  igpsport: FileSystemDirectoryHandle
  dirs: Record<Folder, FileSystemDirectoryHandle>
  model?: string
  firmware?: string
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Accepts the drive root (BINAVI), the iGPSPORT folder, or its Maps folder. */
export async function connect(): Promise<Device> {
  const picked = await window.showDirectoryPicker({ id: 'binavi', mode: 'readwrite' })
  return openDevice(picked)
}

export async function openDevice(picked: FileSystemDirectoryHandle): Promise<Device> {
  const perm = await picked.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') throw new Error('Write permission was not granted.')
  let igpsport: FileSystemDirectoryHandle
  if (picked.name === 'iGPSPORT') igpsport = picked
  else {
    try { igpsport = await picked.getDirectoryHandle('iGPSPORT') }
    catch { throw new Error(`"${picked.name}" has no iGPSPORT folder. Select the GPS drive (e.g. BINAVI).`) }
  }
  const dirs = {
    Maps: await igpsport.getDirectoryHandle('Maps', { create: true }),
    Router: await igpsport.getDirectoryHandle('Router', { create: true }),
  }
  const device: Device = { root: picked, igpsport, dirs }
  if (picked !== igpsport) {
    // macOS Spotlight indexes removable drives and reads every new file. Over the BiNavi's USB 1.1 link
    // that starves our writes and can hang the FAT driver. This empty marker tells Spotlight to skip the drive.
    await picked.getFileHandle('.metadata_never_index', { create: true }).catch(() => {})
    try {
      const txt = await (await (await picked.getFileHandle('Device.bin')).getFile()).text()
      device.model = txt.match(/#PRO,([^,\r\n]+)/)?.[1]
      device.firmware = txt.match(/#AW,([^\r\n]+)/)?.[1]
    } catch { /* optional */ }
  }
  return device
}

export async function listFiles(device: Device): Promise<DeviceFile[]> {
  const out: DeviceFile[] = []
  for (const folder of FOLDERS) {
    for await (const [name, h] of device.dirs[folder].entries()) {
      if (h.kind !== 'file' || name.startsWith('._') || !name.toLowerCase().endsWith(EXT[folder])) continue
      const f = await (h as FileSystemFileHandle).getFile()
      const header = folder === 'Maps' ? await readMapsforgeHeader(f).catch(() => undefined) : undefined
      out.push({ ...parseName(name), folder, name, size: f.size, lastModified: f.lastModified, header })
    }
  }
  return out
}

export function groupRegions(files: DeviceFile[]): Region[] {
  const by = new Map<string, Region>()
  for (const f of files) {
    const r = by.get(f.country) ?? { country: f.country, files: [], size: 0 }
    r.files.push(f)
    r.size += f.size
    if (f.date && (!r.date || f.date > r.date)) r.date = f.date
    const b = f.kind !== 'contour' ? f.header?.bbox : undefined
    if (b) r.bbox = r.bbox ? {
      minLat: Math.min(r.bbox.minLat, b.minLat), minLon: Math.min(r.bbox.minLon, b.minLon),
      maxLat: Math.max(r.bbox.maxLat, b.maxLat), maxLon: Math.max(r.bbox.maxLon, b.maxLon),
    } : { ...b }
    by.set(f.country, r)
  }
  return [...by.values()].sort((a, b) => a.country.localeCompare(b.country))
}

// ---------- manifests ----------

export type Manifests = Record<keyof typeof MANIFEST_FILES, Manifest>

export async function readManifests(dir: FileSystemDirectoryHandle): Promise<Manifests> {
  const read = async (name: string, withHeader: boolean) => {
    try { return parseManifest(await (await (await dir.getFileHandle(name)).getFile()).text()) }
    catch { return emptyManifest(withHeader) }
  }
  return {
    size: await read(MANIFEST_FILES.size, true),
    md5: await read(MANIFEST_FILES.md5, false),
    checksum: await read(MANIFEST_FILES.checksum, false),
  }
}

export async function writeManifests(dir: FileSystemDirectoryHandle, m: Manifests): Promise<void> {
  for (const key of Object.keys(MANIFEST_FILES) as (keyof Manifests)[]) {
    await writeText(dir, MANIFEST_FILES[key], serializeManifest(m[key]))
  }
}

export function setEntry(m: Manifests, stem: string, d: FileDigest) {
  m.size.entries.set(stem, String(d.size))
  m.md5.entries.set(stem, d.md5)
  m.checksum.entries.set(stem, String(d.checksum))
}

export function deleteEntry(m: Manifests, stem: string) {
  m.size.entries.delete(stem)
  m.md5.entries.delete(stem)
  m.checksum.entries.delete(stem)
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(text)
  await w.close()
}

// ---------- hashing / streaming ----------

export class Digester {
  private md5 = new SparkMD5.ArrayBuffer()
  size = 0
  checksum = 0
  update(chunk: Uint8Array) {
    let s = 0
    for (let i = 0; i < chunk.length; i++) s += chunk[i]
    this.checksum += s
    this.size += chunk.length
    this.md5.append(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
  }
  digest(): FileDigest {
    return { size: this.size, checksum: this.checksum, md5: this.md5.end() }
  }
}

/** Stream `source` into `dir/name`, returning its integrity values. Writes to a temp name first. */
/**
 * Stream `source` into `dir/name` and return its integrity values.
 * Chrome's createWritable() already writes to a hidden swap file (<name>.crswap) and only replaces the
 * target on close(), so no temp-file + rename is needed — rename (move()) is not allowed on USB drives.
 */
export async function writeStream(
  dir: FileSystemDirectoryHandle,
  name: string,
  source: ReadableStream<Uint8Array>,
  onProgress?: (bytes: number) => void,
  onFinishing?: () => void,
): Promise<FileDigest> {
  const existed = await dir.getFileHandle(name).then(() => true, () => false)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  const d = new Digester()
  try {
    await source
      .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) { d.update(chunk); onProgress?.(d.size); ctl.enqueue(chunk) },
        flush() { onFinishing?.() }, // all data sent; the browser now moves its swap file into place
      }))
      .pipeTo(writable) // closes the writable on success, aborts it on error
  } catch (e) {
    if (!existed) await dir.removeEntry(name).catch(() => {})
    throw new Error(`Writing ${name} failed: ${(e as Error)?.message ?? e}`)
  }
  const digest = d.digest()
  const onDisk = (await handle.getFile()).size
  if (onDisk !== digest.size) {
    if (!existed) await dir.removeEntry(name).catch(() => {})
    throw new Error(`${name} is incomplete on the GPS (${onDisk} of ${digest.size} bytes). The USB connection may have dropped.`)
  }
  return digest
}

/** Removes leftovers of interrupted writes: our old "*.part" files, Chrome "*.crswap" swap files, macOS "._*" files. */
export async function removeLeftovers(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const junk: string[] = []
  const sizes = await readManifests(dir).then(m => m.size.entries, () => new Map<string, string>())
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file') continue
    if (name.startsWith('._') || /\.(part|crswap)$/i.test(name)) { junk.push(name); continue }
    // An empty map/routing file that the manifests don't list = placeholder left by an interrupted write.
    if (/\.(map|rtd)$/i.test(name) && !sizes.has(parseName(name).stem)) {
      if ((await (h as FileSystemFileHandle).getFile()).size === 0) junk.push(name)
    }
  }
  for (const n of junk) await dir.removeEntry(n).catch(() => {})
  return junk
}

/** Compute digest of an existing device file (to verify / rebuild manifests). */
export async function digestFile(dir: FileSystemDirectoryHandle, name: string, onProgress?: (b: number) => void): Promise<FileDigest> {
  const d = new Digester()
  const reader = (await (await dir.getFileHandle(name)).getFile()).stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    d.update(value)
    onProgress?.(d.size)
  }
  return d.digest()
}

/** Copies a file chunk by chunk and verifies the size afterwards. Removes the partial copy on failure. */
export async function copyFile(
  from: FileSystemDirectoryHandle, name: string, to: FileSystemDirectoryHandle, onProgress?: (bytes: number) => void,
) {
  const src = await (await from.getFileHandle(name)).getFile()
  const handle = await to.getFileHandle(name, { create: true })
  const w = await handle.createWritable()
  const CHUNK = 8 * 1024 * 1024
  try {
    for (let pos = 0; pos < src.size; pos += CHUNK) {
      await w.write(new Uint8Array(await src.slice(pos, pos + CHUNK).arrayBuffer()))
      onProgress?.(Math.min(pos + CHUNK, src.size))
    }
    await w.close()
  } catch (e) {
    await w.abort().catch(() => {})
    await to.removeEntry(name).catch(() => {})
    throw new Error(`Copy of ${name} failed: ${(e as Error)?.message ?? e}`)
  }
  const copied = (await handle.getFile()).size
  if (copied !== src.size) {
    await to.removeEntry(name).catch(() => {})
    throw new Error(`Copy of ${name} is incomplete (${copied} of ${src.size} bytes).`)
  }
}

/** macOS writes hidden "._name" AppleDouble files on FAT drives. The GPS could mistake "._X.map" for a map. */
export async function removeAppleDouble(dir: FileSystemDirectoryHandle): Promise<number> {
  const junk: string[] = []
  for await (const [name, h] of dir.entries()) if (h.kind === 'file' && name.startsWith('._')) junk.push(name)
  for (const n of junk) await dir.removeEntry(n).catch(() => {})
  return junk.length
}

/** True if `dir` is the device itself or any folder inside it. */
export async function isOnDevice(device: Device, dir: FileSystemDirectoryHandle): Promise<boolean> {
  if (await device.root.isSameEntry(dir)) return true
  if ((await device.root.resolve(dir)) !== null) return true
  // Different handle trees (picked separately) don't resolve; compare by looking for the device marker files.
  for (const marker of ['iGPSPORT', 'Device.bin']) {
    try { await dir.getDirectoryHandle(marker); return true } catch { /* not a dir */ }
    try { await dir.getFileHandle(marker); return true } catch { /* not a file */ }
  }
  return false
}

// ---------- storage usage ----------

/** Known drive capacities in bytes. Browsers cannot query free space, so we estimate. */
export const KNOWN_CAPACITY: Record<string, number> = {
  BiNavi: 29_987_586_560, // FAT32, as reported by macOS diskutil
}
/** FAT32 allocation unit observed on the BiNavi; files occupy whole clusters. */
const CLUSTER = 32_768
const onDisk = (n: number) => Math.ceil(n / CLUSTER) * CLUSTER

export interface Usage { maps: number; router: number; other: number; used: number }

/** Walks the whole drive and sums file sizes (rounded up to the cluster size). */
export async function scanUsage(device: Device): Promise<Usage> {
  const u: Usage = { maps: 0, router: 0, other: 0, used: 0 }
  const walk = async (dir: FileSystemDirectoryHandle, bucket?: 'maps' | 'router') => {
    let it
    try { it = dir.entries() } catch { return }
    try {
      for await (const [name, h] of it) {
        if (h.kind === 'directory') {
          const b = bucket ?? (dir === device.igpsport ? (name === 'Maps' ? 'maps' : name === 'Router' ? 'router' : undefined) : undefined)
          await walk(h as FileSystemDirectoryHandle, b)
        } else {
          try {
            const size = onDisk((await (h as FileSystemFileHandle).getFile()).size)
            u[bucket ?? 'other'] += size
            u.used += size
          } catch { /* protected system file */ }
        }
      }
    } catch { /* unreadable folder, e.g. .Spotlight-V100 */ }
  }
  await walk(device.root)
  return u
}
