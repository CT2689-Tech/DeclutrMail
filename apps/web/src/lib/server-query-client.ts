import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { isCancelledError, QueryClient } from '@tanstack/react-query';

import { ServerApiError } from '@/lib/api/server';

export type ServerHydrationSurface =
  | 'activity'
  | 'admin-security'
  | 'app-shell'
  | 'autopilot'
  | 'billing'
  | 'billing-invoices'
  | 'brief'
  | 'followups'
  | 'later'
  | 'onboarding'
  | 'onboarding-step'
  | 'quiet'
  | 'screener'
  | 'sender-detail'
  | 'senders'
  | 'settings'
  | 'settings-privacy'
  | 'triage';

export function makeServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function isDesignedPrefetchFailure(error: unknown): boolean {
  if (!(error instanceof ServerApiError)) return false;
  if (error.status >= 400 && error.status < 500) return true;
  const body = error.body as { error?: { code?: unknown } } | undefined;
  return error.status === 503 && body?.error?.code === 'BILLING_DISABLED';
}

/**
 * Per-prefetch deadline, in milliseconds.
 *
 * WHY A DEADLINE EXISTS AT ALL. Every authenticated route renders
 * inside `ServerAppBoundary`, which awaits its whole prefetch set
 * before the first byte of HTML is sent. With no bound, ONE slow read
 * holds the entire signed-in app's TTFB, and one hung read holds it
 * forever — a `server-hydration` timeout did fire in production on
 * 2026-08-17. `Promise.allSettled` never rejects, so nothing else in
 * this file could have caught that.
 *
 * WHY THIS IS SAFE. Timing a query out is the SAME outcome this
 * function already produces for a failed one: the query is absent from
 * the dehydrated state, so the client query runs as the designed
 * recovery path. It is not a new state — `unexpectedFailureCount`
 * already tracks this exact fallback for network errors.
 *
 * WHY 2000ms AND NOT TIGHTER. It is a hang guard, not a latency
 * target. The app-shell set measures 15-17ms warm (2026-08-20, after
 * the senders-summary fixes) and the slowest route prefetch 63ms, so
 * 2s is ~30x the worst observed value: it cannot fire on a merely slow
 * request and turn a working server render into a client fetch, which
 * would be a REGRESSION for the users on slow connections this is
 * meant to protect. Tightening it is a deliberate decision that needs
 * its own measurement.
 */
const PREFETCH_DEADLINE_MS = 2_000;

/** Marker rejection so a timeout is countable separately from a failure. */
class PrefetchTimeoutError extends Error {
  constructor(surface: ServerHydrationSurface) {
    super(`${surface} prefetch exceeded ${PREFETCH_DEADLINE_MS}ms`);
    this.name = 'PrefetchTimeoutError';
  }
}

/**
 * Reject `query` if it has not settled within the deadline.
 *
 * The timer is ALWAYS cleared. A pending `setTimeout` keeps the Node
 * event loop alive, which in a serverless render is a leaked handle
 * per request, not a cosmetic detail.
 */
function withDeadline<T>(
  surface: ServerHydrationSurface,
  query: Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // ABORT, DON'T JUST STOP WAITING. `Promise.race` abandons the
      // query; it does not stop it. `serverGet` composes its own
      // `AbortSignal.timeout(3_000)`, so an abandoned read keeps running
      // for up to a further second while the browser has already been
      // handed a cache miss and refetches it — the server does the
      // expensive read twice, and it does so precisely when it is
      // already slow enough to have missed a 2s deadline. Cancelling
      // makes the fallback cost one read instead of two.
      onTimeout();
      reject(new PrefetchTimeoutError(surface));
    }, PREFETCH_DEADLINE_MS);
  });
  return Promise.race([query, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

export async function settleServerQueries(
  surface: ServerHydrationSurface,
  queries: Array<Promise<unknown>>,
  /**
   * The client the queries were started on, so a timeout can CANCEL the
   * in-flight read rather than merely stop awaiting it.
   *
   * REQUIRED, not optional. It was optional in the first draft purely to
   * spare the existing tests, and a reviewer pointed out that the type
   * then permits a call which silently loses the behaviour this argument
   * exists to add — tsc cannot flag a caller that simply forgets it.
   * Required makes that regression impossible to write rather than
   * merely discouraged.
   *
   * Cancelling ALL queries on the first timeout is deliberate and is not
   * as broad as it reads: every query in the batch carries the SAME
   * deadline, so by the moment one fires, the others have either already
   * settled (cancel is a no-op) or are at the same deadline themselves.
   */
  queryClient: QueryClient,
): Promise<void> {
  if (queries.length === 0) return;
  const startedAt = performance.now();
  let cancelled = false;
  const cancelInFlight = () => {
    if (cancelled) return;
    cancelled = true;
    // Fire-and-forget: `cancelQueries` resolves once the abort has been
    // signalled, and the render must not wait on teardown.
    void queryClient.cancelQueries();
  };
  const results = await Promise.allSettled(
    queries.map((q) => withDeadline(surface, q, cancelInFlight)),
  );
  let designedFailureCount = 0;
  let unexpectedFailureCount = 0;
  let timedOutCount = 0;

  for (const result of results) {
    if (result.status !== 'rejected') continue;
    if (isDesignedPrefetchFailure(result.reason)) {
      designedFailureCount += 1;
      continue;
    }
    if (result.reason instanceof PrefetchTimeoutError || isCancelledError(result.reason)) {
      // A hang is not an error to report to Sentry per-render — it is a
      // capacity signal, and the count below is what makes it visible.
      //
      // `isCancelledError` IS THE SAME EVENT, SEEN FROM A SIBLING.
      // Cancelling on the first timeout rejects every other in-flight
      // query in the batch with `CancelledError` (query-core rethrows it
      // when `state.data === undefined`, which is always true on a fresh
      // server client). Those are not failures — this code cancelled
      // them on purpose, one tick before their own identical deadlines
      // would have fired anyway.
      //
      // Counting them as unexpected failures corrupted BOTH signals at
      // once, in opposite directions, during exactly the saturation this
      // deadline exists for: on the 7-query app-shell batch one hung
      // dependency reported `timed_out_count: 1` while emitting 6 Sentry
      // events and tripping the unexpected-failure alert
      // (docs/observability/event-taxonomy.md designates any non-zero
      // unexpected count as the alert input).
      timedOutCount += 1;
      console.warn(
        `[server-hydration] ${surface} prefetch hit the ${PREFETCH_DEADLINE_MS}ms deadline; falling back to the client query.`,
      );
      continue;
    }
    unexpectedFailureCount += 1;

    const message =
      result.reason instanceof Error ? result.reason.message : 'Unknown server query error';
    console.warn(
      `[server-hydration] ${surface} prefetch failed; falling back to the client query.`,
      message,
    );
    try {
      Sentry.captureException(result.reason instanceof Error ? result.reason : new Error(message), {
        tags: { surface: 'server-hydration', hydration_surface: surface },
      });
    } catch {
      // Optional telemetry must never turn a recoverable prefetch fallback
      // into a failed page render.
    }
  }

  console.info(
    JSON.stringify({
      level: 'info',
      event: 'server_hydration.prefetch',
      surface,
      duration_ms: Math.round((performance.now() - startedAt) * 1_000) / 1_000,
      query_count: results.length,
      designed_failure_count: designedFailureCount,
      unexpected_failure_count: unexpectedFailureCount,
      timed_out_count: timedOutCount,
    }),
  );
}
