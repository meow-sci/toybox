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
    const evil = makeZip({ 'M/mod.toml': 'name = "Evil"\n' })
    let directTried = false
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === art.apiUrl) return blobResponse(evil.blob)
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

describe('verifyLocalArtifact', () => {
  it('accepts a matching user-provided file', async () => {
    const result = await verifyLocalArtifact(art, zip.blob)
    expect(result.via).toBe('local-file')
  })

  it('rejects a mismatching file', async () => {
    const wrong = makeZip({ 'other.txt': 'x' })
    await expect(verifyLocalArtifact(art, wrong.blob)).rejects.toMatchObject({ kind: 'checksum' })
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
