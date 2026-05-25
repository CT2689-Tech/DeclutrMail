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

/** Closed set used both as the type union and the runtime allowlist. */
const VALID_BOUNDARIES = new Set<ErrorBoundary>(['app-router-error', 'app-router-global-error']);

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
 * No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset (init bails early in
 * `lib/sentry.ts`). The dynamic import keeps the SDK out of the main
 * bundle until a crash actually happens.
 *
 * If the Sentry SDK loads but reports it isn't initialised (init
 * raced with the boundary mount, or the host stripped the init module),
 * fall back to a structured `console.error` payload so the crash is
 * still observable. The fallback warning fires at most once per session
 * — repeated boundary captures during a single race shouldn't flood
 * the console.
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

  const Sentry = await import('@sentry/nextjs');

  // Sentry's `getClient()` returns the active client when `Sentry.init`
  // has run. If init lost the race with this capture call (or was
  // skipped entirely), the client is undefined — captureException
  // would then silently drop the event. Log a structured fallback so
  // the crash is still observable in the browser console.
  const client = typeof Sentry.getClient === 'function' ? Sentry.getClient() : undefined;
  if (!client) {
    if (!warnedNotInitialised) {
      warnedNotInitialised = true;
      console.warn(
        '[error-capture] Sentry not initialised when boundary fired — falling back to console.error. Capture race or init skipped.',
      );
    }
    console.error('[error-capture] boundary capture (fallback)', payload);
    return;
  }

  Sentry.captureException(error, {
    tags: { boundary },
    extra: { digest: context.digest },
  });
}

/** Test seam — reset the one-shot warning latch. */
export function __resetForTests(): void {
  warnedNotInitialised = false;
}
