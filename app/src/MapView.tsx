import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Region } from './lib/device'
import { country, t, type Lang } from './i18n'

export type RegionStatus = 'outdated' | 'current' | 'unknown'

interface Props {
  /** Current UI language; included so tooltips re-render when it changes. */
  lang: Lang
  regions: Region[]
  status: (r: Region) => RegionStatus
  selected: Set<string>
  onToggle: (country: string) => void
}

const COLORS: Record<RegionStatus, string> = { outdated: '#ea580c', current: '#1f7a4d', unknown: '#64748b' }

/** World map showing the area covered by each region installed on the GPS. */
export default function MapView({ lang, regions, status, selected, onToggle }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map>(undefined)
  const layer = useRef<L.LayerGroup>(undefined)
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current || map.current) return
    map.current = L.map(el.current, { worldCopyJump: true, minZoom: 1 }).setView([30, 0], 2)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = undefined }
  }, [])

  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const all: L.LatLngBounds[] = []
    for (const r of regions) {
      if (!r.bbox) continue
      const b = L.latLngBounds([r.bbox.minLat, r.bbox.minLon], [r.bbox.maxLat, r.bbox.maxLon])
      all.push(b)
      const st = status(r)
      const isSel = selected.has(r.country)
      const rect = L.rectangle(b, {
        color: isSel ? '#b42318' : COLORS[st],
        weight: isSel ? 3 : 1.5,
        dashArray: isSel ? '6 4' : undefined,
        fillOpacity: isSel ? 0.08 : 0.18,
      })
      const dated = r.files.find(f => f.header && f.kind !== 'contour')?.header
      const stLabel = t(st === 'outdated' ? 'legendOutdated' : st === 'current' ? 'legendCurrent' : 'legendUnknown')
      rect.bindTooltip(`<b>${country(r.country)}</b> (${r.country})<br>${t('mapTipDate', { v: r.date ?? '—' })}<br>${t('mapTipFiles', { n: r.files.length })}${dated?.createdBy ? `<br>${dated.createdBy}` : ''}<br><i>${stLabel}</i>${isSel ? `<br><b>${t('mapTipSelected')}</b>` : ''}`, { sticky: true })
      rect.on('click', () => onToggle(r.country))
      rect.addTo(g)
    }
    if (all.length && !fitted.current) {
      m.fitBounds(all.reduce((a, b) => a.extend(b), L.latLngBounds(all[0].getSouthWest(), all[0].getNorthEast())), { padding: [20, 20] })
      fitted.current = true
    }
  }, [lang, regions, status, selected, onToggle])

  return (
    <div>
      <div ref={el} className="worldmap" />
      <div className="legend small">
        <span><i className="dot" style={{ background: COLORS.current }} />{t('legendCurrent')}</span>
        <span><i className="dot" style={{ background: COLORS.outdated }} />{t('legendOutdated')}</span>
        <span><i className="dot" style={{ background: COLORS.unknown }} />{t('legendUnknown')}</span>
        <span className="muted">{t('legendClick')}</span>
      </div>
    </div>
  )
}
