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

/**
 * A trimmed-down version of Sentry's `Breadcrumb` type — we never use
 * the long tail (`event_id`, `type`, etc.), so an explicit shape both
 * documents the expected fields AND keeps the SDK out of test bundles.
 */
export interface AppBreadcrumb {
  category: 'sync' | 'action' | 'undo' | 'navigation' | 'mailbox' | 'auth';
  message: string;
  level: 'info' | 'warning' | 'error';
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Lazy-wraps `Sentry.addBreadcrumb` so the surface code never touches
 * the SDK directly. When `NEXT_PUBLIC_SENTRY_DSN` is unset, this is a
 * silent no-op (matching `initSentryBrowser`'s gate). Errors during
 * load (Sentry chunk fails to fetch, etc.) are swallowed — a missing
 * breadcrumb must never break the user's interaction.
 */
export function addBreadcrumb(crumb: AppBreadcrumb): void {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  // Fire-and-forget — the SDK init is idempotent + memoized in
  // `initSentryBrowser`, so a stray breadcrumb that lands before
  // init still gets buffered onto the live client.
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.addBreadcrumb({
        category: crumb.category,
        message: crumb.message,
        level: crumb.level === 'warning' ? 'warning' : crumb.level,
        ...(crumb.data === undefined ? {} : { data: crumb.data }),
      });
    })
    .catch(() => {
      // Intentional silent ignore — see jsdoc.
    });
}

/**
 * Capture a non-fatal exception. Used by feature surfaces (Senders,
 * Activity, Brief, Autopilot) to record errors that did not bubble to
 * a React error boundary — e.g. a `useMutation.onError` branch where
 * we already showed a toast but want the Sentry signal.
 *
 * Mirrors `addBreadcrumb`'s lazy-load + DSN-gate.
 */
export function captureFeatureException(
  err: unknown,
  ctx: { surface: 'sync' | 'senders' | 'activity' | 'brief' | 'autopilot'; reason: string },
): void {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag('surface', ctx.surface);
        scope.setTag('reason', ctx.reason);
        Sentry.captureException(err);
      });
    })
    .catch(() => {
      // Intentional silent ignore.
    });
}
