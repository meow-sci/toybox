/**
 * Fetches and validates the compiled index and per-artifact manifests.
 *
 * The index is published by the toybox-index repo's CI to GitHub Pages,
 * which serves `Access-Control-Allow-Origin: *` — and when the app itself is
 * hosted on the same Pages origin the fetch is same-origin anyway.
 */

import type { ArtifactManifest, CatalogArtifact, ToyboxIndex } from './types.ts'
import { parseArtifactManifest, parseIndex } from './types.ts'

export const DEFAULT_INDEX_URL = 'https://meow.science.fail/toybox-index/v1/index.json'

export interface IndexClientOptions {
  indexUrl?: string
  fetchFn?: typeof fetch
}

export class IndexClient {
  readonly indexUrl: string
  private readonly fetchFn: typeof fetch

  constructor(opts: IndexClientOptions = {}) {
    this.indexUrl = opts.indexUrl ?? DEFAULT_INDEX_URL
    // Wrapped: invoking native fetch as a method of this object would
    // throw "Illegal invocation" in browsers.
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
  }

  async fetchIndex(): Promise<ToyboxIndex> {
    const res = await this.fetchFn(this.indexUrl, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`Failed to fetch index (HTTP ${res.status}) from ${this.indexUrl}`)
    return parseIndex(await res.json())
  }

  /** Manifest URLs in the index are relative to the index file. */
  resolveIndexRelative(path: string): string {
    return new URL(path, this.indexUrl).toString()
  }

  async fetchManifest(artifact: CatalogArtifact): Promise<ArtifactManifest | null> {
    if (!artifact.manifest) return null
    const url = this.resolveIndexRelative(artifact.manifest)
    const res = await this.fetchFn(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`Failed to fetch file manifest (HTTP ${res.status}) from ${url}`)
    return parseArtifactManifest(await res.json())
  }
}
