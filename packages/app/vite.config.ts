import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Served under https://meow.science.fail/toybox/ in production; also in dev.
export default defineConfig({
  base: '/toybox/',
  plugins: [
    tailwindcss(),
    react(),
    // React Compiler (flexo's setup): plugin-react@6 dropped the inline
    // `babel` option, so the compiler runs via @rolldown/plugin-babel using
    // the preset that ships with plugin-react.
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    host: '0.0.0.0',
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
