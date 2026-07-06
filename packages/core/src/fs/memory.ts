/**
 * In-memory ToyDir/ToyFile implementation for unit tests (node environment).
 * Mirrors File System Access semantics: createWritable() buffers and only
 * publishes on close(); getFile/getDir throw NotFound-style errors when the
 * entry is absent and create is not set.
 */

import type { ToyDir, ToyEntry, ToyFile, ToyWritable } from './types.ts'

class MemFile implements ToyFile {
  data: Uint8Array = new Uint8Array(0)
  readonly name: string
  constructor(name: string) {
    this.name = name
  }

  size(): Promise<number> {
    return Promise.resolve(this.data.byteLength)
  }
  bytes(): Promise<Uint8Array> {
    return Promise.resolve(this.data.slice())
  }
  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(this.data))
  }
  stream(): Promise<ReadableStream<Uint8Array>> {
    const data = this.data.slice()
    return Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          if (data.byteLength > 0) controller.enqueue(data)
          controller.close()
        },
      }),
    )
  }
  write(input: Uint8Array | string): Promise<void> {
    this.data = typeof input === 'string' ? new TextEncoder().encode(input) : input.slice()
    return Promise.resolve()
  }
  createWritable(): Promise<ToyWritable> {
    const chunks: Uint8Array[] = []
    let done = false
    return Promise.resolve({
      write: (chunk: Uint8Array) => {
        if (done) return Promise.reject(new Error('writable closed'))
        chunks.push(chunk.slice())
        return Promise.resolve()
      },
      close: () => {
        done = true
        const total = chunks.reduce((n, c) => n + c.byteLength, 0)
        const merged = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          merged.set(c, off)
          off += c.byteLength
        }
        this.data = merged
        return Promise.resolve()
      },
      abort: () => {
        done = true
        return Promise.resolve()
      },
    })
  }
}

export class MemDir implements ToyDir {
  private files = new Map<string, MemFile>()
  private dirs = new Map<string, MemDir>()
  readonly name: string
  constructor(name = '') {
    this.name = name
  }

  async *entries(): AsyncIterable<ToyEntry> {
    for (const [name, dir] of this.dirs) yield { kind: 'dir', name, dir }
    for (const [name, file] of this.files) yield { kind: 'file', name, file }
  }

  getDir(name: string, opts?: { create?: boolean }): Promise<ToyDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (this.files.has(name)) return Promise.reject(new Error(`"${name}" is a file`))
      if (!opts?.create) return Promise.reject(notFound(name))
      d = new MemDir(name)
      this.dirs.set(name, d)
    }
    return Promise.resolve(d)
  }

  getFile(name: string, opts?: { create?: boolean }): Promise<ToyFile> {
    let f = this.files.get(name)
    if (!f) {
      if (this.dirs.has(name)) return Promise.reject(new Error(`"${name}" is a directory`))
      if (!opts?.create) return Promise.reject(notFound(name))
      f = new MemFile(name)
      this.files.set(name, f)
    }
    return Promise.resolve(f)
  }

  remove(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const d = this.dirs.get(name)
    if (d) {
      const empty = d.files.size === 0 && d.dirs.size === 0
      if (!empty && !opts?.recursive) {
        return Promise.reject(new Error(`directory "${name}" not empty`))
      }
      this.dirs.delete(name)
      return Promise.resolve()
    }
    this.files.delete(name)
    return Promise.resolve()
  }

  has(name: string): Promise<'file' | 'dir' | null> {
    if (this.files.has(name)) return Promise.resolve('file')
    if (this.dirs.has(name)) return Promise.resolve('dir')
    return Promise.resolve(null)
  }
}

function notFound(name: string): Error {
  const e = new Error(`NotFoundError: "${name}" does not exist`)
  e.name = 'NotFoundError'
  return e
}
