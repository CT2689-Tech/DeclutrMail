import { defineConfig } from '@playwright/test';

import { E2E_ENV } from './helpers/env';

/** Isolated API/UI journeys. See README.md for setup and the provider boundary. */
export default defineConfig({
  testDir: './specs',
  /* Serial synthetic fixtures: no real Gmail accounts or workers. */
  workers: 1,
  fullyParallel: false,
  /* Local default: no retries (a retry would mask flake — the harness
   * bar is "green twice in a row"). Opt in via --retries when triaging. */
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  /* CI additionally emits a machine-readable report so the lane can
   * assert what actually RAN — Playwright exits 0 on an all-skipped run,
   * and a required check cannot be allowed to go green on that. See
   * scripts/assert-e2e-ran.mjs. Each CI step points E2E_JSON_REPORT at
   * its own absolute path so two runs in one job do not overwrite. */
  reporter: process.env.E2E_JSON_REPORT
    ? [['list'], ['json', { outputFile: process.env.E2E_JSON_REPORT }]]
    : [['list']],
  globalSetup: './global-setup.ts',
  projects: [
    ...(process.env.E2E_PROVIDER_HARNESS === '1'
      ? [{ name: 'provider-contract', testMatch: /(?:undo|brief-noise-archive)\.spec\.ts/ }]
      : []),
    {
      name: 'default',
      testIgnore: [
        /(a11y|render|responsive)-[a-z-]+\.spec\.tsx?/,
        /(?:undo|brief-noise-archive)\.spec\.ts/,
      ],
    },
    /* Real-browser paint assertions for shared components. These serve
     * their own SSR'd page and stub endpoint, so they need no stack, no
     * database and no session — they exist because SSR markup tests
     * cannot see how an engine paints a FAILED image, which is how the
     * ADR-0034 avatar shipped broken. */
    {
      name: 'render',
      testMatch: /render-[a-z-]+\.spec\.tsx?/,
      use: { viewport: { width: 640, height: 240 } },
    },
    {
      name: 'a11y-desktop',
      testMatch: /a11y-[a-z-]+\.spec\.ts/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'a11y-mobile-reduced-motion',
      testMatch: /a11y-[a-z-]+\.spec\.ts/,
      use: {
        viewport: { width: 375, height: 812 },
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    {
      name: 'responsive-phone',
      testMatch: /responsive-[a-z-]+\.spec\.ts/,
      use: {
        // 320px remains a real lower bound for compact phones and
        // embedded browser panes. The 375px a11y project complements it.
        viewport: { width: 320, height: 568 },
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
  use: {
    baseURL: E2E_ENV.webUrl,
    storageState: E2E_ENV.storageStatePath,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    /* Real stack ≠ instant: action enqueue → worker → poll cycles.
     * Navigation headroom covers Next dev-server on-demand compiles
     * (global-setup pre-warms routes, but keep margin for re-compiles). */
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
});
