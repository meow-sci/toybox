/**
 * Directory-grant persistence (flexo's proven pattern).
 *
 * The FileSystemDirectoryHandle is structured-cloneable, so it is stored in
 * IndexedDB and survives reloads; the *permission* can lapse (browser
 * restart), so boot re-queries passively (never prompts) and re-requests
 * only from a user gesture.
 *
 * This is purely a reconnection convenience: no toybox state lives in the
 * browser. Clearing IndexedDB just means picking the folder again.
 */

const DB_NAME = 'toybox-fs'
const STORE = 'handles'
const KEY = 'ksaDir'

export type GrantStatus = 'unsupported' | 'none' | 'needs-permission' | 'ready'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error as Error)
  })
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error as Error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error as Error)
  })
}

export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function queryWritable(h: FileSystemDirectoryHandle): Promise<boolean> {
  return !h.queryPermission || (await h.queryPermission({ mode: 'readwrite' })) === 'granted'
}

async function requestWritable(h: FileSystemDirectoryHandle): Promise<boolean> {
  return !h.requestPermission || (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

/** Passive boot check — never prompts. */
export async function initGrant(): Promise<{
  status: GrantStatus
  handle: FileSystemDirectoryHandle | null
}> {
  if (!fsaSupported()) return { status: 'unsupported', handle: null }
  const stored = (await idbGet(KEY).catch(() => undefined)) as FileSystemDirectoryHandle | undefined
  if (!stored) return { status: 'none', handle: null }
  if (await queryWritable(stored).catch(() => false)) return { status: 'ready', handle: stored }
  return { status: 'needs-permission', handle: stored }
}

/** Must run in a user gesture. Returns null when the picker is dismissed. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    const handle = await window.showDirectoryPicker({ id: 'toybox-ksa', mode: 'readwrite' })
    await idbSet(KEY, handle).catch(() => {})
    return handle
  } catch {
    return null // dismissed
  }
}

/** Re-request permission on the stored handle (user gesture). */
export async function regrant(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return requestWritable(handle).catch(() => false)
}

export async function forgetGrant(): Promise<void> {
  await idbDelete(KEY).catch(() => {})
}
