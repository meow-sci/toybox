/**
 * Shared test fixtures: build zips in memory (fflate) and synthesize index
 * documents shaped like the real compiled toybox-index output.
 */

import { zipSync } from 'fflate'
import type {
  ArtifactManifest,
  CatalogArtifact,
  CatalogMod,
  CatalogRelease,
  ToyboxIndex,
} from '../catalog/types.ts'
import { sha256Hex } from '../install/hash.ts'

export function makeZip(files: Record<string, string | Uint8Array>): {
  blob: Blob
  bytes: Uint8Array
  sha256: string
} {
  const input: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(files)) {
    input[path] = typeof content === 'string' ? new TextEncoder().encode(content) : content
  }
  const bytes = zipSync(input)
  return { blob: new Blob([bytes.slice() as unknown as BlobPart]), bytes, sha256: sha256Hex(bytes) }
}

export function manifestOfZip(
  modId: string,
  version: string,
  artifactKey: string,
  zipSha256: string,
  files: Record<string, string | Uint8Array>,
  root: string,
): ArtifactManifest {
  const out: ArtifactManifest = {
    schema: 1,
    modId,
    version,
    artifactKey,
    sha256: zipSha256,
    files: [],
  }
  for (const [path, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const rel =
      root === '' ? path : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null
    if (rel === null || rel.length === 0) continue
    out.files.push({ path: rel, size: bytes.byteLength, sha256: sha256Hex(bytes) })
  }
  return out
}

export function artifact(
  partial: Partial<CatalogArtifact> & Pick<CatalogArtifact, 'url' | 'sha256' | 'size'>,
): CatalogArtifact {
  return {
    key: 'universal',
    platforms: ['windows', 'linux', 'macos'],
    root: 'Mod',
    installAs: 'Mod',
    ...partial,
  }
}

export function release(
  version: string,
  artifacts: CatalogArtifact[],
  opts: Partial<Omit<CatalogRelease, 'version' | 'artifacts'>> = {},
): CatalogRelease {
  return {
    version,
    channel: 'stable',
    required: [],
    recommends: [],
    conflicts: [],
    artifacts,
    ...opts,
  }
}

export function mod(
  id: string,
  releases: CatalogRelease[],
  opts: Partial<Omit<CatalogMod, 'id' | 'releases'>> = {},
): CatalogMod {
  return {
    id,
    name: id,
    summary: `${id} summary`,
    authors: ['tester'],
    tags: [],
    owners: ['tester'],
    releases,
    ...opts,
  }
}

export function index(mods: CatalogMod[]): ToyboxIndex {
  return { schema: 1, generatedAt: '2026-07-05T00:00:00Z', mods }
}

/** A fetch stub keyed by exact URL. */
export function fetchStub(
  routes: Record<string, () => Response | Promise<Response>>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    return route()
  }) as typeof fetch
}

export function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function blobResponse(blob: Blob): Response {
  return new Response(blob, { status: 200 })
}
