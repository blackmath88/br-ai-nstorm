import { defineConfig } from 'vitest/config'

/**
 * Server tests only. They run in a plain Node environment against the real
 * application services — no browser, no React, no mocked domain.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    globals: false,
  },
})
