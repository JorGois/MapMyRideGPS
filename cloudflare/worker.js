// Cloudflare Worker: CORS proxy for URLs in the official iGPSPORT catalog.
// Deploy: `npx wrangler deploy` in this folder, then paste the worker URL into the app's
// "Download proxy" setting (or build with VITE_DOWNLOAD_PROXY=<url>).
const CATALOG_API = 'https://prod.en.igpsport.com/service/web/api/Map/MapInfoList'
const BUILTIN_CATALOGS = ['1f504832-9c67-11ef-a0af-000c29d603cc', 'a959751a-21b5-44a3-b713-bc12ebb208ef']
// CORS limits browser access, not direct requests with a spoofed Origin.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://jorgois.github.io']

async function catalogUrls(id) {
  const url = new URL(CATALOG_API)
  url.search = new URLSearchParams({ mapVersionId: id, language: 'en' }).toString()
  const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual' })
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`)
  const body = await response.json()
  if (body.code !== 0 || !body.data || typeof body.data !== 'object') throw new Error('Invalid catalog response')
  const pending = Array.isArray(body.data) ? [...body.data] : [body.data]
  const urls = []
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    const value = node.mapPathUrl || node.fileUrl
    if (typeof value === 'string') {
      try {
        const parsed = new URL(value)
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && !parsed.hash) {
          urls.push(parsed.href)
        }
      } catch {
        // Ignore malformed URLs supplied by the catalog.
      }
    }
    if (Array.isArray(node.subList)) pending.push(...node.subList)
  }
  return urls
}

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') ?? ''
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Vary': 'Origin',
    }
    // Browsers send Origin on cross-origin fetches; other clients can spoof it.
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 })
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors })
    const requestUrl = new URL(req.url)
    const target = requestUrl.searchParams.get('url')
    const catalogId = requestUrl.searchParams.get('mapVersionId')
    if ((target === null) !== (catalogId === null) ||
        (catalogId !== null && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(catalogId))) {
      return new Response('Invalid catalog request', { status: 400, headers: cors })
    }
    let upstream
    try {
      if (target !== null) {
        const urls = await catalogUrls(catalogId)
        upstream = urls.find(url => url === target && new URL(url).pathname === requestUrl.pathname)
      } else {
        // Support older app builds and their proxy health check during deployment.
        for (const id of BUILTIN_CATALOGS) {
          const urls = await catalogUrls(id)
          upstream = urls.find(url => new URL(url).pathname === requestUrl.pathname)
          if (!upstream && requestUrl.pathname === '/Mapinfo/V1/ES0900.zip' && req.headers.get('Range') === 'bytes=0-3') {
            upstream = urls[0]
          }
          if (upstream) break
        }
      }
    } catch (error) {
      console.error('Unable to verify iGPSPORT catalog', error)
      return new Response('Catalog unavailable', { status: 502, headers: cors })
    }
    if (!upstream) return new Response('Not found in catalog', { status: 404, headers: cors })
    const headers = {}
    const range = req.headers.get('Range')
    if (range) headers.Range = range
    const up = await fetch(upstream, { method: req.method, headers, redirect: 'manual' })
    const res = new Response(up.body, up)
    for (const h of ['Set-Cookie', 'Location']) res.headers.delete(h)
    res.headers.set('X-Content-Type-Options', 'nosniff')
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    return res
  },
}
