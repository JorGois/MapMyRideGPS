/**
 * Finds MapMyRideGPS backups in a folder the user picks. A backup is a folder containing Maps/ and/or Router/
 * with .map / .rtd files (as written by ops.backup). The user may pick the backup itself or its parent.
 */
import { parseName } from './filenames'

export interface BackupFile { folder: 'Maps' | 'Router'; name: string; size: number; date?: string; country: string; file: () => Promise<File> }

export interface BackupSet {
  name: string
  /** ISO date-time parsed from "MapMyRideGPS-backup-YYYYMMDD-HHMMSS" when present. */
  when?: string
  files: BackupFile[]
  size: number
  countries: string[]
}

const STAMP = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/

async function readSet(dir: FileSystemDirectoryHandle): Promise<BackupSet | undefined> {
  const files: BackupFile[] = []
  for (const folder of ['Maps', 'Router'] as const) {
    let sub: FileSystemDirectoryHandle
    try { sub = await dir.getDirectoryHandle(folder) } catch { continue }
    for await (const [name, h] of sub.entries()) {
      if (h.kind !== 'file' || name.startsWith('._')) continue
      if (!(folder === 'Maps' ? /\.map$/i : /\.rtd$/i).test(name)) continue
      const fh = h as FileSystemFileHandle
      const f = await fh.getFile()
      if (!f.size) continue // e.g. an empty file left by a failed backup
      const p = parseName(name)
      files.push({ folder, name, size: f.size, date: p.date, country: p.country, file: () => fh.getFile() })
    }
  }
  if (!files.length) return undefined
  const m = dir.name.match(STAMP)
  return {
    name: dir.name,
    when: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : undefined,
    files: files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)),
    size: files.reduce((s, f) => s + f.size, 0),
    countries: [...new Set(files.map(f => f.country))].sort(),
  }
}

/** Returns the backup(s) in `root`: root itself if it is a backup, otherwise its backup sub-folders, newest first. */
export async function findBackups(root: FileSystemDirectoryHandle): Promise<BackupSet[]> {
  const self = await readSet(root)
  if (self) return [self]
  const out: BackupSet[] = []
  for await (const [, h] of root.entries()) {
    if (h.kind !== 'directory') continue
    const set = await readSet(h as FileSystemDirectoryHandle)
    if (set) out.push(set)
  }
  return out.sort((a, b) => (b.when ?? b.name).localeCompare(a.when ?? a.name))
}

/** The selected files as File objects, named so the installer puts them back in the right folder. */
export async function backupFiles(set: BackupSet, pick?: (f: BackupFile) => boolean): Promise<File[]> {
  return Promise.all(set.files.filter(f => !pick || pick(f)).map(f => f.file()))
}
