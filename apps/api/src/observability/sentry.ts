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

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // local dev / unconfigured — no-op silently

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
    // Defense-in-depth privacy scrub on every outbound event.
    beforeSend: (event) =>
      scrubTelemetryPayload(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) =>
      scrubTelemetryPayload(
        breadcrumb as unknown as Record<string, unknown>,
      ) as unknown as typeof breadcrumb,
  });

  initialized = true;
}

/**
 * Test seam — re-set so multiple `initSentry()` calls in unit tests
 * behave deterministically. Not exported from the package barrel.
 */
export function __resetForTests(): void {
  initialized = false;
}
