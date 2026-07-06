import { describe, expect, it } from 'vitest'
import { artifact, blobResponse, makeZip } from '../testing/fixtures.ts'
import {
  acquireArtifact,
  DownloadError,
  parseGithubReleaseUrl,
  verifyLocalArtifact,
} from './download.ts'

const zip = makeZip({ 'M/mod.toml': 'name = "M"\n' })
const art = artifact({
  url: 'https://github.com/o/r/releases/download/v1/M-1.zip',
  apiUrl: 'https://api.github.com/repos/o/r/releases/assets/123',
  sha256: zip.sha256,
  size: zip.bytes.byteLength,
})

describe('acquireArtifact', () => {
  it('uses the GitHub API endpoint first and verifies the digest', async () => {
    const calls: string[] = []
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === art.apiUrl) {
        const headers = new Headers(init?.headers)
        expect(headers.get('accept')).toBe('application/octet-stream')
        return blobResponse(zip.blob)
      }
      return new Response('no', { status: 404 })
    }) as typeof fetch
    const result = await acquireArtifact(art, { fetchFn })
    expect(result.via).toBe('github-api')
    expect(result.sha256).toBe(zip.sha256)
    expect(calls).toEqual([art.apiUrl])
  })

  it('falls back to direct fetch when the API path fails', async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === art.apiUrl) throw new TypeError('Failed to fetch') // CORS-shaped
      if (url === art.url) return blobResponse(zip.blob)
      return new Response('no', { status: 404 })
    }) as typeof fetch
    const result = await acquireArtifact(art, { fetchFn })
    expect(result.via).toBe('direct')
  })

  it('reports progress with totals', async () => {
    const progress: number[] = []
    const fetchFn = (async () => blobResponse(zip.blob)) as typeof fetch
    await acquireArtifact(art, {
      fetchFn,
      onProgress: (p) => {
        progress.push(p.bytesReceived)
        expect(p.totalBytes).toBe(zip.bytes.byteLength)
      },
    })
    expect(progress.at(-1)).toBe(zip.bytes.byteLength)
  })

  it('refuses checksum mismatches and does NOT fall through', async () => {
    // Same size as the real artifact, one byte flipped: only the digest
    // catches it (a size difference would trip the earlier size guard).
    const tampered = zip.bytes.slice()
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff
    let directTried = false
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === art.apiUrl) return blobResponse(new Blob([tampered as unknown as BlobPart]))
      directTried = true
      return blobResponse(zip.blob)
    }) as typeof fetch
    await expect(acquireArtifact(art, { fetchFn })).rejects.toMatchObject({ kind: 'checksum' })
    expect(directTried).toBe(false)
  })

  it('surfaces a CORS-shaped failure when every strategy fails', async () => {
    const fetchFn = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    await expect(acquireArtifact(art, { fetchFn })).rejects.toBeInstanceOf(DownloadError)
  })

  it('sends the auth token to the API endpoint when configured', async () => {
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer tok123')
      return blobResponse(zip.blob)
    }) as typeof fetch
    await acquireArtifact(art, { fetchFn, githubToken: 'tok123' })
  })
})

describe('size self-protection', () => {
  it('aborts a stream that exceeds the published size and does not fall through', async () => {
    // Server sends the real zip followed by garbage padding.
    const padded = new Uint8Array(zip.bytes.byteLength + 4096)
    padded.set(zip.bytes)
    padded.fill(0x41, zip.bytes.byteLength)
    let attempts = 0
    const fetchFn = (async () => {
      attempts++
      return new Response(new Blob([padded.slice() as unknown as BlobPart]))
    }) as typeof fetch
    await expect(acquireArtifact(art, { fetchFn })).rejects.toMatchObject({ kind: 'size' })
    expect(attempts).toBe(1) // fatal: the direct-URL strategy was not tried
  })

  it('reports progress only up to the cap before aborting', async () => {
    const padded = new Uint8Array(zip.bytes.byteLength * 2)
    padded.set(zip.bytes)
    let maxReported = 0
    const fetchFn = (async () =>
      new Response(new Blob([padded.slice() as unknown as BlobPart]))) as typeof fetch
    await expect(
      acquireArtifact(art, {
        fetchFn,
        onProgress: (p) => {
          maxReported = Math.max(maxReported, p.bytesReceived)
        },
      }),
    ).rejects.toMatchObject({ kind: 'size' })
    expect(maxReported).toBeLessThanOrEqual(zip.bytes.byteLength)
  })
})

describe('verifyLocalArtifact', () => {
  it('quick-rejects a file of the wrong size before hashing', async () => {
    const bigger = new Blob([zip.blob, new Blob([new Uint8Array(10)])])
    await expect(verifyLocalArtifact(art, bigger)).rejects.toMatchObject({ kind: 'size' })
  })

  it('accepts a matching user-provided file', async () => {
    const result = await verifyLocalArtifact(art, zip.blob)
    expect(result.via).toBe('local-file')
  })

  it('rejects a same-size file with different content (checksum)', async () => {
    const tampered = zip.bytes.slice()
    tampered[10] = tampered[10]! ^ 0xff
    await expect(
      verifyLocalArtifact(art, new Blob([tampered as unknown as BlobPart])),
    ).rejects.toMatchObject({ kind: 'checksum' })
  })
})

describe('parseGithubReleaseUrl', () => {
  it('parses release download URLs', () => {
    expect(
      parseGithubReleaseUrl(
        'https://github.com/meow-sci/gatOS/releases/download/v1.1.0/gatOS-windows-1.1.0.zip',
      ),
    ).toEqual({ owner: 'meow-sci', repo: 'gatOS', tag: 'v1.1.0', file: 'gatOS-windows-1.1.0.zip' })
    expect(parseGithubReleaseUrl('https://example.com/whatever.zip')).toBeNull()
  })
})
