/**
 * Theme preference persistence: overrides live in localStorage, "system"
 * is represented by the ABSENCE of the key, and the effective theme is
 * stamped on <html data-theme>.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, theme } from './theme.svelte.ts'

beforeEach(() => {
  theme.set('system')
})

describe('theme preference', () => {
  it('persists a forced override and stamps <html data-theme>', () => {
    theme.set('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(theme.effective).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    theme.set('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(theme.effective).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('choosing system REMOVES the stored key (absence = system)', () => {
    theme.set('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    theme.set('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('system mode resolves to the platform color scheme', () => {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    expect(theme.effective).toBe(systemDark ? 'dark' : 'light')
    expect(document.documentElement.dataset.theme).toBe(theme.effective)
  })

  it('cycles system → light → dark → system', () => {
    expect(theme.preference).toBe('system')
    theme.cycle()
    expect(theme.preference).toBe('light')
    theme.cycle()
    expect(theme.preference).toBe('dark')
    theme.cycle()
    expect(theme.preference).toBe('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})
