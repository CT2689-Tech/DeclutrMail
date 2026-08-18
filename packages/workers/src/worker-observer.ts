/**
 * Worker failure-capture seam (D159, D203).
 *
 * `BaseDeclutrWorker.captureFailure()` is the *single* point in the
 * worker lifecycle where a terminal failure can be reported to an
 * external sink — Sentry in production, nothing in dev/test. To keep
 * `packages/workers` free of a Sentry dependency (the composition root
 * owns adapter wiring) the base class only knows about this interface.
 *
 * The composition root (`apps/api/src/worker.ts`) constructs a real
 * implementation backed by `@sentry/node`, injects it into every worker
 * via `setObserver()`, AND calls `captureBackgroundFailure()` directly
 * for failures that happen OUTSIDE the BullMQ job loop (the periodic
 * reconciler in particular — see FOUNDER-FOLLOWUPS 2026-05-22 D-CANDIDATE
 * "D159 Sentry seam for background reconciler"). Both code paths route
 * through the same observer so D159's "Sentry called once per failure"
 * invariant holds for both lifecycles.
 *
 * Privacy (D7, D228): the observer receives ONLY metric-only context
 * fields. The composition root's Sentry adapter feeds events through
 * `scrubTelemetryPayload` as defense in depth, but callers must not pass
 * body / snippet / token data here in the first place.
 */

/** Context tags attached to a worker-job failure (D203 forbidden-fields list). */
export interface WorkerFailureContext {
  /** Stable worker name — used as the Sentry `worker` tag. */
  workerName: string;
  /** BullMQ job id. For per-mailbox jobs this IS the mailbox id. */
  jobId: string;
  /** Mailbox the job ran against; absent for cron/admin policies. */
  mailboxAccountId?: string;
  /** 1-based attempt number that failed terminally. */
  attempt: number;
  /** The policy that classified the failure (informs alerting tier). */
  policy: string;
  /**
   * The upstream provider's machine-readable reason, when it gave one
   * (Gmail's `error.errors[0].reason`, e.g. `failedPrecondition`).
   *
   * `Error.message` is deliberately never shipped to Sentry — it could
   * carry Gmail content (D7). That left a terminal failure arriving as a
   * bare error class with `<unknown>` frames and no way to tell WHICH
   * failure it was; the 2026-08-06 sync incident took a prod database
   * query to diagnose. This is a closed provider enum, never free text,
   * so it restores the diagnosis without widening what can leak.
   */
  errorReason?: string;
}

/** Context for failures OUTSIDE the worker job loop (boot, reconciler, scheduler). */
export interface BackgroundFailureContext {
  /** Stable log `kind` — `reconciler.failed`, `worker.boot_failed`, etc. */
  kind: string;
  /** Optional extra tags (must be metric-only — no D7-sensitive fields). */
  tags?: Record<string, string | number>;
}

/**
 * Context for a NOTICE — something worth surfacing that is not a crash.
 *
 * The distinction is a budget decision as much as a semantic one. Sentry
 * bills errors against a quota that runs out (4,000/5,000 at the
 * 2026-08-18 incident) while logs sat at 0 of 5 GB. A `dead_letter.parked`
 * alert announces a row that is ALREADY durable in `dead_letter_jobs`, and
 * a postal-address refusal is a designed CAN-SPAM outcome; neither is an
 * exception, and neither has a stack trace worth keeping (the frames point
 * at the announcer, not a fault). They belong on the log channel.
 *
 * `kind` must be one of `SENTRY_LOG_KINDS` in the shared scrubber or the
 * notice is dropped at the wire — deny-by-default, same as tags.
 */
export interface BackgroundNoticeContext {
  /** Stable notice `kind` — must be allowlisted in the scrubber. */
  kind: string;
  /** Optional metric-only attributes (no D7-sensitive fields). */
  tags?: Record<string, string | number>;
  /** Severity; defaults to `warn`. Notices are never `fatal`. */
  level?: 'info' | 'warn' | 'error';
}

/**
 * The seam every failure-capture path routes through. Implementations
 * must NEVER throw — a broken observer must not break the worker.
 */
export interface WorkerObserver {
  /** Capture a terminal worker-job failure (called by `BaseDeclutrWorker`). */
  captureFailure(error: Error, ctx: WorkerFailureContext): void;
  /** Capture a failure from outside the BullMQ loop (called by the reconciler). */
  captureBackgroundFailure(error: Error, ctx: BackgroundFailureContext): void;
  /**
   * Record a non-exception notice on the LOGS channel.
   *
   * Required, not optional: an optional method invoked as `?.()` silently
   * no-ops when a wiring mistake leaves it unset, which is the exact
   * silent-failure class this codebase keeps relearning. A no-op
   * implementation must be written down (see `NOOP_WORKER_OBSERVER`).
   */
  recordBackgroundNotice(ctx: BackgroundNoticeContext): void;
}

/**
 * Default no-op observer (D159 — Sentry is opt-in via `SENTRY_DSN`).
 *
 * Without `SENTRY_DSN` the API's `initSentry()` is a no-op, so the
 * composition root injects this. The structured-log capture in
 * `BaseDeclutrWorker.captureFailure()` still fires regardless — the
 * observer is *additive*, not a replacement for the log line.
 */
export const NOOP_WORKER_OBSERVER: WorkerObserver = {
  captureFailure() {},
  captureBackgroundFailure() {},
  recordBackgroundNotice() {},
};
