/**
 * Catalog-only helpers: everything a frontend needs to browse, search, and
 * pick artifacts WITHOUT a filesystem grant. Used by the Toybox facade and
 * directly by browsers that lack the File System Access API (catalog mode),
 * where the app still browses/resolves fully and hands the user a bundle
 * download instead of installing.
 */

import { fuzzySearch, type SearchResult } from '../search/fuzzy.ts'
import { sortVersionsDescending } from '../version/semver.ts'
import type { CatalogArtifact, CatalogMod, CatalogRelease, Platform } from './types.ts'

/** Fuzzy search across id/name/tags/summary/authors, ranked. */
export function searchMods(mods: readonly CatalogMod[], query: string): SearchResult<CatalogMod>[] {
  return fuzzySearch(query, mods, (m) => [
    { text: m.id, weight: 3 },
    { text: m.name, weight: 3 },
    { text: m.tags.join(' '), weight: 2 },
    { text: m.summary, weight: 1.5 },
    { text: m.authors.join(' '), weight: 1 },
  ])
}

/** Releases of a mod that have an artifact for the platform, newest first. */
export function eligibleReleases(mod: CatalogMod, platform: Platform): CatalogRelease[] {
  const order = sortVersionsDescending(mod.releases.map((r) => r.version))
  const byVersion = new Map(mod.releases.map((r) => [r.version, r] as const))
  return order
    .map((v) => byVersion.get(v)!)
    .filter((r) => r.artifacts.some((a) => a.platforms.includes(platform)))
}

export function artifactForPlatform(
  release: CatalogRelease,
  platform: Platform,
): CatalogArtifact | null {
  return release.artifacts.find((a) => a.platforms.includes(platform)) ?? null
}

/**
 * The mod's folder inside the published index (`mods/<slug>/`), derived from
 * any of its convention-based file paths. Used for "browse this mod in the
 * index" links; always ends with '/'. Null when the mod carries no
 * convention paths (e.g. an index compiled with --skip-artifacts and no
 * readme).
 */
export function modIndexFolder(mod: CatalogMod): string | null {
  const candidates = [
    mod.readmePath,
    ...mod.releases.flatMap((r) => r.artifacts.flatMap((a) => [a.manifest, a.mirror])),
  ]
  for (const path of candidates) {
    if (!path) continue
    const m = /^(mods\/[^/]+\/)/.exec(path)
    if (m) return m[1]!
  }
  return null
}
