/**
 * Reads the header of a Mapsforge binary map file (spec v3–v5).
 * Only the first few hundred bytes are read, so it's cheap even for 700 MB files.
 */
export interface MapsforgeHeader {
  version: number
  /** High bit of the version field. Set on maps preloaded on the BiNavi (0x80000003); plain v3 maps don't have it. */
  vendorFlag: boolean
  fileSize: number
  /** When the map was generated (ISO date). */
  mapDate: string
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }
  projection: string
  language?: string
  comment?: string
  createdBy?: string
  startPosition?: { lat: number; lon: number }
  tags?: { poi: number; way: number }
}

const MAGIC = 'mapsforge binary OSM'

export async function readMapsforgeHeader(file: Blob): Promise<MapsforgeHeader | undefined> {
  const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (new TextDecoder().decode(buf.subarray(0, 20)) !== MAGIC) return undefined
  return parseHeader(buf)
}

export function parseHeader(buf: Uint8Array): MapsforgeHeader {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 20 + 4 // magic + header size
  const rawVersion = dv.getUint32(p); p += 4
  const version = rawVersion & 0x7fffffff
  const vendorFlag = (rawVersion & 0x80000000) !== 0
  const fileSize = Number(dv.getBigUint64(p)); p += 8
  const mapDate = new Date(Number(dv.getBigUint64(p))).toISOString().slice(0, 10); p += 8
  const micro = () => { const v = dv.getInt32(p) / 1e6; p += 4; return v }
  const bbox = { minLat: micro(), minLon: micro(), maxLat: micro(), maxLon: micro() }
  p += 2 // tile size
  const vbe = () => {
    let v = 0, shift = 0
    for (;;) { const b = buf[p++]; v |= (b & 0x7f) << shift; if (!(b & 0x80)) return v; shift += 7 }
  }
  const str = () => { const n = vbe(); const s = new TextDecoder().decode(buf.subarray(p, p + n)); p += n; return s }
  const projection = str()
  const flags = buf[p++]
  const h: MapsforgeHeader = { version, vendorFlag, fileSize, mapDate, bbox, projection }
  if (flags & 0x40) h.startPosition = { lat: micro(), lon: micro() }
  if (flags & 0x20) p += 1
  if (flags & 0x10) h.language = str()
  if (flags & 0x08) h.comment = str()
  if (flags & 0x04) h.createdBy = str()
  try {
    const poi = dv.getUint16(p); p += 2
    for (let i = 0; i < poi; i++) str()
    const way = dv.getUint16(p)
    h.tags = { poi, way }
  } catch { /* tag list longer than the 4 KB we read */ }
  return h
}
