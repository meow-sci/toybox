import { describe, expect, it } from 'vitest'
import { compareKsaVersions, ksaSatisfies, parseKsaRange, tryParseKsaVersion } from './ksa.ts'

describe('KSA versions', () => {
  it('parses and normalizes the build counter away', () => {
    const v = tryParseKsaVersion('2026.7.3.4826')!
    expect(v.year).toBe(2026)
    expect(v.month).toBe(7)
    expect(v.build).toBe(0)
    expect(v.revision).toBe(4826)
  })

  it('the (non-monotonic) build counter never affects ordering', () => {
    const a = tryParseKsaVersion('2026.7.99.4826')!
    const b = tryParseKsaVersion('2026.7.1.4826')!
    expect(compareKsaVersions(a, b)).toBe(0)
  })

  it('orders by year, month, then revision', () => {
    const a = tryParseKsaVersion('2026.6.1.4700')!
    const b = tryParseKsaVersion('2026.7.1.4750')!
    const c = tryParseKsaVersion('2026.7.1.4826')!
    expect(compareKsaVersions(a, b)).toBe(-1)
    expect(compareKsaVersions(b, c)).toBe(-1)
  })

  it('month-level ranges compare at month specificity', () => {
    const v = tryParseKsaVersion('2026.7.3.4826')!
    expect(ksaSatisfies(v, parseKsaRange('>=2026.7'))).toBe(true)
    expect(ksaSatisfies(v, parseKsaRange('>=2026.8'))).toBe(false)
    expect(ksaSatisfies(v, parseKsaRange('2026.7'))).toBe(true)
    expect(ksaSatisfies(v, parseKsaRange('>=2026.6 <=2026.7'))).toBe(true)
  })

  it('revision-level ranges compare fully', () => {
    const v = tryParseKsaVersion('2026.7.3.4826')!
    expect(ksaSatisfies(v, parseKsaRange('>=2026.7.0.4750'))).toBe(true)
    expect(ksaSatisfies(v, parseKsaRange('>=2026.7.0.4900'))).toBe(false)
  })

  it('* matches everything', () => {
    const v = tryParseKsaVersion('2025.11.1.100')!
    expect(ksaSatisfies(v, parseKsaRange('*'))).toBe(true)
  })
})
