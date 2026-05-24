// Sentry capture helper for App Router error boundaries (D167).
//
// `lib/sentry.ts` owns init. This module owns the capture surface so
// the error boundaries can call a single function without each one
// repeating the dynamic-import dance.
//
// The wrapper is its own module (rather than a method on the Sentry
// bootstrap) so tests can mock it cleanly: error-boundary tests stub
// this module's export, leaving the bootstrap module alone.
//
// Privacy posture (D7): the boundary passes the raw `Error` object,
// which can contain user data in its `message`. The Sentry init
// (`lib/sentry.ts`) installs `beforeSend` with `scrubTelemetryPayload`
// so the same scrubber that protects regular events also covers
// boundary captures. No bodies, snippets, or subject lines leak.

/** Stable identifier for the boundary that captured the error. */
export type ErrorBoundary = 'app-router-error' | 'app-router-global-error';

export interface ErrorBoundaryContext {
  boundary: ErrorBoundary;
  /** Next.js digest hash. Present on server-component throws. */
  digest?: string | undefined;
}

/**
 * Capture an exception caught by an App Router error boundary.
 *
 * No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset (init bails early in
 * `lib/sentry.ts`). The dynamic import keeps the SDK out of the main
 * bundle until a crash actually happens.
 */
export async function captureErrorBoundaryException(
  error: unknown,
  context: ErrorBoundaryContext,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(error, {
    tags: { boundary: context.boundary },
    extra: { digest: context.digest },
  });
}
