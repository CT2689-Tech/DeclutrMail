// Sentry capture helper for App Router error boundaries (D167).
//
// `sentry-browser-runtime.ts` owns DSN-gated lazy init. This module owns
// the boundary-capture surface so each error.tsx
// calls one typed function with a `boundary` tag — Sentry groups by
// that tag distinctly from the global app shell + from feature-level
// captureFeatureException calls.
//
// The wrapper is its own module (rather than a method on the Sentry
// bootstrap) so tests can mock it cleanly: error-boundary tests stub
// this module's export, leaving the bootstrap module alone.
//
// Privacy posture (D7): the boundary passes the raw `Error` object, but the
// lazy browser runtime rebuilds the outgoing event from a closed allowlist.
// Exception messages/values, request and user context, frame locals, and source
// context lines are removed; only validated exception types, mechanisms, and
// structural stack coordinates remain for grouping and source-map lookup.

import { captureSentryBoundaryException } from './sentry';

/**
 * Stable identifier for the boundary that captured the error.
 *
 * Per-feature boundary tags (`senders-detail`, …) let Sentry group
 * route-scoped errors distinctly from the global app shell — a Sender
 * Detail render error shouldn't pile into the same bucket as a
 * top-level routing throw.
 */
export type ErrorBoundary =
  | 'app-router-error'
  | 'app-router-global-error'
  | 'senders-detail'
  | 'senders'
  | 'activity'
  | 'brief'
  | 'autopilot'
  // 2026-07-04 launch audit — every remaining app route gets its own
  // boundary (RouteErrorScreen callers).
  | 'triage'
  | 'settings'
  | 'billing'
  | 'screener'
  | 'followups'
  | 'quiet'
  | 'snoozed'
  | 'admin-security'
  | 'onboarding';

/** Closed set used both as the type union and the runtime allowlist. */
const VALID_BOUNDARIES = new Set<ErrorBoundary>([
  'app-router-error',
  'app-router-global-error',
  'senders-detail',
  'senders',
  'activity',
  'brief',
  'autopilot',
  'triage',
  'settings',
  'billing',
  'screener',
  'followups',
  'quiet',
  'snoozed',
  'admin-security',
  'onboarding',
]);

/**
 * Runtime guard for the boundary tag value before it's handed to Sentry.
 *
 * The `ErrorBoundary` union is compile-time only; if a caller passes a
 * stringly-typed value (legacy code, future boundary that wasn't added
 * to the union, deserialised payload), we don't want to ship an
 * arbitrary tag to Sentry where it would pollute the tag dictionary.
 */
function validateBoundary(b: string): ErrorBoundary | 'unknown' {
  return VALID_BOUNDARIES.has(b as ErrorBoundary) ? (b as ErrorBoundary) : 'unknown';
}

export interface ErrorBoundaryContext {
  boundary: ErrorBoundary;
  /** Next.js digest hash. Present on server-component throws. */
  digest?: string | undefined;
}

/** Track the "Sentry not initialised" warning so we log it at most once. */
let warnedNotInitialised = false;

/**
 * Capture an exception caught by an App Router error boundary.
 *
 * No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset. The early return keeps local dev
 * silent — no fallback console noise, no Sentry SDK overhead.
 *
 * If the SDK IS configured (DSN set) but reports no active client at
 * capture time (init race, chunk-load failure, or build skipped the
 * init file), fall back to `console.error` so the crash is still
 * observable in the browser. The one-shot `warnedNotInitialised`
 * latch keeps repeated boundary captures during a single race from
 * flooding the console.
 *
 * Signature stays `async` for backwards compatibility — every error boundary
 * already awaits this call. An explicit boundary capture bypasses the idle
 * delay and waits for the lazy SDK chunk before deciding whether to fall back.
 */
export async function captureErrorBoundaryException(
  error: unknown,
  context: ErrorBoundaryContext,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  const boundary = validateBoundary(context.boundary);
  const payload = {
    boundary,
    digest: context.digest,
    error,
  };

  const captured = await captureSentryBoundaryException(error, boundary, context.digest);
  if (!captured) {
    if (!warnedNotInitialised) {
      warnedNotInitialised = true;
      console.warn(
        '[error-capture] Sentry not initialised when boundary fired — falling back to console.error. Capture race or init skipped.',
      );
    }
    console.error('[error-capture] boundary capture (fallback)', payload);
  }
}

/** Test seam — reset the one-shot warning latch. */
export function __resetForTests(): void {
  warnedNotInitialised = false;
}
