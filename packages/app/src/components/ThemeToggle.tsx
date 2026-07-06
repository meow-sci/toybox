import { useStore } from '@nanostores/react'
import { Moon, SunMedium, SunMoon } from 'lucide-react'
import { Button } from '../ui/kit'
import { $effectiveTheme, $themePreference, cycleTheme } from '../state/theme.ts'

export function ThemeToggle() {
  const preference = useStore($themePreference)
  const effective = useStore($effectiveTheme)

  const title =
    preference === 'system'
      ? `Theme: following your system (${effective}) — click to force light`
      : preference === 'light'
        ? 'Theme: forced light — click to force dark'
        : 'Theme: forced dark — click to follow your system'

  return (
    <Button size="sm" variant="ghost" aria-label="Toggle color theme" onPress={cycleTheme}>
      {preference === 'system' ? (
        <SunMoon size={14} />
      ) : preference === 'light' ? (
        <SunMedium size={14} />
      ) : (
        <Moon size={14} />
      )}
      <span title={title}>{preference === 'system' ? 'auto' : preference}</span>
    </Button>
  )
}
