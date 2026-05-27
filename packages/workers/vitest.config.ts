import { defineConfig } from 'vitest/config';

/**
 * Workers vitest config — mirrors `packages/db` (30s testTimeout) because
 * the integration tests in this package (outbox-dispatcher, initial-sync,
 * undo-expiry) all spin up PGlite + apply every migration per `it()`,
 * which can comfortably exceed vitest's 5s default on CI. Internal
 * deadlines inside each test (e.g. the 2s wake-up window in the LISTEN
 * test) remain tight and are what actually catch regressions; this
 * envelope just absorbs fixture overhead. See MISTAKES.md 2026-05-26.
 *
 * `hookTimeout` mirrors `testTimeout` because PGlite 0.4 (bumped from
 * 0.2 in the deps group) made `beforeEach` slower on CI runners — the
 * default 10s budget no longer covers the migration replay.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
