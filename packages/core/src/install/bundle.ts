/**
 * Greenfield bundle builder — the install path for browsers WITHOUT the
 * File System Access API.
 *
 * The app still browses, resolves, and verifies exactly as on Chromium; it
 * just cannot write into the mods folder. Instead, the user's selection is
 * resolved greenfield (empty installed set — required dependencies are
 * pulled in, optional ones are not), every artifact is downloaded and
 * digest-verified, and the mod folders are re-packaged into ONE zip the
 * browser downloads. Extracting that zip into
 * `Documents/My Games/Kitten Space Agency/mods/` yields exactly what a
 * managed install would have written.
 *
 * The pipeline is streaming end to end: artifact bytes stream through
 * verification, entries decompress incrementally, and the output zip is
 * produced chunk-by-chunk (fflate Zip), consolidated into disk-backable
 * Blob parts so peak JS-heap memory stays bounded rather than holding the
 * whole bundle as one buffer. When the selection is a single mod whose
 * archive root already equals its install folder, the verified original
 * artifact is passed through untouched (exact upstream bytes, no re-zip).
 */

import { Zip, ZipDeflate } from 'fflate'
import type { ArtifactManifest, CatalogArtifact, Platform, ToyboxIndex } from '../catalog/types.ts'
import { artifactForPlatform } from '../catalog/select.ts'
import { resolve, type ResolutionFailure } from '../resolve/resolver.ts'
import type { AcquiredArtifact, DownloadProgress } from './download.ts'
import { acquireArtifact, verifyLocalArtifact } from './download.ts'
import type { InstalledFile } from '../state/types.ts'
import { normalizeSha256 } from './hash.ts'
import { verifyAgainstManifest, TransactionError } from './transaction.ts'
import { extractZipStream, type ZipFileWriter } from './zip.ts'

export interface BundleRequest {
  index: ToyboxIndex
  /** The user's selection; required dependencies are resolved in. */
  select: { id: string; version?: string }[]
  platform: Platform
  includePrerelease?: boolean
  ksaVersion?: string
}

export interface BundleOptions {
  fetchFn?: typeof fetch
  githubToken?: string
  /** Fetch a release artifact's file manifest for per-file verification. */
  manifestFor?: (artifact: CatalogArtifact) => Promise<ArtifactManifest | null>
  onEvent?: (e: BundleEvent) => void
  signal?: AbortSignal
}

export type BundleEvent =
  | { type: 'phase'; phase: 'downloading' | 'verifying' | 'packing'; modId: string }
  | { type: 'download'; modId: string; progress: DownloadProgress }
  | { type: 'file'; modId: string; path: string }
  | {
      type: 'needs-local-file'
      modId: string
      artifact: CatalogArtifact
      provide: (file: Blob) => void
      abort: (reason?: string) => void
    }

export interface BundleResult {
  ok: true
  blob: Blob
  filename: string
  /** Mods included (id@version), selection first, dependencies after. */
  contents: { id: string; version: string }[]
  /** 'original' = the verified upstream zip passed through byte-exact. */
  via: 'original' | 'repacked'
}

export type BundleOutcome = BundleResult | ResolutionFailure

/** Consolidate output chunks into Blob parts so the JS heap stays bounded. */
const BLOB_PART_BYTES = 32 * 1024 * 1024

