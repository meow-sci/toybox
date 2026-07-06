import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzySearch, matchToken } from './fuzzy.ts'

describe('matchToken', () => {
  it('matches exact substrings strongly', () => {
    expect(matchToken('purr', 'purrTTY')).not.toBeNull()
    expect(matchToken('purr', 'gatOS')).toBeNull()
  })

  it('matches subsequences', () => {
    expect(matchToken('ptty', 'purrTTY')).not.toBeNull()
  })

  it('is case-insensitive', () => {
    expect(matchToken('GATOS', 'gatOS')).not.toBeNull()
  })

  it('prefers word-boundary matches', () => {
    const boundary = matchToken('term', 'terminal emulator')!
    const buried = matchToken('term', 'not-a-xtermz')!
    expect(boundary.score).toBeGreaterThan(buried.score)
  })

  it('returns match positions for highlighting', () => {
    const m = matchToken('gat', 'gatOS')!
    expect(m.positions).toEqual([0, 1, 2])
  })

  it('rejects when query is longer than text', () => {
    expect(matchToken('abcdef', 'abc')).toBeNull()
  })
})

describe('fuzzyMatch', () => {
  const fields = (id: string, summary: string) => [
    { text: id, weight: 3 },
    { text: summary, weight: 1 },
  ]

  it('requires all tokens to match', () => {
    expect(fuzzyMatch('terminal linux', fields('purrTTY', 'a terminal emulator'))).toBeNull()
    expect(fuzzyMatch('terminal emu', fields('purrTTY', 'a terminal emulator'))).not.toBeNull()
  })

  it('weights id hits above summary hits', () => {
    const idHit = fuzzyMatch('purr', fields('purrTTY', 'something'))!
    const summaryHit = fuzzyMatch('purr', fields('other', 'purring things'))!
    expect(idHit.score).toBeGreaterThan(summaryHit.score)
  })

  it('empty query matches everything with zero score', () => {
    expect(fuzzyMatch('', fields('a', 'b'))).toEqual({ score: 0, positions: [], fieldIndex: 0 })
  })
})

describe('fuzzySearch', () => {
  const mods = [
    { id: 'purrTTY', summary: 'A terminal emulator for KSA' },
    { id: 'gatOS', summary: 'Alpine Linux in a QEMU microVM with /sim telemetry' },
    { id: 'StarThing', summary: 'terminal decorations' },
  ]
  const fieldsOf = (m: (typeof mods)[number]) =>
    [
      { text: m.id, weight: 3 },
      { text: m.summary, weight: 1 },
    ] as const

  it('ranks by score descending', () => {
    const results = fuzzySearch('terminal', mods, fieldsOf)
    expect(results.length).toBe(2)
    expect(results.map((r) => r.item.id)).toContain('purrTTY')
    expect(results.map((r) => r.item.id)).toContain('StarThing')
  })

  it('finds by id fragment', () => {
    const results = fuzzySearch('gatos', mods, fieldsOf)
    expect(results[0]!.item.id).toBe('gatOS')
  })

  it('empty query returns all items', () => {
    expect(fuzzySearch('', mods, fieldsOf).length).toBe(3)
  })
})
