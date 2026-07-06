/**
 * Artifact acquisition.
 *
 * Browser reality check (verified empirically): a GitHub release
 * `browser_download_url` cannot be fetch()ed cross-origin — the 302 from
 * github.com carries no Access-Control-Allow-Origin header. The API asset
 * endpoint (api.github.com/repos/:o/:r/releases/assets/:id with
 * `Accept: application/octet-stream`) does send `ACAO: *`, so it is the
 * primary path for GitHub-hosted artifacts. Anything can still fail (rate
 * limits, future header changes, non-GitHub hosts without CORS), so
 * acquisition is a strategy chain ending in a guaranteed fallback: the user
 * downloads the file themselves and hands it to toybox (a File is just
 * bytes — verification makes it exactly as trustworthy as a direct fetch).
 *
 * Every path streams through an incremental sha256 and the digest is
 * checked against the index BEFORE the artifact is handed to extraction.
 * Nothing unverified ever reaches the mods folder.
 */

import type { CatalogArtifact } from '../catalog/types.ts'
import { createSha256, normalizeSha256 } from './hash.ts'

export interface DownloadProgress {
  bytesReceived: number
  totalBytes: number | null
}

export interface AcquireOptions {
  fetchFn?: typeof fetch
  githubToken?: string
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
}

export type DownloadErrorKind = 'cors-or-network' | 'http' | 'checksum' | 'size' | 'aborted'

export class DownloadError extends Error {
  readonly kind: DownloadErrorKind
  constructor(message: string, kind: DownloadErrorKind) {
    super(message)
    this.name = 'DownloadError'
    this.kind = kind
  }
}

export interface AcquiredArtifact {
  /** Verified bytes (Blob is disk-backed by the browser for large payloads). */
  blob: Blob
  sha256: string
  /** Which strategy produced it, for diagnostics/UI. */
  via: 'github-api' | 'direct' | 'local-file'
}

/**
 * Try to acquire an artifact over the network: GitHub API endpoint first
 * (when we have one), then a direct fetch. Throws DownloadError when no
 * network path works — callers then offer the local-file fallback.
 */
export async function acquireArtifact(
  artifact: CatalogArtifact,
  opts: AcquireOptions = {},
): Promise<AcquiredArtifact> {
  const attempts: { via: 'github-api' | 'direct'; run: () => Promise<AcquiredArtifact> }[] = []
  if (artifact.apiUrl) {
    attempts.push({
      via: 'github-api',
      run: () =>
        fetchVerified(artifact, artifact.apiUrl!, opts, 'github-api', {
          Accept: 'application/octet-stream',
          ...(opts.githubToken ? { Authorization: `Bearer ${opts.githubToken}` } : {}),
        }),
    })
  }
  attempts.push({
    via: 'direct',
    run: () => fetchVerified(artifact, artifact.url, opts, 'direct', {}),
  })

  let lastError: DownloadError | null = null
  for (const attempt of attempts) {
    try {
      return await attempt.run()
    } catch (e) {
      if (
        e instanceof DownloadError &&
        (e.kind === 'checksum' || e.kind === 'size' || e.kind === 'aborted')
      ) {
        throw e
      }
      lastError = e instanceof DownloadError ? e : new DownloadError(String(e), 'cors-or-network')
    }
  }
  throw lastError ?? new DownloadError('No download strategy available', 'cors-or-network')
}

async function fetchVerified(
  artifact: CatalogArtifact,
  url: string,
  opts: AcquireOptions,
  via: 'github-api' | 'direct',
  headers: Record<string, string>,
): Promise<AcquiredArtifact> {
  const fetchFn = opts.fetchFn ?? fetch
  let res: Response
  try {
    res = await fetchFn(url, {
      headers,
      ...(opts.signal ? { signal: opts.signal } : {}),
      redirect: 'follow',
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new DownloadError('Download cancelled', 'aborted')
    throw new DownloadError(
      `Could not fetch ${url} — likely CORS or network (${(e as Error).message})`,
      'cors-or-network',
    )
  }
  if (!res.ok) {
    throw new DownloadError(`HTTP ${res.status} fetching ${url}`, 'http')
  }
  if (!res.body) throw new DownloadError(`Empty response body from ${url}`, 'http')

  const expected = normalizeSha256(artifact.sha256)
  const hasher = createSha256()
  const parts: Uint8Array[] = []
  let received = 0
  const total = artifact.size > 0 ? artifact.size : null
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    // Self-protection: the declared size was verified by the index pipeline
    // (and capped by the mod's registered ceiling), so a stream running past
    // it is tampering or corruption — abort instead of buffering unbounded
    // data until the digest check would eventually fail.
    if (total !== null && received > total) {
      await reader.cancel().catch(() => {})
      throw new DownloadError(
        `${url} sent more data than the published size (${total} bytes) — aborting; refusing to install.`,
        'size',
      )
    }
    hasher.update(value)
    parts.push(value)
    opts.onProgress?.({ bytesReceived: received, totalBytes: total })
  }
  const digest = hasher.digestHex()
  if (digest !== expected) {
    throw new DownloadError(
      `Checksum mismatch for ${artifact.url}: expected sha256:${expected}, got sha256:${digest}. ` +
        'The published file changed or the download was corrupted — refusing to install.',
      'checksum',
    )
  }
  // Blob assembly after verification; browsers disk-back large blobs.
  return { blob: new Blob(parts as BlobPart[]), sha256: digest, via }
}

/**
 * The guaranteed fallback: verify a user-provided File (picked or dropped
 * after they downloaded it in a regular browser tab).
 */
export async function verifyLocalArtifact(
  artifact: CatalogArtifact,
  file: Blob,
): Promise<AcquiredArtifact> {
  if (artifact.size > 0 && file.size !== artifact.size) {
    throw new DownloadError(
      `That file is ${file.size} bytes but the published release is ${artifact.size} bytes — wrong file?`,
      'size',
    )
  }
  const expected = normalizeSha256(artifact.sha256)
  const hasher = createSha256()
  const reader = (file.stream() as ReadableStream<Uint8Array>).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hasher.update(value)
  }
  const digest = hasher.digestHex()
  if (digest !== expected) {
    throw new DownloadError(
      `That file does not match the published release (expected sha256:${expected}, got sha256:${digest}).`,
      'checksum',
    )
  }
  return { blob: file, sha256: digest, via: 'local-file' }
}

/** Derive the GitHub API asset URL pieces from a release download URL, if any. */
export function parseGithubReleaseUrl(
  url: string,
): { owner: string; repo: string; tag: string; file: string } | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(url)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!, tag: m[3]!, file: m[4]! }
}
