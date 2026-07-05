import { describe, expect, it } from 'vitest'
import { MemDir } from '../fs/memory.ts'
import { fileAtPath } from '../fs/types.ts'
import { makeZip } from '../testing/fixtures.ts'
import { sha256Hex } from './hash.ts'
import { extractZipStream, ZipError, type ZipSink } from './zip.ts'

function dirSink(root: MemDir): ZipSink {
  return {
    file: async (path) => {
      const f = await fileAtPath(root, path, { create: true })
      const w = await f.createWritable()
      return { write: (c) => w.write(c), close: () => w.close(), abort: () => w.abort() }
    },
  }
}

/** Stream a byte array in small chunks to exercise the incremental path. */
function chunkedStream(bytes: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

describe('extractZipStream', () => {
  it('extracts nested files with correct bytes and digests', async () => {
    const files = {
      'purrTTY/mod.toml': 'name = "purrTTY"\n',
      'purrTTY/bin/deep/lib.dll': new Uint8Array([1, 2, 3, 4, 5]),
      'purrTTY/LICENSE': 'MIT',
    }
    const { bytes } = makeZip(files)
    const root = new MemDir()
    const results = await extractZipStream(chunkedStream(bytes), dirSink(root))

    expect(results.map((r) => r.path).sort()).toEqual([
      'purrTTY/LICENSE',
      'purrTTY/bin/deep/lib.dll',
      'purrTTY/mod.toml',
    ])
    const toml = await fileAtPath(root, 'purrTTY/mod.toml')
    expect(await toml.text()).toBe('name = "purrTTY"\n')
    const dll = results.find((r) => r.path === 'purrTTY/bin/deep/lib.dll')!
    expect(dll.size).toBe(5)
    expect(dll.sha256).toBe(sha256Hex(new Uint8Array([1, 2, 3, 4, 5])))
  })

  it('handles large files spanning many chunks', async () => {
    const big = new Uint8Array(300_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    const { bytes } = makeZip({ 'M/big.bin': big })
    const root = new MemDir()
    const results = await extractZipStream(chunkedStream(bytes, 4096), dirSink(root))
    expect(results[0]!.size).toBe(big.byteLength)
    expect(results[0]!.sha256).toBe(sha256Hex(big))
    const f = await fileAtPath(root, 'M/big.bin')
    expect(await f.size()).toBe(big.byteLength)
  })

  it('skips entries when the sink returns null', async () => {
    const { bytes } = makeZip({ 'keep.txt': 'yes', 'skip.txt': 'no' })
    const root = new MemDir()
    const sink: ZipSink = {
      file: async (path) => (path === 'skip.txt' ? null : dirSink(root).file(path)),
    }
    const results = await extractZipStream(chunkedStream(bytes), sink)
    expect(results.map((r) => r.path)).toEqual(['keep.txt'])
    expect(await root.has('skip.txt')).toBeNull()
  })

  it('rejects unsafe entry paths', async () => {
    // Hand-craft an entry name with traversal by abusing makeZip input keys.
    const { bytes } = makeZip({ '../evil.txt': 'boom' })
    const root = new MemDir()
    await expect(extractZipStream(chunkedStream(bytes), dirSink(root))).rejects.toThrow(ZipError)
  })

  it('fails cleanly on corrupt compressed data', async () => {
    // Force deflate with a large compressible payload, then flip bytes in
    // the middle of the compressed stream.
    const big = new Uint8Array(200_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 7
    const { bytes } = makeZip({ 'M/big.bin': big })
    const corrupt = bytes.slice()
    for (let i = 200; i < 260; i++) corrupt[i] = corrupt[i]! ^ 0xff
    const root = new MemDir()
    await expect(extractZipStream(chunkedStream(corrupt, 4096), dirSink(root))).rejects.toThrow()
  })

  it('produces no entries for non-zip garbage', async () => {
    const garbage = new Uint8Array(1024).fill(0x42)
    const root = new MemDir()
    // fflate finds no local headers; the install pipeline then rejects the
    // result as "no files under the declared root".
    expect(await extractZipStream(chunkedStream(garbage), dirSink(root))).toEqual([])
  })
})
