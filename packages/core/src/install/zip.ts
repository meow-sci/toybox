/**
 * Streaming zip extraction built on fflate's Unzip.
 *
 * Bytes are pushed in as they arrive from a (usually Blob-backed) stream,
 * entries decompress incrementally, and each file's bytes flow to a sink
 * (a ToyWritable in production) while a per-file sha256 accumulates — so the
 * engine can persist a manifest of exactly what it wrote without buffering
 * whole files.
 *
 * Backpressure: the producer pauses while more than QUEUE_HIGH_WATERMARK
 * decompressed bytes are queued for writing. Compressed bytes of entries the
 * (strictly sequential) writer has not reached yet can buffer inside fflate;
 * with a pull-based Blob source that stays proportional to how far reads run
 * ahead of disk writes, which is fine — the install pipeline always
 * downloads + verifies the artifact into a Blob first (never extract
 * unverified data), then extracts from the Blob.
 *
 * Works for zips whose local headers carry sizes (Info-ZIP `zip -r`, which
 * is what the purrTTY/gatOS release workflows produce).
 */

import { Unzip, UnzipInflate } from 'fflate'
import { createSha256 } from './hash.ts'

export interface ZipEntryResult {
  path: string
  size: number
  sha256: string
}

export interface ZipSink {
  /**
   * Called once per file entry (directories are implicit). Return null to
   * skip the entry; otherwise return a writer for its bytes.
   */
  file(path: string): Promise<ZipFileWriter | null>
}

export interface ZipFileWriter {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

const QUEUE_HIGH_WATERMARK = 8 * 1024 * 1024

/** Normalize + sanity-check an entry name; returns null for directories. */
function cleanEntryPath(name: string): string | null {
  if (name.endsWith('/')) return null
  if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
    throw new ZipError(`Archive contains an unsafe path: "${name}"`)
  }
  const parts = name.split('/').filter((p) => p.length > 0)
  if (parts.length === 0) return null
  if (parts.some((p) => p === '.' || p === '..')) {
    throw new ZipError(`Archive contains an unsafe path: "${name}"`)
  }
  return parts.join('/')
}

interface EntryChunk {
  data: Uint8Array
  final: boolean
}

export async function extractZipStream(
  stream: ReadableStream<Uint8Array>,
  sink: ZipSink,
  opts?: { onEntry?: (path: string) => void },
): Promise<ZipEntryResult[]> {
  const results: ZipEntryResult[] = []
  let failure: Error | null = null
  const consumerWakers = new Set<() => void>()
  const fail = (e: Error) => {
    failure ??= e
    wakeProducer?.()
    for (const wake of consumerWakers) wake()
  }

  // Decompressed-byte accounting for producer backpressure.
  let queuedBytes = 0
  let wakeProducer: (() => void) | null = null

  // Entries are written strictly sequentially (their bytes arrive in archive
  // order); `chain` is the tail of that pipeline.
  let chain: Promise<void> = Promise.resolve()

  const unzip = new Unzip()
  unzip.register(UnzipInflate)

  unzip.onfile = (file) => {
    let path: string | null
    try {
      path = cleanEntryPath(file.name)
    } catch (e) {
      fail(e as Error)
      return
    }
    if (path === null) return
    const entryPath = path
    // Uncompressed size from the local header, when present (absent for
    // archives written in streaming fashion) — enforced after extraction
    // because fflate's streaming inflate does not itself validate output
    // length (a corrupted deflate stream can end early without an error).
    const declaredSize: number | undefined = file.originalSize

    const queue: EntryChunk[] = []
    let wakeConsumer: (() => void) | null = null
    let entryErr: Error | null = null

    file.ondata = (err, data, final) => {
      if (err) entryErr = new ZipError(`Failed to inflate "${entryPath}": ${err.message}`)
      else {
        queue.push({ data, final })
        queuedBytes += data.byteLength
      }
      wakeConsumer?.()
    }
    // Start immediately: decompressed output is queued here (bounded by the
    // watermark), and the sequential writer chain below drains it.
    file.start()

    const nextChunk = async (): Promise<EntryChunk> => {
      for (;;) {
        if (entryErr) throw entryErr
        const c = queue.shift()
        if (c) {
          queuedBytes -= c.data.byteLength
          if (queuedBytes < QUEUE_HIGH_WATERMARK) wakeProducer?.()
          return c
        }
        if (failure) throw failure
        await new Promise<void>((r) => {
          wakeConsumer = r
          consumerWakers.add(r)
        })
        if (wakeConsumer) consumerWakers.delete(wakeConsumer)
        wakeConsumer = null
      }
    }

    chain = chain
      .then(async () => {
        if (failure) return
        const writer = await sink.file(entryPath)
        opts?.onEntry?.(entryPath)
        const hasher = createSha256()
        let size = 0
        try {
          for (;;) {
            const c = await nextChunk()
            if (c.data.byteLength > 0) {
              size += c.data.byteLength
              if (writer) {
                hasher.update(c.data)
                await writer.write(c.data)
              }
            }
            if (c.final) break
          }
          if (declaredSize !== undefined && size !== declaredSize) {
            throw new ZipError(
              `"${entryPath}" extracted to ${size} bytes but the archive declares ${declaredSize} — corrupt archive.`,
            )
          }
          if (writer) {
            await writer.close()
            results.push({ path: entryPath, size, sha256: hasher.digestHex() })
          }
        } catch (e) {
          await writer?.abort().catch(() => {})
          throw e
        }
      })
      .catch((e: Error) => {
        fail(e)
      })
  }

  const reader = stream.getReader()
  try {
    for (;;) {
      if (failure) break
      if (queuedBytes >= QUEUE_HIGH_WATERMARK) {
        await new Promise<void>((r) => {
          wakeProducer = r
        })
        wakeProducer = null
        continue
      }
      const { done, value } = await reader.read()
      if (done) break
      try {
        unzip.push(value, false)
      } catch (e) {
        fail(new ZipError(`Corrupt archive: ${(e as Error).message}`))
        break
      }
    }
  } finally {
    if (failure) await reader.cancel().catch(() => {})
  }
  if (!failure) {
    try {
      unzip.push(new Uint8Array(0), true)
    } catch (e) {
      fail(new ZipError(`Corrupt archive: ${(e as Error).message}`))
    }
  }
  await chain
  if (failure) throw failure
  return results
}
