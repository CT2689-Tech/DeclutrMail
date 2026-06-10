import { scrubTelemetryPayload } from '@declutrmail/shared/observability';

/**
 * Sentry server bootstrap (D159).
 *
 * Gated entirely on `SENTRY_DSN`. With no DSN, this module installs
 * nothing — no SDK calls, no global side effects, no error swallowing
 * — so local dev (and the test suite) run unaffected.
 *
 * Privacy posture (D7, D228):
 *   - Captures EXCEPTIONS ONLY. No performance traces, no profiling,
 *     no replay (server-side replay doesn't exist, but the principle
 *     stands: opt out of anything that could carry user data).
 *   - `beforeSend` runs every event through the shared scrubber, which
 *     strips body / snippet / attachment / non-allowlisted header keys
 *     wherever they appear in the event tree.
 *   - PII auto-collection (`sendDefaultPii`) is OFF.
 *
 * The SDK is loaded via dynamic `import()` so unconfigured envs incur
 * zero startup cost (the @sentry/node bundle is large).
 */

let initialized = false;

/**
 * Hard timeout for the Sentry init phase, in ms. 2026-06-08 session:
 * `await initSentry()` blocked indefinitely on a Cloud Run worker
 * revision (last-logged boot step was `initSentry_begin`, never
 * `initSentry_done`). @sentry/node v10+'s OTel-aware init can stall
 * when modules are already imported above it; the worker entrypoint
 * imports the NestJS / Drizzle / BullMQ / Anthropic graph at the top
 * of `worker.ts` before any code runs, so Sentry attaching after-the-
 * fact is the structural mismatch. The right long-term fix is to
 * preload `@sentry/node/preload` via `node --import @sentry/node/preload`
 * BEFORE `@swc-node/register`; tracked as a follow-up. Until then,
 * this timeout prevents a single observability dependency from blocking
 * the entire worker indefinitely. Sentry is "best-effort" by design
 * (D159 — privacy preserved is more important than error capture).
 */
const SENTRY_INIT_TIMEOUT_MS = 5_000;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // local dev / unconfigured — no-op silently

  const initPromise = (async () => {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.SENTRY_RELEASE,
      // Exceptions only (D159 + D7) — explicitly disable traces.
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      // Never auto-collect IP, user-agent, cookies, request bodies, etc.
      sendDefaultPii: false,
      // CRITICAL (2026-06-08 session): `@sentry/node` v10 ships with
      // OpenTelemetry-based default integrations that monkey-patch
      // already-loaded modules (Express, http, postgres, ioredis, etc.)
      // when `Sentry.init` runs. The worker entrypoint imports the full
      // NestJS / Drizzle / BullMQ / Anthropic graph at the TOP of
      // `worker.ts` before any code runs, so by the time `initSentry()`
      // executes those modules are already in `require.cache`. Sentry's
      // late-monkey-patch hangs the bootstrap — observed as
      // `initSentry_begin` being the last logged step on Cloud Run
      // worker revision 00012-13. `defaultIntegrations: false` + an
      // empty integrations list opts entirely out of auto-
      // instrumentation; we keep ONLY `captureException`-style manual
      // capture (which is all we need per D159 — exceptions only, no
      // performance traces). Without this opt-out, the entire worker
      // never reaches BullMQ Worker constructors.
      defaultIntegrations: false,
      integrations: [],
      // Defense-in-depth privacy scrub on every outbound event.
      beforeSend: (event) =>
        scrubTelemetryPayload(
          event as unknown as Record<string, unknown>,
        ) as unknown as typeof event,
      beforeBreadcrumb: (breadcrumb) =>
        scrubTelemetryPayload(
          breadcrumb as unknown as Record<string, unknown>,
        ) as unknown as typeof breadcrumb,
    });
    initialized = true;
  })();

  await Promise.race([
    initPromise,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!initialized) {
          // eslint-disable-next-line no-console
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'sentry.init_timeout',
              timeoutMs: SENTRY_INIT_TIMEOUT_MS,
              dsnSet: true,
              message:
                'Sentry init did not resolve before the timeout — proceeding without capture wiring.',
            }),
          );
        }
        resolve();
      }, SENTRY_INIT_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Test seam — re-set so multiple `initSentry()` calls in unit tests
 * behave deterministically. Not exported from the package barrel.
 */
export function __resetForTests(): void {
  initialized = false;
}
