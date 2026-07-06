/**
 * ToyDir/ToyFile over real File System Access API handles.
 *
 * Works with both user-picked handles (showDirectoryPicker) and OPFS roots
 * (navigator.storage.getDirectory()), which is how the browser test suite
 * exercises the real engine without permission prompts.
 */

import type { ToyDir, ToyEntry, ToyFile, ToyWritable } from './types.ts'

export class FsaDir implements ToyDir {
  readonly handle: FileSystemDirectoryHandle
  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle
  }

  get name(): string {
    return this.handle.name
  }

  async *entries(): AsyncIterable<ToyEntry> {
    // entries() is in the FSA spec but missing from some lib.dom versions.
    const iter = (
      this.handle as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>
      }
    ).entries()
    for await (const [name, handle] of iter) {
      if (handle.kind === 'directory') {
        yield { kind: 'dir', name, dir: new FsaDir(handle as FileSystemDirectoryHandle) }
      } else {
        yield { kind: 'file', name, file: new FsaFile(handle as FileSystemFileHandle) }
      }
    }
  }

  async getDir(name: string, opts?: { create?: boolean }): Promise<ToyDir> {
    return new FsaDir(await this.handle.getDirectoryHandle(name, { create: opts?.create ?? false }))
  }

  async getFile(name: string, opts?: { create?: boolean }): Promise<ToyFile> {
    return new FsaFile(await this.handle.getFileHandle(name, { create: opts?.create ?? false }))
  }

  async remove(name: string, opts?: { recursive?: boolean }): Promise<void> {
    try {
      await this.handle.removeEntry(name, { recursive: opts?.recursive ?? false })
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return
      throw e
    }
  }

  async has(name: string): Promise<'file' | 'dir' | null> {
    try {
      await this.handle.getFileHandle(name)
      return 'file'
    } catch (e) {
      if ((e as DOMException).name === 'TypeMismatchError') return 'dir'
    }
    try {
      await this.handle.getDirectoryHandle(name)
      return 'dir'
    } catch {
      return null
    }
  }
}

class FsaFile implements ToyFile {
  readonly handle: FileSystemFileHandle
  constructor(handle: FileSystemFileHandle) {
    this.handle = handle
  }

  get name(): string {
    return this.handle.name
  }

  async size(): Promise<number> {
    return (await this.handle.getFile()).size
  }
  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await (await this.handle.getFile()).arrayBuffer())
  }
  async text(): Promise<string> {
    return (await this.handle.getFile()).text()
  }
  async stream(): Promise<ReadableStream<Uint8Array>> {
    return (await this.handle.getFile()).stream() as ReadableStream<Uint8Array>
  }
  async write(data: Uint8Array | string): Promise<void> {
    const w = await this.handle.createWritable()
    // TS BufferSource narrowing: Uint8Array<ArrayBuffer> is fine at runtime.
    await w.write(data as unknown as FileSystemWriteChunkType)
    await w.close()
  }
  async createWritable(): Promise<ToyWritable> {
    const w = await this.handle.createWritable()
    return {
      write: (chunk) => w.write(chunk as unknown as FileSystemWriteChunkType),
      close: () => w.close(),
      abort: () => w.abort(),
    }
  }
}
