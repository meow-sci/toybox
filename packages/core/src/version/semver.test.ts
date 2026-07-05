import { describe, expect, it } from 'vitest'
import {
  compareVersionStrings,
  parseVersion,
  satisfiesString,
  sortVersionsDescending,
  tryParseVersion,
} from './semver.ts'

describe('parseVersion', () => {
  it('parses full versions', () => {
    const v = parseVersion('1.2.3')
    expect([v.major, v.minor, v.patch]).toEqual([1, 2, 3])
    expect(v.prerelease).toEqual([])
  })

  it('parses prereleases with numeric identifiers', () => {
    const v = parseVersion('0.1.0-tip.20260703')
    expect(v.prerelease).toEqual(['tip', 20260703])
  })

  it('accepts loose versions and v-prefix', () => {
    expect(parseVersion('1.2').patch).toBe(0)
    expect(parseVersion('v1.0.1').minor).toBe(0)
  })

  it('ignores build metadata', () => {
    expect(compareVersionStrings('1.0.0+abc', '1.0.0+def')).toBe(0)
  })

  it('rejects garbage', () => {
    expect(tryParseVersion('not-a-version')).toBeNull()
    expect(tryParseVersion('1.2.3.4')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by components', () => {
    expect(compareVersionStrings('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersionStrings('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersionStrings('2.0.0', '10.0.0')).toBe(-1)
  })

  it('release beats its prereleases', () => {
    expect(compareVersionStrings('1.0.0', '1.0.0-rc.1')).toBe(1)
  })

  it('orders prerelease identifiers per spec', () => {
    expect(compareVersionStrings('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersionStrings('1.0.0-alpha.1', '1.0.0-beta')).toBe(-1)
    expect(compareVersionStrings('1.0.0-1', '1.0.0-alpha')).toBe(-1) // numeric < alpha
    expect(compareVersionStrings('1.0.0-2', '1.0.0-10')).toBe(-1)
  })
})

describe('ranges', () => {
  it('* matches releases but not prereleases', () => {
    expect(satisfiesString('1.2.3', '*')).toBe(true)
    expect(satisfiesString('1.2.3-rc.1', '*')).toBe(false)
    expect(satisfiesString('1.2.3-rc.1', '*', { includePrerelease: true })).toBe(true)
  })

  it('caret ranges follow the leftmost-nonzero rule', () => {
    expect(satisfiesString('1.9.0', '^1.2.3')).toBe(true)
    expect(satisfiesString('2.0.0', '^1.2.3')).toBe(false)
    expect(satisfiesString('0.2.9', '^0.2.3')).toBe(true)
    expect(satisfiesString('0.3.0', '^0.2.3')).toBe(false)
    expect(satisfiesString('0.0.4', '^0.0.3')).toBe(false)
  })

  it('tilde allows patch drift only', () => {
    expect(satisfiesString('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfiesString('1.3.0', '~1.2.3')).toBe(false)
  })

  it('comparator conjunctions AND together', () => {
    expect(satisfiesString('1.5.0', '>=1.0 <2.0')).toBe(true)
    expect(satisfiesString('2.0.0', '>=1.0 <2.0')).toBe(false)
  })

  it('|| alternatives OR together', () => {
    expect(satisfiesString('0.9.0', '^0.9 || ^1.2')).toBe(true)
    expect(satisfiesString('1.5.0', '^0.9 || ^1.2')).toBe(true)
    expect(satisfiesString('1.1.0', '^0.9 || ^1.2')).toBe(false)
  })

  it('wildcard and partial versions', () => {
    expect(satisfiesString('1.4.2', '1.x')).toBe(true)
    expect(satisfiesString('2.0.0', '1.x')).toBe(false)
    expect(satisfiesString('1.2.9', '1.2')).toBe(true)
    expect(satisfiesString('1.3.0', '1.2')).toBe(false)
  })

  it('hyphen ranges are inclusive', () => {
    expect(satisfiesString('1.5.0', '1.2.3 - 2.0.0')).toBe(true)
    expect(satisfiesString('2.0.0', '1.2.3 - 2.0.0')).toBe(true)
    expect(satisfiesString('2.0.1', '1.2.3 - 2.0.0')).toBe(false)
  })

  it('exact match', () => {
    expect(satisfiesString('1.0.1', '=1.0.1')).toBe(true)
    expect(satisfiesString('1.0.2', '=1.0.1')).toBe(false)
  })

  it('prerelease anchoring: only same-triple ranges admit prereleases', () => {
    expect(satisfiesString('1.0.0-rc.2', '>=1.0.0-rc.1')).toBe(true)
    expect(satisfiesString('1.1.0-rc.1', '>=1.0.0-rc.1')).toBe(false)
  })
})

describe('sortVersionsDescending', () => {
  it('sorts newest first', () => {
    expect(sortVersionsDescending(['1.0.0', '1.1.0', '1.0.1'])).toEqual(['1.1.0', '1.0.1', '1.0.0'])
  })
})
