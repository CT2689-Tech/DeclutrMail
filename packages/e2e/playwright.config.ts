import { defineConfig } from '@playwright/test';

import { E2E_ENV, loadRootEnvLocal } from './helpers/env';

/**
 * Playwright e2e harness (D183) — runs the three golden specs against a
 * REAL local stack (web + api + worker + redis + postgres). Nothing is
 * mocked: specs drive the browser through the D226 lifecycle
 * (intent → sheet → preview → mutation → undo) and assert
 * server-confirmed state.
 *
 * ## How to run
 *
 * 1. One-time: install the browser binary
 *
 *        pnpm --filter @declutrmail/e2e e2e:install
 *
 * 2. Boot the full local stack. Either `./scripts/dev-up.sh` (default
 *    ports 4000/3000 — then set the env overrides below to match), or
 *    manually on dedicated ports:
 *
 *        docker compose up -d redis
 *        PORT=4104 REDIS_URL=redis://localhost:6379/4 RATE_LIMIT_ENABLED=false \
 *          pnpm --filter @declutrmail/api start
 *        PORT=8180 REDIS_URL=redis://localhost:6379/4 pnpm --filter @declutrmail/api worker
 *        PORT=3104 NEXT_PUBLIC_API_URL=http://localhost:4104 pnpm --filter @declutrmail/web dev
 *
 *    The api AND the worker must share the same REDIS_URL — the api
 *    enqueues BullMQ jobs (archive/undo/outbox wake) that the worker
 *    consumes. The worker is REQUIRED: action execution, undo reversal
 *    and the keep-policy outbox projection all run there. Its PORT is
 *    the Cloud Run health probe port (default 8080 — collides with a
 *    second local worker). `RATE_LIMIT_ENABLED=false` uses the
 *    limiter's documented dev fail-open: a full suite run bursts past
 *    the human-paced token buckets (read 429s are designed states the
 *    FE renders as errors, which would fail the specs by design).
 *
 * 3. Run the specs (from repo root):
 *
 *        pnpm e2e          # headless
 *        pnpm e2e:ui       # Playwright UI mode
 *
 * ## Env knobs
 *
 *   - `E2E_WEB_URL`  — web base URL    (default http://localhost:3104)
 *   - `E2E_API_URL`  — api base URL    (default http://localhost:4104)
 *   - `E2E_LOGIN_EMAIL` — dev-login user (default chintan.a.thakkar@gmail.com)
 *   - `DATABASE_URL` — read from repo-root `.env.local` automatically;
 *     used by spec setup/teardown to pick safe target senders and to
 *     restore every row the specs mutate (shared dev DB — leave no trace).
 *
 * Auth: `global-setup.ts` hits the D206 dev test-login
 * (`GET /api/auth/dev/login?email=…` — requires `DEV_AUTH_ENABLED=true`
 * + `DEV_AUTH_EMAIL_PREFIX` in `.env.local`) and persists the session
 * cookies as `storageState` for every spec.
 *
 * Workers: 1 — the specs share one dev database and one Gmail-backed
 * mailbox; parallel workers would race each other's queue/list state.
 *
 * ## CI status (honest scope)
 *
 * LOCAL-ONLY for now. The Gmail-dependent specs (the three golden
 * flows + followups-dismiss) need a mailbox whose senders/messages
 * came from a real Gmail sync, and `undo.spec.ts` performs (then
 * reverses) a real Gmail mutation. There is no Gmail-free seed path
 * for THOSE flows, so a CI workflow running them would either fake the
 * stack or run zero specs — neither is acceptable (CLAUDE.md §10).
 * Each runtime-probes the stack via `requireLiveStack()` and skips
 * with an explicit reason when the stack/mailbox is absent.
 *
 * `billing-upgrade.spec.ts` is the exception: it runs GMAIL-FREE.
 * `global-setup` applies an idempotent synthetic-workspace seed
 * (helpers/seed-billing.ts — fixed `e2eb…` ids, never the founder's
 * rows) and the spec drives paywall → signed Paddle webhook → tier
 * flip → gates open with no Gmail API involvement and no worker. A
 * future CI job can run JUST this spec against a booted
 * postgres+redis+api+web stack (env recipe in the spec header; set
 * `E2E_LOGIN_EMAIL` to the synthetic user so no founder account is
 * needed — the seed runs before the dev-login).
 */
loadRootEnvLocal();

export default defineConfig({
  testDir: './specs',
  /* Shared dev DB + one Gmail mailbox — never parallelise. */
  workers: 1,
  fullyParallel: false,
  /* Local default: no retries (a retry would mask flake — the harness
   * bar is "green twice in a row"). Opt in via --retries when triaging. */
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: E2E_ENV.webUrl,
    storageState: E2E_ENV.storageStatePath,
    trace: 'on-first-retry',
    /* Real stack ≠ instant: action enqueue → worker → poll cycles.
     * Navigation headroom covers Next dev-server on-demand compiles
     * (global-setup pre-warms routes, but keep margin for re-compiles). */
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
});
