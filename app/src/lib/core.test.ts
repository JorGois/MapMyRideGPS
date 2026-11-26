import { describe, expect, it } from 'vitest'
import { parseManifest, serializeManifest } from './manifest'
import { parseName, versionRank, rankToIso } from './filenames'
import { Digester } from './device'

describe('manifest', () => {
  it('round-trips the device format and recounts MAP_NUM', () => {
    const text = 'MAP_NUM:2\r\nMAP_VER:101\r\nPT0000C:7634913\r\nPT0000N:12\r\n'
    const m = parseManifest(text)
    expect(serializeManifest(m)).toBe(text)
    m.entries.delete('PT0000N')
    expect(serializeManifest(m)).toBe('MAP_NUM:1\r\nMAP_VER:101\r\nPT0000C:7634913\r\n')
  })
  it('keeps header-less manifests header-less', () => {
    const m = parseManifest('AN0000C:b1e3\r\n')
    m.entries.set('PT0000C', 'abc')
    expect(serializeManifest(m)).toBe('AN0000C:b1e3\r\nPT0000C:abc\r\n')
  })
})

describe('filenames', () => {
  it('parses base, layer, contour, region, router', () => {
    expect(parseName('PT00002412212M02C80FW07V.map')).toMatchObject({ country: 'PT', kind: 'base', date: '2024-12-21', slot: 'PT0000' })
    expect(parseName('PT00A024122105V05901000I.map')).toMatchObject({ kind: 'layer', slot: 'PT00A0' })
    expect(parseName('PT0000C.map')).toMatchObject({ kind: 'contour', slot: 'PT0000C' })
    expect(parseName('ES01002604201ABCDEF123456.map').kind).toBe('unknown') // 13-char geo is invalid
    expect(parseName('ES0100260420ABCDEF123456.map')).toMatchObject({ kind: 'region', slot: 'ES0100' })
    expect(parseName('PT0000N.rtd')).toMatchObject({ kind: 'router', country: 'PT' })
  })
  it('ranks catalog versions', () => {
    expect(versionRank('20260420')).toBe(20260420)
    expect(rankToIso(versionRank('2611'))).toBe('2026-11-01')
  })
})

describe('digest', () => {
  it('computes size, byte sum and md5 across chunks', () => {
    const d = new Digester()
    d.update(new TextEncoder().encode('ab'))
    d.update(new TextEncoder().encode('c'))
    expect(d.digest()).toEqual({ size: 3, checksum: 97 + 98 + 99, md5: '900150983cd24fb0d6963f7d28e17f72' })
  })
})

import { BUILTIN_SOURCES, detectModel, isCompatible, sourcesForModel } from './catalog'

describe('device detection', () => {
  it('prefers Device.bin, falls back to the map format', () => {
    expect(detectModel('BiNavi', [])).toEqual({ model: 'BiNavi', how: 'device' })
    expect(detectModel(undefined, [{ vendorFlag: false }, { vendorFlag: true }])).toEqual({ model: 'BiNavi', how: 'maps' })
    expect(detectModel(undefined, [{ vendorFlag: false }])).toEqual({ how: 'unknown' })
  })
  it('keeps only the catalogs for the model, leaves custom sources alone', () => {
    const custom = { id: 'custom:x', label: 'X', mapVersionId: 'x', enabled: false }
    const s = sourcesForModel([...BUILTIN_SOURCES.map(b => ({ ...b, enabled: true })), custom], 'BiNavi')
    expect(s.filter(x => x.enabled).map(x => x.id)).toEqual(['igpsport-v3'])
    expect(s.filter(x => isCompatible(x, 'BiNavi')).map(x => x.id)).toEqual(['igpsport-v3', 'custom:x'])
    expect(sourcesForModel(s, 'UnknownModel')).toBe(s)
  })
})
