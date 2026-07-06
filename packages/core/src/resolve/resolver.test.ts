import { describe, expect, it } from 'vitest'
import type { Platform } from '../catalog/types.ts'
import { artifact, index, mod, release } from '../testing/fixtures.ts'
import { resolve, type ResolveRequest } from './resolver.ts'

const art = (over: Partial<Parameters<typeof artifact>[0]> = {}) =>
  artifact({ url: 'https://example.com/a.zip', sha256: 'a'.repeat(64), size: 100, ...over })

const baseRequest = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  install: [],
  remove: [],
  installed: {},
  platform: 'windows' as Platform,
  ...over,
})

describe('resolve: basics', () => {
  it('installs the newest stable release', () => {
    const idx = index([mod('A', [release('1.0.0', [art()]), release('1.1.0', [art()])])])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target.A!.version).toBe('1.1.0')
      expect(r.changes).toEqual([
        expect.objectContaining({ kind: 'install', id: 'A', version: '1.1.0' }),
      ])
    }
  })

  it('skips prereleases unless opted in', () => {
    const idx = index([
      mod('A', [
        release('1.0.0', [art()]),
        release('1.1.0-rc.1', [art()], { channel: 'prerelease' }),
      ]),
    ])
    const stable = resolve(idx, baseRequest({ install: [{ id: 'A' }] }))
    expect(stable.ok && stable.target.A!.version).toBe('1.0.0')
    const pre = resolve(idx, baseRequest({ install: [{ id: 'A' }], includePrerelease: true }))
    expect(pre.ok && pre.target.A!.version).toBe('1.1.0-rc.1')
  })

  it('respects a requested version pin', () => {
    const idx = index([mod('A', [release('1.0.0', [art()]), release('1.1.0', [art()])])])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A', range: '=1.0.0' }] }))
    expect(r.ok && r.target.A!.version).toBe('1.0.0')
  })

  it('filters releases without an artifact for the platform', () => {
    const idx = index([
      mod('A', [
        release('1.1.0', [art({ platforms: ['linux'] })]),
        release('1.0.0', [art({ platforms: ['windows', 'linux'] })]),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }], platform: 'windows' }))
    expect(r.ok && r.target.A!.version).toBe('1.0.0')
  })

  it('filters releases incompatible with the game version and explains it', () => {
    const idx = index([
      mod('A', [
        release('2.0.0', [art()], { ksa: '>=2026.8' }),
        release('1.0.0', [art()], { ksa: '>=2026.6' }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }], ksaVersion: '2026.7.3.4826' }))
    expect(r.ok && r.target.A!.version).toBe('1.0.0')

    const fail = resolve(
      idx,
      baseRequest({ install: [{ id: 'A', range: '=2.0.0' }], ksaVersion: '2026.7.3.4826' }),
    )
    expect(fail.ok).toBe(false)
    if (!fail.ok) expect(fail.explanation).toContain('requires KSA >=2026.8')
  })

  it('fails with a clear message for unknown mods', () => {
    const r = resolve(index([]), baseRequest({ install: [{ id: 'Ghost' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.explanation).toContain('"Ghost" is not in the index')
  })
})

describe('resolve: dependencies', () => {
  const purrtty = mod('purrTTY', [release('1.0.1', [art()]), release('1.1.0', [art()])])

  it('pulls required dependencies automatically, marked autoInstalled', () => {
    const idx = index([
      purrtty,
      mod('NeedsTerm', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '^1.0', optional: false }],
        }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'NeedsTerm' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target.purrTTY!.version).toBe('1.1.0')
      expect(r.target.purrTTY!.autoInstalled).toBe(true)
      expect(r.target.NeedsTerm!.autoInstalled).toBe(false)
    }
  })

  it('does NOT auto-install optional dependencies (StarMap semantics)', () => {
    const idx = index([
      purrtty,
      mod('gatOS', [
        release('1.1.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '^1.0', optional: true }],
        }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'gatOS' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.target.purrTTY).toBeUndefined()
  })

  it('warns when an installed optional dependency version mismatches', () => {
    const idx = index([
      mod('purrTTY', [release('2.0.0', [art()])]),
      mod('gatOS', [
        release('1.1.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '^1.0', optional: true }],
        }),
      ]),
    ])
    const r = resolve(
      idx,
      baseRequest({
        install: [{ id: 'gatOS' }],
        installed: { purrTTY: { version: '2.0.0', autoInstalled: false } },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => w.id === 'purrTTY')).toBe(true)
    }
  })

  it('backtracks to an older version to satisfy shared constraints', () => {
    const idx = index([
      mod('Lib', [release('1.0.0', [art()]), release('2.0.0', [art()])]),
      mod('A', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'Lib', range: '^1.0', optional: false }],
        }),
      ]),
      mod('B', [
        release('1.0.0', [art()], { dependencies: [{ id: 'Lib', range: '*', optional: false }] }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'B' }, { id: 'A' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.target.Lib!.version).toBe('1.0.0')
  })

  it('explains an impossible version intersection with the full chain', () => {
    const idx = index([
      mod('Lib', [release('1.0.0', [art()]), release('2.0.0', [art()])]),
      mod('A', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'Lib', range: '^1.0', optional: false }],
        }),
      ]),
      mod('B', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'Lib', range: '^2.0', optional: false }],
        }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }, { id: 'B' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.explanation).toContain('Lib')
      expect(r.explanation).toContain('A@1.0.0')
      expect(r.explanation).toContain('B@1.0.0')
      expect(r.explanation).toContain('^1.0')
      expect(r.explanation).toContain('^2.0')
    }
  })

  it('resolves transitive chains', () => {
    const idx = index([
      mod('C', [release('1.0.0', [art()])]),
      mod('B', [
        release('1.0.0', [art()], { dependencies: [{ id: 'C', range: '*', optional: false }] }),
      ]),
      mod('A', [
        release('1.0.0', [art()], { dependencies: [{ id: 'B', range: '*', optional: false }] }),
      ]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.target).sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('resolve: conflicts', () => {
  it('honors declared conflicts both directions with the reason', () => {
    const idx = index([
      mod('A', [
        release('1.0.0', [art()], {
          conflicts: [{ id: 'B', range: '*', reason: 'both patch the same renderer' }],
        }),
      ]),
      mod('B', [release('1.0.0', [art()])]),
    ])
    const r = resolve(idx, baseRequest({ install: [{ id: 'A' }, { id: 'B' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.explanation).toContain('both patch the same renderer')
  })
})

describe('resolve: installed set, upgrades, removals', () => {
  const purrtty = mod('purrTTY', [release('1.0.1', [art()]), release('1.1.0', [art()])])

  it('keep policy pins installed mods', () => {
    const idx = index([purrtty])
    const r = resolve(
      idx,
      baseRequest({ installed: { purrTTY: { version: '1.0.1', autoInstalled: false } } }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target.purrTTY!.version).toBe('1.0.1')
      expect(r.changes).toEqual([])
    }
  })

  it('upgrade policy moves to the newest compatible version', () => {
    const idx = index([purrtty])
    const r = resolve(
      idx,
      baseRequest({
        policy: 'upgrade',
        installed: { purrTTY: { version: '1.0.1', autoInstalled: false } },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.changes).toEqual([
        expect.objectContaining({ kind: 'upgrade', id: 'purrTTY', from: '1.0.1', to: '1.1.0' }),
      ])
    }
  })

  it('blocks removal of a mod something else requires, with the requirer named', () => {
    const idx = index([
      mod('purrTTY', [release('1.1.0', [art()])]),
      mod('NeedsTerm', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '*', optional: false }],
        }),
      ]),
    ])
    const r = resolve(
      idx,
      baseRequest({
        remove: ['purrTTY'],
        installed: {
          purrTTY: { version: '1.1.0', autoInstalled: false },
          NeedsTerm: { version: '1.0.0', autoInstalled: false },
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.explanation).toContain('marked for removal')
      expect(r.explanation).toContain('NeedsTerm')
    }
  })

  it('removes orphaned auto-installed dependencies with the removal', () => {
    const idx = index([
      mod('purrTTY', [release('1.1.0', [art()])]),
      mod('NeedsTerm', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '*', optional: false }],
        }),
      ]),
    ])
    const r = resolve(
      idx,
      baseRequest({
        remove: ['NeedsTerm'],
        installed: {
          purrTTY: { version: '1.1.0', autoInstalled: true },
          NeedsTerm: { version: '1.0.0', autoInstalled: false },
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      const removed = r.changes.filter((c) => c.kind === 'remove').map((c) => c.id)
      expect(removed.sort()).toEqual(['NeedsTerm', 'purrTTY'])
    }
  })

  it('keeps auto-installed deps that are still required by something', () => {
    const idx = index([
      mod('purrTTY', [release('1.1.0', [art()])]),
      mod('X', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '*', optional: false }],
        }),
      ]),
      mod('Y', [
        release('1.0.0', [art()], {
          dependencies: [{ id: 'purrTTY', range: '*', optional: false }],
        }),
      ]),
    ])
    const r = resolve(
      idx,
      baseRequest({
        remove: ['X'],
        installed: {
          purrTTY: { version: '1.1.0', autoInstalled: true },
          X: { version: '1.0.0', autoInstalled: false },
          Y: { version: '1.0.0', autoInstalled: false },
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      const removed = r.changes.filter((c) => c.kind === 'remove').map((c) => c.id)
      expect(removed).toEqual(['X'])
    }
  })

  it('leaves unknown (unindexed) installed mods alone', () => {
    const idx = index([mod('A', [release('1.0.0', [art()])])])
    const r = resolve(
      idx,
      baseRequest({
        install: [{ id: 'A' }],
        installed: { HandRolled: { version: '0.0.1', autoInstalled: false } },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target.HandRolled).toBeUndefined()
      expect(r.changes.some((c) => c.kind === 'remove')).toBe(false)
    }
  })
})
