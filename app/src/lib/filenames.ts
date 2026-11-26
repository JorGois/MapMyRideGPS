/**
 * iGPSPORT map file naming.
 *  - Dated layer:  CC + PPPP (product) + YYMMDD (OSM data date) + 12-char base36 tile bbox, e.g. PT00002412212M02C80FW07V
 *      PPPP "0000" = whole-country base map, "00A0" = extra layer, "0100".."1900" = sub-regions (e.g. Spain).
 *  - Contours:     CC + PPPP + "C", e.g. PT0000C
 *  - Router:       CC + PPPP + one of E/N/R/S/W, e.g. PT0000N (.rtd)
 */
export type MapKind = 'base' | 'layer' | 'region' | 'contour' | 'router' | 'unknown'

export interface ParsedName {
  stem: string
  country: string
  product: string
  kind: MapKind
  /** ISO date (YYYY-MM-DD) of the OSM data, when encoded in the name. */
  date?: string
  /** Key that identifies "the same slot": a newer file with this key replaces the older one. */
  slot: string
}

const DATED = /^([A-Z]{2})([0-9A-Z]{4})(\d{6})([0-9A-Z]{12})$/
const CONTOUR = /^([A-Z]{2})([0-9A-Z]{4})C$/
const ROUTER = /^([A-Z]{2})([0-9A-Z]{4})([ENRSW])$/

export function stemOf(filename: string): string {
  const base = filename.split('/').pop() ?? filename
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function parseName(filename: string): ParsedName {
  const stem = stemOf(filename)
  const isRtd = /\.rtd$/i.test(filename)
  let m = stem.match(DATED)
  if (m && !isRtd) {
    const [, country, product, d] = m
    const kind: MapKind = product === '0000' ? 'base' : product === '00A0' ? 'layer' : 'region'
    return { stem, country, product, kind, date: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`, slot: `${country}${product}` }
  }
  if ((m = stem.match(ROUTER)) && isRtd) {
    return { stem, country: m[1], product: m[2], kind: 'router', slot: stem }
  }
  if ((m = stem.match(CONTOUR))) {
    return { stem, country: m[1], product: m[2], kind: 'contour', slot: stem }
  }
  return { stem, country: stem.slice(0, 2).toUpperCase(), product: '', kind: 'unknown', slot: stem }
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : undefined

export function countryName(code: string): string {
  try {
    const n = regionNames?.of(code)
    if (n && n !== code) return n
  } catch { /* non-ISO codes like XC, GC */ }
  return code
}

/** Normalise catalog versions ("20260420", "2611") to a sortable number. */
export function versionRank(v: string | undefined): number {
  if (!v) return 0
  const digits = v.replace(/\D/g, '')
  if (digits.length === 8) return Number(digits)
  if (digits.length === 6) return Number('20' + digits)
  if (digits.length === 4) return Number('20' + digits + '01') // YYMM
  return Number(digits) || 0
}

export function rankToIso(rank: number): string | undefined {
  const s = String(rank)
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined
}
