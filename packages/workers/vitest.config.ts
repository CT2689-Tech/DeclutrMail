import { defineConfig } from 'vitest/config';

/**
 * Workers vitest config — mirrors `packages/db` (30s testTimeout) because
 * the integration tests in this package (outbox-dispatcher, initial-sync,
 * undo-expiry) all spin up PGlite + apply every migration per `it()`,
 * which can comfortably exceed vitest's 5s default on CI. Internal
 * deadlines inside each test (e.g. the 2s wake-up window in the LISTEN
 * test) remain tight and are what actually catch regressions; this
 * envelope just absorbs fixture overhead. See MISTAKES.md 2026-05-26.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
