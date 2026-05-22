/**
 * Worker policies (D203 + D225).
 *
 * D225 locks the policy SET to five named policies:
 *   webhookPolicy | perMailboxPolicy | batchPolicy | cronPolicy | adminPolicy
 * and `architecture-guardian` (Check B) enforces exactly that naming.
 *
 * D203's body separately describes retry/backoff/timeout config objects
 * (`standard`, `gmailApi`, …). Those two descriptions collide on the name
 * `WORKER_POLICIES`. Per CLAUDE.md §3 the latest D-decision wins (D225),
 * so the policy NAMES are D225's; D203's retry/backoff/timeout fields are
 * folded INTO each named policy here. This collision is plan-drift
 * between D203 and D225 — surfaced in the PR body for the founder.
 *
 * PR-C exercises `perMailboxPolicy` only. The other four are defined so
 * the enum is complete (the guardian checks against the full 5-set) and
 * future worker PRs do not have to re-declare it.
 */

/** Retry backoff — exponential with jitter (D203). */
export interface WorkerBackoff {
  type: 'exponential';
  /** First-retry delay in ms; doubles each attempt. */
  delayMs: number;
}

/** Concurrency keying — which dimension caps parallel jobs (D203 §concurrency). */
export type ConcurrencyScope = 'perMailbox' | 'perUser' | 'global';

export interface WorkerPolicyConfig {
  /** Max attempts including the first (D203). */
  maxAttempts: number;
  /** Backoff between attempts; `null` = no retry delay. */
  backoff: WorkerBackoff | null;
  /** Dimension the queue serializes on (D203 QUEUE_CONCURRENCY). */
  concurrencyScope: ConcurrencyScope;
  /**
   * Wall-clock cap for a single job, ms. `null` = no cap — used by
   * long-running jobs (the initial backfill runs 50k–250k messages and
   * can take well over an hour); their time guard is the per-HTTP-call
   * timeout inside the adapter, not a job-level wall clock.
   */
  timeoutMs: number | null;
  /**
   * D203 "Sentry called once per failure" test. `adminPolicy` is exempt
   * (D225) — its whole purpose is to surface failures, so it may alert
   * repeatedly.
   */
  singleFailureCapture: boolean;
}

export const WORKER_POLICIES = {
  /** Pub/Sub / Stripe webhooks — keyed on the webhook event id (D225). */
  webhookPolicy: {
    maxAttempts: 5,
    backoff: { type: 'exponential', delayMs: 1_000 },
    concurrencyScope: 'global',
    timeoutMs: 30_000,
    singleFailureCapture: true,
  },
  /**
   * One in-flight job per mailbox (D5 + D203 `perMailbox=1`): Gmail rate-
   * limits per mailbox and concurrent mutations on one mailbox interfere.
   * No wall-clock cap — the initial backfill is long-running (D203 notes
   * sync as a long-running job). Used by `InitialSyncWorker`.
   */
  perMailboxPolicy: {
    maxAttempts: 5,
    backoff: { type: 'exponential', delayMs: 2_000 },
    concurrencyScope: 'perMailbox',
    timeoutMs: null,
    singleFailureCapture: true,
  },
  /** Fan-out batch items — keyed on (batch_id, item_id) (D225). */
  batchPolicy: {
    maxAttempts: 3,
    backoff: { type: 'exponential', delayMs: 5_000 },
    concurrencyScope: 'global',
    timeoutMs: 60_000,
    singleFailureCapture: true,
  },
  /** Periodic jobs, no mailbox keying — keyed on (worker, minute) (D225). */
  cronPolicy: {
    maxAttempts: 3,
    backoff: { type: 'exponential', delayMs: 5_000 },
    concurrencyScope: 'global',
    timeoutMs: 60_000,
    singleFailureCapture: true,
  },
  /** Jobs whose purpose IS to surface failures — Sentry-multiple OK (D225). */
  adminPolicy: {
    maxAttempts: 1,
    backoff: null,
    concurrencyScope: 'global',
    timeoutMs: 30_000,
    singleFailureCapture: false,
  },
} as const satisfies Record<string, WorkerPolicyConfig>;

/** The five named worker policies — the D225 enum (`architecture-guardian` Check B). */
export type WorkerPolicy = keyof typeof WORKER_POLICIES;
