import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
