import { defineConfig } from 'vitest/config';

/**
 * apps/api vitest config — `testTimeout`/`hookTimeout` raised because
 * many read-service specs spin up PGlite + apply every migration per
 * `it()`. PGlite 0.4 (bumped from 0.2 in the deps group) made the
 * fixture setup slower on CI than the 10s default `hookTimeout`
 * budget. Mirrors `packages/workers` + `packages/db`.
 */
export default defineConfig({
  // Vite 8 transforms via Oxc. Nest DI tests (and Nest itself) need
  // legacy parameter decorators + `design:paramtypes`. The class-field
  // assumptions match Nest's own vitest config so `@Optional`/`@Inject`
  // stay on the constructor instead of being rewritten as TC39 fields.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
    assumptions: {
      setPublicClassFields: true,
    },
    typescript: {
      removeClassFieldsWithoutInitializer: true,
    },
  },
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
