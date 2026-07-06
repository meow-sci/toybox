/**
 * Theme preference persistence: overrides live in localStorage, "system"
 * is represented by the ABSENCE of the key, and the effective theme is
 * stamped on <html data-theme>.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  $effectiveTheme,
  $themePreference,
  THEME_STORAGE_KEY,
  cycleTheme,
  setTheme,
} from './theme.ts'

beforeEach(() => {
  setTheme('system')
})

describe('theme preference', () => {
  it('persists a forced override and stamps <html data-theme>', () => {
    setTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect($effectiveTheme.get()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect($effectiveTheme.get()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('choosing system REMOVES the stored key (absence = system)', () => {
    setTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    setTheme('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('system mode resolves to the platform color scheme', () => {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    expect($effectiveTheme.get()).toBe(systemDark ? 'dark' : 'light')
    expect(document.documentElement.dataset.theme).toBe($effectiveTheme.get())
  })

  it('cycles system → light → dark → system', () => {
    expect($themePreference.get()).toBe('system')
    cycleTheme()
    expect($themePreference.get()).toBe('light')
    cycleTheme()
    expect($themePreference.get()).toBe('dark')
    cycleTheme()
    expect($themePreference.get()).toBe('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})
