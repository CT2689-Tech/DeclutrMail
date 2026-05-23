'use client';

import { scrubTelemetryPayload } from '@declutrmail/shared/observability';

/**
 * Sentry browser bootstrap (D159).
 *
 * Gated on `NEXT_PUBLIC_SENTRY_DSN`. With no DSN, this module installs
 * nothing — local dev is unaffected.
 *
 * Privacy posture (D7, D228):
 *   - **Session Replay is OFF.** Replay captures DOM snapshots which
 *     in DeclutrMail would mean rendered subject lines and snippets.
 *     The product's trust wedge does not survive replay. Hard off.
 *   - Captures EXCEPTIONS ONLY. `tracesSampleRate: 0`.
 *   - `beforeSend` runs every event through the shared scrubber.
 *   - PII auto-collection (`sendDefaultPii`) is OFF.
 *
 * The SDK is loaded via dynamic `import()` so the @sentry/nextjs bundle
 * is only paid for when configured.
 */

let initialized = false;

export async function initSentryBrowser(): Promise<void> {
  if (initialized) return;
  if (typeof window === 'undefined') return; // SSR-side no-op
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import('@sentry/nextjs');

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0, // explicit: replay OFF (D7)
    replaysOnErrorSampleRate: 0, // explicit: replay OFF even on error
    sendDefaultPii: false,
    integrations: [], // do NOT auto-register Replay or BrowserTracing
    beforeSend: (event) =>
      scrubTelemetryPayload(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) =>
      scrubTelemetryPayload(
        breadcrumb as unknown as Record<string, unknown>,
      ) as unknown as typeof breadcrumb,
  });

  initialized = true;
}

/** Test seam. */
export function __resetForTests(): void {
  initialized = false;
}
