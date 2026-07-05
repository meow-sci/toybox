import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate } from './format.ts'

describe('formatBytes', () => {
  it('picks sensible units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(24367747)).toBe('23.2 MB')
    expect(formatBytes(3_500_000_000)).toBe('3.26 GB')
  })
})

describe('formatDate', () => {
  it('formats ISO dates and tolerates junk', () => {
    expect(formatDate('2026-07-04T16:21:00Z')).toContain('2026')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('garbage')).toBe('garbage')
  })
})
