/**
 * The catalog shows EVERY version to EVERY user: release listings are
 * never filtered by host-OS detection. (Platform eligibility only gates
 * installation, in the resolver.)
 */

import { describe, expect, it } from 'vitest'
import type { CatalogMod } from '@toybox/core'
import { sortedReleases } from './appStore.ts'

const gatosLike: CatalogMod = {
  id: 'gatOS',
  name: 'gatOS',
  summary: 's',
  authors: [],
  tags: [],
  owners: [],
  releases: ['1.0.1', '1.1.0', '1.0.0'].map((version) => ({
    version,
    channel: 'stable' as const,
    required: [],
    recommends: [],
    conflicts: [],
    // windows/linux only — exactly the gatOS shape that used to vanish on macOS
    artifacts: [
      {
        key: 'windows',
        platforms: ['windows' as const],
        url: 'https://example.com/w.zip',
        size: 1,
        sha256: 'a'.repeat(64),
        root: 'gatOS',
        installAs: 'gatOS',
      },
      {
        key: 'linux',
        platforms: ['linux' as const],
        url: 'https://example.com/l.zip',
        size: 1,
        sha256: 'b'.repeat(64),
        root: 'gatOS',
        installAs: 'gatOS',
      },
    ],
  })),
}

describe('sortedReleases', () => {
  it('lists every version newest-first with NO platform filter', () => {
    expect(sortedReleases(gatosLike).map((r) => r.version)).toEqual(['1.1.0', '1.0.1', '1.0.0'])
  })

  it('keeps releases even when NO artifact matches any given platform', () => {
    // A macOS user sees the same three versions a Windows user does.
    const releases = sortedReleases(gatosLike)
    expect(releases).toHaveLength(3)
    expect(releases.every((r) => r.artifacts.every((a) => !a.platforms.includes('macos')))).toBe(
      true,
    )
  })
})
