import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Content-Security-Policy for the built site (GitHub Pages cannot send headers, so it goes in a
// <meta> tag). Only added to production builds: the dev server injects inline scripts for HMR.
// connect-src allows any https origin because the download proxy URL is user-configurable.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self' https:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')
const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: html => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
})

// iGPSPORT stores map ZIPs on Aliyun OSS without CORS headers, so the browser
// cannot fetch them directly. The dev/preview server proxies /oss/* to that host.
const OSS = 'https://qw20191008.oss-us-west-1.aliyuncs.com'
const proxy = {
  '/oss': {
    target: OSS,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/oss/, ''),
  },
}

export default defineConfig({
  // Relative asset paths so the build works under https://<user>.github.io/<repo>/
  base: './',
  plugins: [react(), csp()],
  server: { proxy },
  preview: { proxy },
})
