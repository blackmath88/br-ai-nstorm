import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Server tests only. They run in a plain Node environment against the real
 * application services — no browser, no React, no mocked domain.
 *
 * `cloudflare:workers` only exists inside workerd; tests that exercise the
 * Durable Object adapter get a small in-memory stand-in instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./server/test/support/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    globals: false,
  },
})
