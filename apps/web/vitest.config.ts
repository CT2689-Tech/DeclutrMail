/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for `apps/web`.
 *
 *  - `environment: 'happy-dom'` — lighter than jsdom, enough surface to
 *    render @testing-library/react components and let TanStack Query
 *    do its `useEffect`/microtask choreography.
 *  - `setupFiles` wires in `@testing-library/jest-dom` matchers and
 *    installs the `fetch` stub helpers used by the API + hook tests.
 *  - `esbuild.jsx: 'automatic'` so test files can write JSX without
 *    importing React explicitly — matches the Next.js runtime config.
 *  - `resolve.alias` mirrors `tsconfig.json` so `@/foo` resolves inside
 *    test files exactly as it does at runtime.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Allow space for hooks that retry on transient errors (the sender
    // detail hook retries 5xx twice with React-Query's exponential
    // backoff — ~3s — so the default 5s timeout is too tight).
    testTimeout: 10_000,
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
