/**
 * Light/dark theming.
 *
 * The effective theme is stamped on <html data-theme="…"> (a tiny inline
 * script in index.html does the same before first paint, so there is no
 * flash of the wrong theme). The user preference is three-state:
 *
 *   system (default) → follow prefers-color-scheme, live-updating
 *   light / dark     → forced override
 *
 * Persistence deliberately breaks the "no browser state" rule for this one
 * cosmetic preference (per explicit design decision): an override is saved
 * to localStorage, and choosing "system" REMOVES the key — absence of the
 * key IS the system setting, so a fresh browser is always in system mode.
 */

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

class ThemeStore {
  preference = $state<ThemePreference>(readStoredPreference())
  private systemDark = $state(systemQuery()?.matches ?? true)

  constructor() {
    systemQuery()?.addEventListener('change', (e) => {
      this.systemDark = e.matches
      this.apply()
    })
    this.apply()
  }

  get effective(): EffectiveTheme {
    if (this.preference === 'system') return this.systemDark ? 'dark' : 'light'
    return this.preference
  }

  set(preference: ThemePreference): void {
    this.preference = preference
    try {
      if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Storage unavailable (private mode, blocked) — the choice still
      // applies for this session.
    }
    this.apply()
  }

  /** system → light → dark → system. */
  cycle(): void {
    const i = CYCLE.indexOf(this.preference)
    this.set(CYCLE[(i + 1) % CYCLE.length]!)
  }

  private apply(): void {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = this.effective
  }
}

export const theme = new ThemeStore()
