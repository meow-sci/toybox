/**
 * Minimal filesystem abstraction over the browser File System Access API.
 *
 * The engine only ever talks to these interfaces; production code wraps a
 * real FileSystemDirectoryHandle (see fsa.ts) and tests use the in-memory
 * implementation (memory.ts) or an OPFS root in browser tests. Paths are
 * always forward-slash relative paths; no leading/trailing slashes.
 */

export interface ToyDir {
  readonly name: string
  entries(): AsyncIterable<ToyEntry>
  getDir(name: string, opts?: { create?: boolean }): Promise<ToyDir>
  getFile(name: string, opts?: { create?: boolean }): Promise<ToyFile>
  /** Remove a child entry. Missing entries resolve without error. */
  remove(name: string, opts?: { recursive?: boolean }): Promise<void>
  has(name: string): Promise<'file' | 'dir' | null>
}

export type ToyEntry =
  | { kind: 'file'; name: string; file: ToyFile }
  | { kind: 'dir'; name: string; dir: ToyDir }

export interface ToyFile {
  readonly name: string
  size(): Promise<number>
  bytes(): Promise<Uint8Array>
  text(): Promise<string>
  stream(): Promise<ReadableStream<Uint8Array>>
  /** Replace the whole file content atomically (FSA writable semantics). */
  write(data: Uint8Array | string): Promise<void>
  /** Streaming writer; content becomes visible on close() (FSA semantics). */
  createWritable(): Promise<ToyWritable>
}

export interface ToyWritable {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

// ---------------------------------------------------------------------------
// Path helpers shared by all implementations
// ---------------------------------------------------------------------------

export function splitPath(path: string): string[] {
  const parts = path.split('/').filter((p) => p.length > 0)
  for (const p of parts) {
    if (p === '.' || p === '..') throw new Error(`Illegal path segment in "${path}"`)
  }
  return parts
}

export function joinPath(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join('/')
}

/** Resolve (and optionally create) the directory containing `path`. */
export async function dirAtPath(
  root: ToyDir,
  path: string,
  opts?: { create?: boolean },
): Promise<ToyDir> {
  let dir = root
  for (const seg of splitPath(path)) {
    dir = await dir.getDir(seg, opts)
  }
  return dir
}

/** Resolve (and optionally create, with parent dirs) a file at a relative path. */
export async function fileAtPath(
  root: ToyDir,
  path: string,
  opts?: { create?: boolean },
): Promise<ToyFile> {
  const parts = splitPath(path)
  const name = parts.pop()
  if (!name) throw new Error(`Not a file path: "${path}"`)
  let dir = root
  for (const seg of parts) dir = await dir.getDir(seg, opts)
  return dir.getFile(name, opts)
}

export async function pathExists(root: ToyDir, path: string): Promise<'file' | 'dir' | null> {
  const parts = splitPath(path)
  const name = parts.pop()
  if (!name) return 'dir'
  let dir = root
  try {
    for (const seg of parts) dir = await dir.getDir(seg)
  } catch {
    return null
  }
  return dir.has(name)
}

export async function readTextIfExists(root: ToyDir, path: string): Promise<string | null> {
  if ((await pathExists(root, path)) !== 'file') return null
  const f = await fileAtPath(root, path)
  return f.text()
}

/** Recursively list all file paths under a directory (relative to it). */
export async function listFilesRecursive(dir: ToyDir, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for await (const entry of dir.entries()) {
    const p = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'file') out.push(p)
    else out.push(...(await listFilesRecursive(entry.dir, p)))
  }
  return out
}

/** Delete a file and prune now-empty parent directories up to (not incl.) root. */
export async function deleteFileAndPrune(root: ToyDir, path: string): Promise<void> {
  const parts = splitPath(path)
  const name = parts.pop()
  if (!name) return
  const dirs: ToyDir[] = [root]
  let dir = root
  try {
    for (const seg of parts) {
      dir = await dir.getDir(seg)
      dirs.push(dir)
    }
  } catch {
    return // parent gone: nothing to delete
  }
  await dir.remove(name)
  // Prune empties bottom-up. dirs[i] is the parent of parts[i].
  for (let i = dirs.length - 1; i >= 1; i--) {
    const d = dirs[i]!
    let empty = true
    for await (const _ of d.entries()) {
      empty = false
      break
    }
    if (!empty) break
    await dirs[i - 1]!.remove(parts[i - 1]!)
  }
}