export async function buildModBundle(
  request: BundleRequest,
  opts: BundleOptions = {},
): Promise<BundleOutcome> {
  const resolution = resolve(request.index, {
    install: request.select.map((s) => ({
      id: s.id,
      ...(s.version !== undefined ? { range: `=${s.version}` } : {}),
    })),
    remove: [],
    installed: {}, // greenfield: nothing assumed present
    platform: request.platform,
    ...(request.includePrerelease !== undefined
      ? { includePrerelease: request.includePrerelease }
      : {}),
    ...(request.ksaVersion !== undefined ? { ksaVersion: request.ksaVersion } : {}),
  })
  if (!resolution.ok) return resolution

  // Selection order first, then auto-included dependencies.
  const selectedIds = request.select.map((s) => s.id.toLowerCase())
  const targets = Object.values(resolution.target).sort((a, b) => {
    const ai = selectedIds.indexOf(a.id.toLowerCase())
    const bi = selectedIds.indexOf(b.id.toLowerCase())
    return (ai === -1 ? selectedIds.length : ai) - (bi === -1 ? selectedIds.length : bi)
  })

  const picks = targets.map((t) => {
    const mod = request.index.mods.find((m) => m.id === t.id)!
    const release = mod.releases.find((r) => r.version === t.version)!
    const artifact = artifactForPlatform(release, request.platform)
    if (!artifact) {
      throw new TransactionError(`No ${request.platform} artifact for ${t.id}@${t.version}`)
    }
    return { mod, release, artifact }
  })

  const acquire = async (modId: string, artifact: CatalogArtifact): Promise<AcquiredArtifact> => {
    opts.onEvent?.({ type: 'phase', phase: 'downloading', modId })
    try {
      return await acquireArtifact(artifact, {
        ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
        ...(opts.githubToken !== undefined ? { githubToken: opts.githubToken } : {}),
        onProgress: (progress) => opts.onEvent?.({ type: 'download', modId, progress }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (e) {
      const kind = (e as { kind?: string }).kind
      if (kind === 'checksum' || kind === 'size' || kind === 'aborted') throw e
      const file = await new Promise<Blob>((resolvePromise, rejectPromise) => {
        const onEvent = opts.onEvent
        if (!onEvent) {
          rejectPromise(e as Error)
          return
        }
        onEvent({
          type: 'needs-local-file',
          modId,
          artifact,
          provide: resolvePromise,
          abort: (reason) => rejectPromise(new Error(reason ?? 'Bundle cancelled')),
        })
      })
      return verifyLocalArtifact(artifact, file)
    }
  }

  // Single-mod fast path: the verified upstream zip already IS the bundle.
  if (picks.length === 1 && picks[0]!.artifact.root === picks[0]!.artifact.installAs) {
    const { mod, release, artifact } = picks[0]!
    const acquired = await acquire(mod.id, artifact)
    const urlName = artifact.url.split('/').at(-1)
    return {
      ok: true,
      blob: acquired.blob,
      filename: urlName && urlName.endsWith('.zip') ? urlName : `${mod.id}-${release.version}.zip`,
      contents: [{ id: mod.id, version: release.version }],
      via: 'original',
    }
  }

  // Multi-mod (or root≠installAs): re-pack into one zip of mod folders.
  const parts: Blob[] = []
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let zipError: Error | null = null
  const zip = new Zip((err, chunk, _final) => {
    if (err) {
      zipError = err
      return
    }
    pending.push(chunk)
    pendingBytes += chunk.byteLength
    if (pendingBytes >= BLOB_PART_BYTES) {
      parts.push(new Blob(pending as BlobPart[]))
      pending = []
      pendingBytes = 0
    }
  })

  const contents: { id: string; version: string }[] = []
  for (const { mod, release, artifact } of picks) {
    const acquired = await acquire(mod.id, artifact)
    if (normalizeSha256(acquired.sha256) !== normalizeSha256(artifact.sha256)) {
      throw new TransactionError(`Artifact for ${mod.id}@${release.version} failed verification.`)
    }
    opts.onEvent?.({ type: 'phase', phase: 'packing', modId: mod.id })

    const rootPrefix = artifact.root.replace(/\/+$/, '')
    const written: InstalledFile[] = []
    const files = await extractZipStream(acquired.blob.stream() as ReadableStream<Uint8Array>, {
      file: async (path): Promise<ZipFileWriter | null> => {
        let rel: string
        if (rootPrefix === '' || rootPrefix === '.') rel = path
        else if (path === rootPrefix) return null
        else if (path.startsWith(`${rootPrefix}/`)) rel = path.slice(rootPrefix.length + 1)
        else return null
        if (rel.length === 0) return null
        opts.onEvent?.({ type: 'file', modId: mod.id, path: rel })
        const entry = new ZipDeflate(`${artifact.installAs}/${rel}`, { level: 1 })
        zip.add(entry)
        return {
          write: (c) => {
            if (zipError) return Promise.reject(zipError)
            entry.push(c.slice(), false)
            return Promise.resolve()
          },
          close: () => {
            entry.push(new Uint8Array(0), true)
            return zipError ? Promise.reject(zipError) : Promise.resolve()
          },
          abort: () => Promise.resolve(),
        }
      },
    })

    // Per-file digests against the published manifest, exactly like install.
    opts.onEvent?.({ type: 'phase', phase: 'verifying', modId: mod.id })
    const bundled: InstalledFile[] = files
      .filter((f) => rootPrefix === '' || f.path.startsWith(`${rootPrefix}/`))
      .map((f) => ({
        path: rootPrefix === '' ? f.path : f.path.slice(rootPrefix.length + 1),
        size: f.size,
        sha256: f.sha256,
      }))
    written.push(...bundled)
    if (written.length === 0) {
      throw new TransactionError(
        `Artifact for ${mod.id}@${release.version} contained no files under its declared root "${artifact.root}".`,
      )
    }
    const manifest = await opts.manifestFor?.(artifact)
    if (manifest) verifyAgainstManifest(mod.id, written, manifest)

    contents.push({ id: mod.id, version: release.version })
  }

  zip.end()
  if (zipError) throw zipError
  if (pending.length > 0) parts.push(new Blob(pending as BlobPart[]))

  const filename =
    contents.length === 1
      ? `${contents[0]!.id}-${contents[0]!.version}.zip`
      : `ksa-mods-${contents.map((c) => c.id).join('+')}.zip`.slice(0, 100)
  return {
    ok: true,
    blob: new Blob(parts, { type: 'application/zip' }),
    filename,
    contents,
    via: 'repacked',
  }
}
