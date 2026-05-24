import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Web-app Vitest config.
 *
 * Environment is `node` — no jsdom toolchain is wired into the web
 * package yet, and the V2 plan defers wider DOM testing to the
 * Playwright E2E layer (D182/D183/D206). Component-level tests here
 * use `react-dom/server` for render + snapshot, exactly like
 * `packages/shared`. Pure handlers (e.g. the K/A/U/L key resolver in
 * `action-toolbar.tsx`) are tested directly without rendering.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
    },
  },
  // Next sets `jsx: "preserve"` in tsconfig so Next can compile JSX
  // for browser. Vitest doesn't run through Next, so we tell esbuild
  // to use the automatic JSX runtime for `.tsx` test files — the
  // same setting `packages/shared`'s tsconfig uses.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
