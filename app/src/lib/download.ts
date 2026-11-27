/**
 * Downloads an official map package through the app's proxy into the browser's
 * Origin Private File System (OPFS), so large ZIPs never sit in memory.
 */
const OSS_HOST = 'qw20191008.oss-us-west-1.aliyuncs.com'

/**
 * Proxy prefix, in priority order: user setting (localStorage) → VITE_DOWNLOAD_PROXY at build time →
 * the Vite dev/preview proxy ("/oss"). On GitHub Pages set it to a Cloudflare Worker URL (see /cloudflare).
 */
const PROXY_KEY = 'downloadProxy'
export function getProxy(): string {
  return localStorage.getItem(PROXY_KEY) || (import.meta.env.VITE_DOWNLOAD_PROXY as string | undefined) || '/oss'
}
export function setProxy(url: string) {
  if (url.trim()) localStorage.setItem(PROXY_KEY, url.trim().replace(/\/$/, ''))
  else localStorage.removeItem(PROXY_KEY)
}

export function proxiedUrl(url: string, mapVersionId: string, proxy = getProxy()): string | undefined {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return undefined
  const base = `${proxy.replace(/\/$/, '')}${u.pathname}`
  if (proxy.replace(/\/$/, '') === '/oss') return u.host === OSS_HOST ? base : undefined
  return `${base}?${new URLSearchParams({ url: u.href, mapVersionId })}`
}

/** Checks that the proxy answers with a real ZIP (tiny Ceuta package, 61 KB, range-limited). */
export async function probeProxy(proxy = getProxy()): Promise<boolean> {
  try {
    const res = await fetch(`${proxy.replace(/\/$/, '')}/Mapinfo/V1/ES0900.zip`, { headers: { Range: 'bytes=0-3' } })
    if (!res.ok) return false
    const b = new Uint8Array(await res.arrayBuffer())
    return b[0] === 0x50 && b[1] === 0x4b // "PK"
  } catch { return false }
}

export function canAutoDownload(url: string, mapVersionId: string): boolean {
  return !!proxiedUrl(url, mapVersionId) && !!navigator.storage?.getDirectory
}

export interface Downloaded {
  file: File
  /** Deletes the temporary copy from browser storage. */
  discard: () => Promise<void>
}

export async function downloadPackage(
  url: string,
  mapVersionId: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Downloaded> {
  const proxied = proxiedUrl(url, mapVersionId)
  if (!proxied) throw new Error('This download host is not supported by the proxy.')
  const res = await fetch(proxied, { signal })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0

  const opfs = await navigator.storage.getDirectory()
  const tmpDir = await opfs.getDirectoryHandle('downloads', { create: true })
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'package') .replace(/[^\w.-]/g, '_')
  const fileName = /\.zip$/i.test(name) ? name : `${name}.zip`
  const handle = await tmpDir.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  let done = 0
  try {
    await res.body
      .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) { done += chunk.length; onProgress(done, total); ctl.enqueue(chunk) },
      }))
      .pipeTo(writable, { signal })
  } catch (e) {
    await tmpDir.removeEntry(fileName).catch(() => {})
    throw e
  }
  if (total && done !== total) {
    await tmpDir.removeEntry(fileName).catch(() => {})
    throw new Error(`Download incomplete (${done} of ${total} bytes).`)
  }
  return { file: await handle.getFile(), discard: () => tmpDir.removeEntry(fileName).catch(() => {}) }
}

/** Removes any leftovers from interrupted sessions. */
export async function clearDownloads() {
  try { await (await navigator.storage.getDirectory()).removeEntry('downloads', { recursive: true }) } catch { /* none */ }
}
