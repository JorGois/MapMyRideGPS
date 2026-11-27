import { versionRank } from './filenames'

/**
 * Official iGPSPORT map catalogs. The API sends CORS headers so the browser can read it,
 * but the ZIP storage (Aliyun OSS) does not — downloads go through a proxy (see download.ts)
 * or are done manually by the user.
 */
export const API_BASE = 'https://prod.en.igpsport.com/service'

export interface CatalogSource {
  id: string
  label: string
  /** iGPSPORT catalog id (query param `mapVersionId`). */
  mapVersionId: string
  note?: string
  enabled: boolean
  builtin?: boolean
  /** Device models this catalog is made for (from Device.bin "#PRO,<model>"). */
  models?: string[]
}

/**
 * Works out which device family is connected: from Device.bin ("#PRO,<model>"), or — when only the
 * iGPSPORT folder was picked — from the installed maps (vendor-flagged Mapsforge v3 = BiNavi format).
 */
export function detectModel(model: string | undefined, mapHeaders: { vendorFlag: boolean }[]): { model?: string; how: 'device' | 'maps' | 'unknown' } {
  if (model) return { model, how: 'device' }
  if (mapHeaders.some(h => h.vendorFlag)) return { model: 'BiNavi', how: 'maps' }
  return { how: 'unknown' }
}

export const isCompatible = (s: CatalogSource, model?: string) => !s.builtin || !model || !s.models || s.models.includes(model)

/** Turns on the built-in catalogs made for this model and turns the others off. Custom sources are left as they are. */
export function sourcesForModel(sources: CatalogSource[], model?: string): CatalogSource[] {
  if (!model || !sources.some(s => s.models?.includes(model))) return sources
  return sources.map(s => s.builtin ? { ...s, enabled: !!s.models?.includes(model) } : s)
}

export const BUILTIN_SOURCES: CatalogSource[] = [
  {
    id: 'igpsport-v3',
    label: 'iGPSPORT official · BiNavi (Mapinfo V3)',
    mapVersionId: 'a959751a-21b5-44a3-b713-bc12ebb208ef',
    note: 'Catalog for BiNavi / BiNavi Air: full packages (base map, extra layer, contours and routing) in the device format. Recommended for BiNavi.',
    enabled: true,
    builtin: true,
    models: ['BiNavi', 'BiNavi Air'],
  },
  {
    id: 'igpsport-v1',
    label: 'iGPSPORT official · Mapinfo V1',
    mapVersionId: '1f504832-9c67-11ef-a0af-000c29d603cc',
    note: 'Catalog for BSC300/iGS630-class devices: base map only (no contours or routing), plain Mapsforge v3. The BiNavi preloaded maps use a vendor-flagged v3 variant, so compatibility is unconfirmed — a backup is always made.',
    enabled: false,
    builtin: true,
    models: ['BSC300', 'iGS630'],
  },
]

const KEY = 'sources:v1'

export function loadSources(): CatalogSource[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CatalogSource[]
    const builtins = BUILTIN_SOURCES.map(b => ({ ...b, enabled: saved.find(s => s.id === b.id)?.enabled ?? b.enabled }))
    return [...builtins, ...saved.filter(s => !s.builtin)]
  } catch { return BUILTIN_SOURCES }
}

export function saveSources(sources: CatalogSource[]) {
  localStorage.setItem(KEY, JSON.stringify(sources.map(s => s.builtin ? { id: s.id, enabled: s.enabled, builtin: true } : s)))
}

export interface CatalogEntry {
  id: string
  source: string
  sourceLabel: string
  mapVersionId: string
  name: string
  path: string[]
  /** Country code + product, from the ZIP name when available (e.g. PT00, PT0000, ES0100). */
  code?: string
  country?: string
  version: string
  rank: number
  size: number
  url: string
}

interface Node {
  id?: string
  name?: string
  subList?: Node[]
  mapPathUrl?: string
  fileUrl?: string
  mapVersion?: string
  ver?: string
  mapSize?: number
  size?: number
}

export async function fetchCatalog(src: CatalogSource, language = 'en'): Promise<CatalogEntry[]> {
  const q = new URLSearchParams({ mapVersionId: src.mapVersionId, language })
  const res = await fetch(`${API_BASE}/web/api/Map/MapInfoList?${q}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { code: number; message?: string; data?: Node | Node[] }
  if (body.code !== 0) throw new Error(`catalog error ${body.code}${body.message ? `: ${body.message}` : ''}`)
  const out: CatalogEntry[] = []
  const walk = (nodes: Node[] | undefined, path: string[]) => {
    for (const n of nodes ?? []) {
      const p = [...path, n.name ?? '?']
      const url = n.mapPathUrl || n.fileUrl
      if (url) {
        const code = url.match(/\/([A-Z]{2}\d{2,4})\.zip$/)?.[1]
        const version = n.mapVersion ?? n.ver ?? ''
        out.push({
          id: `${src.id}:${n.id ?? url}`,
          source: src.id,
          sourceLabel: src.label,
          mapVersionId: src.mapVersionId,
          name: n.name ?? code ?? '?',
          path: p,
          code,
          country: code?.slice(0, 2),
          version,
          rank: versionRank(version),
          size: n.mapSize ?? n.size ?? 0,
          url,
        })
      }
      walk(n.subList, p)
    }
  }
  walk(Array.isArray(body.data) ? body.data : body.data ? [body.data] : [], [])
  return out
}
