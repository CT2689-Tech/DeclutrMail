import { defineConfig } from 'vitest/config';

/**
 * apps/api vitest config — `testTimeout`/`hookTimeout` raised because
 * many read-service specs spin up PGlite + apply every migration per
 * `it()`. PGlite 0.4 (bumped from 0.2 in the deps group) made the
 * fixture setup slower on CI than the 10s default `hookTimeout`
 * budget. Mirrors `packages/workers` + `packages/db`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
