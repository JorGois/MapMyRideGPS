// Cloudflare Worker: CORS proxy for iGPSPORT map ZIPs (read-only, single host).
// Deploy: `npx wrangler deploy` in this folder, then paste the worker URL into the app's
// "Download proxy" setting (or build with VITE_DOWNLOAD_PROXY=<url>).
const UPSTREAM = 'https://qw20191008.oss-us-west-1.aliyuncs.com'
// Restrict who may use the proxy. Add your GitHub Pages origin here.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://jorgois.github.io']

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') ?? ''
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Vary': 'Origin',
    }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors })
    const path = new URL(req.url).pathname
    // Only map packages: /Mapinfo/... ZIPs or bare object ids.
    if (!/^\/(Mapinfo\/[\w/.-]+\.zip|[0-9a-f-]{36})$/.test(path)) return new Response('Not found', { status: 404, headers: cors })
    const headers = {}
    const range = req.headers.get('Range')
    if (range) headers.Range = range
    const up = await fetch(UPSTREAM + path, { method: req.method, headers })
    const res = new Response(up.body, up)
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    return res
  },
}
