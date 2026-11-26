/**
 * iGPSPORT manifest files (map_size_list.cfg, map_md5_list.cfg, map_checksum_list.txt).
 * Format: CRLF-separated `KEY:value` lines. Optional header keys MAP_NUM / MAP_VER.
 * Entry keys are file stems (filename without extension). Order is preserved.
 */
export const HEADER_KEYS = ['MAP_NUM', 'MAP_VER'] as const

export interface Manifest {
  header: Map<string, string>
  entries: Map<string, string>
  eol: string
}

export function parseManifest(text: string): Manifest {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const header = new Map<string, string>()
  const entries = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i)
    const value = line.slice(i + 1)
    if ((HEADER_KEYS as readonly string[]).includes(key)) header.set(key, value)
    else entries.set(key, value)
  }
  return { header, entries, eol }
}

export function serializeManifest(m: Manifest): string {
  const lines: string[] = []
  for (const k of HEADER_KEYS) {
    if (!m.header.has(k)) continue
    lines.push(`${k}:${k === 'MAP_NUM' ? m.entries.size : m.header.get(k)}`)
  }
  for (const [k, v] of m.entries) lines.push(`${k}:${v}`)
  return lines.join(m.eol) + m.eol
}

export function emptyManifest(withHeader: boolean): Manifest {
  const header = new Map<string, string>()
  if (withHeader) {
    header.set('MAP_NUM', '0')
    header.set('MAP_VER', '101')
  }
  return { header, entries: new Map(), eol: '\r\n' }
}

/** Integrity values the device keeps per file. */
export interface FileDigest {
  size: number
  /** Unsigned sum of every byte in the file. */
  checksum: number
  md5: string
}

export const MANIFEST_FILES = {
  size: 'map_size_list.cfg',
  md5: 'map_md5_list.cfg',
  checksum: 'map_checksum_list.txt',
} as const
