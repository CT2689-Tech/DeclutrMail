import type { BackoffStrategy, JobsOptions } from 'bullmq';

import { RateLimitError } from './worker-errors.js';
import { WORKER_POLICIES, type WorkerBackoff } from './worker-policies.js';

/**
 * `WORKER_POLICIES` is built with `as const satisfies …` (worker-
 * policies.ts), which preserves each property's literal type rather than
 * widening it to the `WorkerPolicyConfig` interface — so this is the
 * `CustomBackoff` literal at the type level already, not a runtime
 * assumption. `perMailboxPolicy` is the ONLY policy declared with
 * `type: 'custom'`; keep it that way, or this stops type-checking.
 */
const PER_MAILBOX_BACKOFF = WORKER_POLICIES.perMailboxPolicy.backoff;

/**
 * Custom BullMQ backoff for `perMailboxPolicy` jobs (D5/D203). See
 * `CustomBackoff` in `worker-policies.ts` for why this exists — a
 * `RateLimitError` needs a wait long enough to plausibly outlast Gmail's
 * 60s quota window; every other retryable error keeps the fast fixed
 * schedule that `perMailboxPolicy` shipped with before this fix.
 *
 * Both `backoffJobOptions` and `perMailboxWorkerSettings` below exist so
 * the producer (`backoff: { type: 'custom' }` on the job) and the
 * consumer (`settings.backoffStrategy` on the BullMQ `Worker`) can never
 * drift independently — both are derived from this same module, and
 * `rate-limit-backoff.test.ts` asserts they reference the identical
 * function. See the architecture-guardian review of the 2026-09-02
 * incident fix: an unpinned pairing throws inside BullMQ's own
 * `moveToFailed` (`Unknown backoff strategy custom.`) if a job carrying
 * `type: 'custom'` is ever processed by a Worker that didn't register
 * this strategy — worse than the incident, since that job never reaches
 * `failed` at all (stuck `active` until the stalled-job reclaim, with no
 * `onTerminalFailure`, no Sentry capture, no dead-letter row).
 */

export const perMailboxBackoff: BackoffStrategy = (attemptsMade, _type, err) => {
  if (err instanceof RateLimitError) {
    const delayMs =
      typeof err.retryAfterMs === 'number' && err.retryAfterMs > 0
        ? Math.min(err.retryAfterMs, PER_MAILBOX_BACKOFF.rateLimitMaxDelayMs)
        : PER_MAILBOX_BACKOFF.rateLimitFallbackMs;
    // The one falsifiability hook for this fix in prod: if this line
    // never appears for a mailbox that dead-lettered on RateLimitError,
    // the strategy either isn't registered on that Worker (see the
    // pairing note above) or the error crossed a boundary as something
    // other than a `RateLimitError` instance.
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'worker.retry_scheduled',
        error: 'RateLimitError',
        attemptsMade,
        delayMs,
        hadRetryAfterHeader: typeof err.retryAfterMs === 'number' && err.retryAfterMs > 0,
      }),
    );
    return delayMs;
  }
  // Identical to BullMQ's built-in `exponential` strategy (no jitter) —
  // `perMailboxPolicy`'s documented behavior for every non-rate-limit
  // retryable error, unchanged by this fix.
  return Math.round(2 ** (attemptsMade - 1) * PER_MAILBOX_BACKOFF.delayMs);
};

/**
 * Turn a `WORKER_POLICIES[...].backoff` value into the `JobsOptions`
 * shape BullMQ wants at job-creation time. The producer half of the
 * pairing described above — `type: 'custom'` here is only ever correct
 * because `perMailboxWorkerSettings()` registers `perMailboxBackoff` on
 * every Worker that consumes a `perMailboxPolicy` queue.
 */
export function backoffJobOptions(backoff: WorkerBackoff | null): Pick<JobsOptions, 'backoff'> {
  if (!backoff) {
    return {};
  }
  return backoff.type === 'custom'
    ? { backoff: { type: 'custom' } }
    : { backoff: { type: backoff.type, delay: backoff.delayMs } };
}

/**
 * BullMQ `Worker` options for every `perMailboxPolicy` queue — the
 * consumer half of the pairing. Spread into every `new Worker(...)` call
 * whose jobs come from `backoffJobOptions(WORKER_POLICIES.perMailboxPolicy.backoff)`
 * (initial-sync, incremental-sync, label-action, autopilot-action,
 * action-recovery — every Gmail-calling per-mailbox worker).
 */
export function perMailboxWorkerSettings(): { settings: { backoffStrategy: BackoffStrategy } } {
  return { settings: { backoffStrategy: perMailboxBackoff } };
}
