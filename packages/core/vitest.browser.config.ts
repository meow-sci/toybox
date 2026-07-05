import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Real-browser suite: the engine exercised against genuine
 * FileSystemDirectoryHandle objects (OPFS) in headless Chromium — the same
 * FSA API surface a user grant provides, without permission prompts.
 *
 * CHROMIUM_EXECUTABLE overrides the browser binary for environments with a
 * system-provided Chromium instead of the Playwright-managed download.
 */
const executablePath = process.env.CHROMIUM_EXECUTABLE

export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: executablePath ? { executablePath } : {},
      }),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
})
