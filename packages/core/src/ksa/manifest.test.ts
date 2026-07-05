import { describe, expect, it } from 'vitest'
import {
  parseManifest,
  parseTomlScalar,
  serializeManifest,
  setEnabled,
  syncManifest,
} from './manifest.ts'

describe('parseManifest', () => {
  it('parses [[mods]] entries with defaults', () => {
    const entries = parseManifest(
      '[[mods]]\nid = "Core"\n\n[[mods]]\nid = "purrTTY"\nenabled = false\n',
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ id: 'Core', enabled: true })
    expect(entries[1]).toMatchObject({ id: 'purrTTY', enabled: false })
  })

  it('round-trips unknown keys verbatim', () => {
    const text = '[[mods]]\nid = "gatOS"\nenabled = true\nfutureKey = 42\n'
    const entries = parseManifest(text)
    expect(entries[0]!.extraLines).toEqual(['futureKey = 42'])
    const out = serializeManifest(entries)
    expect(out).toContain('futureKey = 42')
    expect(parseManifest(out)).toEqual(entries)
  })

  it('handles quoting forms and inline comments', () => {
    expect(parseTomlScalar('"a\\"b"')).toBe('a"b')
    expect(parseTomlScalar("'literal'")).toBe('literal')
    expect(parseTomlScalar('true # note')).toBe('true')
    expect(parseTomlScalar('"quoted" # note')).toBe('quoted')
  })
})

describe('syncManifest', () => {
  const base = parseManifest(
    '[[mods]]\nid = "Core"\nenabled = true\n\n[[mods]]\nid = "purrTTY"\nenabled = false\n',
  )

  it('adds entries for new folders as enabled', () => {
    const r = syncManifest(base, ['Core', 'purrTTY', 'gatOS'], ['gatOS'])
    expect(r.added).toEqual(['gatOS'])
    expect(r.entries.find((e) => e.id === 'gatOS')).toMatchObject({ enabled: true })
  })

  it('never flips an existing enabled flag', () => {
    const r = syncManifest(base, ['Core', 'purrTTY'], ['purrTTY'])
    expect(r.entries.find((e) => e.id === 'purrTTY')!.enabled).toBe(false)
    expect(r.changed).toBe(false)
  })

  it('prunes managed folders that disappeared, keeps unmanaged ones', () => {
    const withGhosts = parseManifest(
      '[[mods]]\nid = "Core"\n\n[[mods]]\nid = "gatOS"\n\n[[mods]]\nid = "HandMade"\n',
    )
    const r = syncManifest(withGhosts, ['Core'], ['gatOS'])
    expect(r.removed).toEqual(['gatOS'])
    expect(r.entries.map((e) => e.id)).toEqual(['Core', 'HandMade'])
  })
})

describe('setEnabled', () => {
  it('flips only the target entry (case-insensitive)', () => {
    const entries = parseManifest('[[mods]]\nid = "purrTTY"\nenabled = true\n')
    const out = setEnabled(entries, 'purrtty', false)
    expect(out[0]!.enabled).toBe(false)
  })
})
