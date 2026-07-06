<script lang="ts">
  import { theme } from '../lib/theme.svelte.ts'

  const label = $derived(
    theme.preference === 'system' ? '🌓 auto' : theme.preference === 'light' ? '☀️ light' : '🌙 dark',
  )
  const title = $derived(
    theme.preference === 'system'
      ? `Theme: following your system (${theme.effective}) — click to force light`
      : theme.preference === 'light'
        ? 'Theme: forced light — click to force dark'
        : 'Theme: forced dark — click to follow your system',
  )
</script>

<button class="small theme-toggle" {title} aria-label="Toggle color theme" onclick={() => theme.cycle()}>
  {label}
</button>

<style>
  .theme-toggle {
    white-space: nowrap;
  }
</style>
