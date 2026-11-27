import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../../cloudflare/worker.js'

const catalogId = '1f504832-9c67-11ef-a0af-000c29d603cc'
const target = 'https://new-storage.example/Mapinfo/V1/ES0900.zip?token=abc'
const origin = 'https://jorgois.github.io'

function request(url = target, id = catalogId) {
  const parsed = new URL(url)
  const query = new URLSearchParams({ url, mapVersionId: id })
  return new Request(`https://proxy.example${parsed.pathname}?${query}`, { headers: { Origin: origin, Range: 'bytes=0-3' } })
}

function mockCatalog(urls) {
  return vi.fn(async url => {
    if (url instanceof URL && url.hostname === 'prod.en.igpsport.com') {
      return Response.json({ code: 0, data: [{ subList: urls.map(mapPathUrl => ({ mapPathUrl })) }] })
    }
    return new Response('PK00', { status: 206, headers: { 'Content-Range': 'bytes 0-3/100' } })
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('catalog-validated worker', () => {
  it('downloads the exact catalog URL from a changed host and forwards Range', async () => {
    const fetch = mockCatalog([target])
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request())
    expect(response.status).toBe(206)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(fetch).toHaveBeenLastCalledWith(target, expect.objectContaining({ headers: { Range: 'bytes=0-3' }, redirect: 'manual' }))
  })

  it('rejects URLs not in the catalog without fetching them', async () => {
    const fetch = mockCatalog([target])
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request('https://untrusted.example/Mapinfo/V1/ES0900.zip'))
    expect(response.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed catalog identifiers before making any request', async () => {
    const fetch = mockCatalog([target])
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request(target, 'invalid'))
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports legacy requests for catalog entries', async () => {
    const fetch = mockCatalog([target])
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(new Request('https://proxy.example/Mapinfo/V1/ES0900.zip', {
      headers: { Origin: origin },
    }))
    expect(response.status).toBe(206)
    expect(fetch).toHaveBeenLastCalledWith(target, expect.anything())
  })

  it('keeps the old health check working when its old URL disappears', async () => {
    const changedTarget = 'https://new-storage.example/new-probe.zip'
    const fetch = mockCatalog([changedTarget])
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(new Request('https://proxy.example/Mapinfo/V1/ES0900.zip', {
      headers: { Origin: origin, Range: 'bytes=0-3' },
    }))
    expect(response.status).toBe(206)
    expect(fetch).toHaveBeenLastCalledWith(changedTarget, expect.anything())
  })

  it('reports catalog failures without fetching the requested URL', async () => {
    const fetch = vi.fn(async () => new Response('Unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request())
    expect(response.status).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
