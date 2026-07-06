/**
 * Light/dark theming (nanostores).
 *
 * The effective theme is stamped on <html data-theme="…"> (a tiny inline
 * script in index.html does the same before first paint, so there is no
 * flash of the wrong theme). The user preference is three-state:
 *
 *   system (default) → follow prefers-color-scheme, live-updating
 *   light / dark     → forced override
 *
 * Persistence deliberately breaks the "no browser state" rule for this one
 * cosmetic preference (PLAN decision 20): an override is saved to
 * localStorage, and choosing "system" REMOVES the key — absence of the key
 * IS the system setting, so a fresh browser is always in system mode.
 */

import { atom, computed } from 'nanostores'

export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'toybox.theme'

const CYCLE: readonly ThemePreference[] = ['system', 'light', 'dark']

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export const $themePreference = atom<ThemePreference>(readStoredPreference())

const $systemDark = atom<boolean>(systemQuery()?.matches ?? true)
systemQuery()?.addEventListener('change', (e) => $systemDark.set(e.matches))

export const $effectiveTheme = computed(
  [$themePreference, $systemDark],
  (preference, systemDark): EffectiveTheme =>
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference,
)

// Permanent subscription: stamp <html data-theme> on every change (and once
// at module load, matching the pre-paint script in index.html).
$effectiveTheme.subscribe((t) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
})

export function setTheme(preference: ThemePreference): void {
  $themePreference.set(preference)
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage unavailable (private mode, blocked) — the choice still
    // applies for this session.
  }
}

/** system → light → dark → system. */
export function cycleTheme(): void {
  const i = CYCLE.indexOf($themePreference.get())
  setTheme(CYCLE[(i + 1) % CYCLE.length]!)
}
