import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Served under https://meow.science.fail/toybox/ in production; also in dev.
export default defineConfig({
  base: '/toybox/',
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
