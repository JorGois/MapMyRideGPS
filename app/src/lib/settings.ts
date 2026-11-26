/**
 * Remembers folder handles (GPS drive, backup folder) between visits.
 * Cookies can't hold them; browsers allow storing FileSystemHandles in IndexedDB only.
 * Plain settings live in localStorage under the keys listed in SETTING_KEYS.
 */
const DB = 'mapmyridegps'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE))
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  } finally { db.close() }
}

export type HandleKey = 'device' | 'backup'

export const saveHandle = (key: HandleKey, h: FileSystemDirectoryHandle) => tx('readwrite', s => s.put(h, key)).catch(() => {})
export const loadHandle = (key: HandleKey) =>
  tx<FileSystemDirectoryHandle | undefined>('readonly', s => s.get(key) as IDBRequest<FileSystemDirectoryHandle | undefined>).catch(() => undefined)

/** 'granted' | 'prompt' | 'denied' without prompting. */
export async function permissionOf(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  try { return await h.queryPermission({ mode: 'readwrite' }) } catch { return 'denied' }
}

export const SETTING_KEYS = ['sources:v1', 'downloadProxy', 'onlyMine', 'showMap', 'lang', 'sound'] as const
const CAPACITY_PREFIX = 'capacity:'

export function loadBool(key: (typeof SETTING_KEYS)[number], fallback: boolean): boolean {
  const v = localStorage.getItem(key)
  return v === null ? fallback : v === 'true'
}
export function saveBool(key: (typeof SETTING_KEYS)[number], v: boolean) { localStorage.setItem(key, String(v)) }

/** Forgets everything the app stored in this browser: settings, folder access and temporary downloads. */
export async function clearAll() {
  for (const k of Object.keys(localStorage)) {
    if ((SETTING_KEYS as readonly string[]).includes(k) || k.startsWith(CAPACITY_PREFIX)) localStorage.removeItem(k)
  }
  await new Promise<void>(resolve => {
    const r = indexedDB.deleteDatabase(DB)
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
  try { await (await navigator.storage.getDirectory()).removeEntry('downloads', { recursive: true }) } catch { /* none */ }
}

/** Approximate size of browser storage used by this app (OPFS downloads etc.). */
export async function storageUsed(): Promise<number> {
  try { return (await navigator.storage.estimate()).usage ?? 0 } catch { return 0 }
}
