/**
 * Streaming SHA-256. WebCrypto's digest() is one-shot, which would force
 * buffering whole artifacts (gatOS zips are ~140 MB); @noble/hashes gives us
 * incremental hashing so downloads and file writes are verified as the bytes
 * flow through.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export interface Hasher {
  update(chunk: Uint8Array): void
  /** Hex digest; the hasher must not be used afterwards. */
  digestHex(): string
}

export function createSha256(): Hasher {
  const h = sha256.create()
  return {
    update: (chunk) => {
      h.update(chunk)
    },
    digestHex: () => bytesToHex(h.digest()),
  }
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data))
}

export async function sha256HexOfStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const h = createSha256()
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    h.update(value)
  }
  return h.digestHex()
}

export function normalizeSha256(s: string): string {
  return s.toLowerCase().replace(/^sha256:/, '')
}
