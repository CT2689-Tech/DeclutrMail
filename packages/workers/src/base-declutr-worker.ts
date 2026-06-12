import { type Job, UnrecoverableError } from 'bullmq';

import type { DeadLetterRecorder } from './dead-letter.recorder.js';
import type { WorkerContext } from './worker-context.js';
import { isNonRetryable } from './worker-errors.js';
import {
  NOOP_WORKER_OBSERVER,
  type WorkerFailureContext,
  type WorkerObserver,
} from './worker-observer.js';
import { WORKER_POLICIES, type WorkerPolicy } from './worker-policies.js';

/** Lifecycle events every worker emits (D203 — uniform shape). */
type WorkerEvent =
  | 'worker.started'
  | 'worker.succeeded'
  | 'worker.failed'
  | 'worker.retried'
  | 'worker.dead_lettered';

/**
 * BaseDeclutrWorker (D203) — the lifecycle abstraction every DeclutrMail
 * worker extends.
 *
 * Core principle (D203): *standardize behavior, do not centralize domain
 * knowledge.* The base owns the run lifecycle, error classification,
 * retry/dead-letter decision, the timeout guard, structured logging, and
 * the SINGLE failure-capture point (D159 Sentry seam). Subclasses
 * implement only `processJob()` and declare a `policy`.
 *
 * Deliberate deviation from D203's `extends WorkerHost` sketch: this is a
 * framework-agnostic abstract class, not a NestJS `WorkerHost`. That
 * keeps `packages/workers` free of a NestJS dependency — the BullMQ
 * `Worker` is created in the composition root (`apps/api`) and delegates
 * each job to `run()`. D203's *core principle* (abstract class +
 * `processJob()` + named policy) is preserved; only the NestJS coupling
 * is dropped. Surfaced in the PR body.
 *
 * D159 wiring (this PR): the composition root injects a `WorkerObserver`
 * (Sentry adapter in prod, no-op otherwise) via `setObserver()` after
 * construction. `captureFailure()` fires the observer EXACTLY ONCE per
 * terminal failure — per D203's "Sentry called once per failure" test —
 * AND emits a structured log line regardless of whether an observer is
 * configured. The reconciler in `apps/api/src/worker.ts` runs OUTSIDE
 * this loop; it calls `observer.captureBackgroundFailure()` directly so
 * both lifecycles route through the same Sentry seam — see
 * FOUNDER-FOLLOWUPS 2026-05-22 "D-CANDIDATE: D159 Sentry seam for
 * background reconciler" (now Done).
 *
 * Dead-letter persistence (D225): on TERMINAL failure the base also
 * parks the job in `dead_letter_jobs` via the injected
 * `DeadLetterRecorder` (`setDeadLetterRecorder()`, same wiring pattern
 * as the observer). The recorder path never throws — a failed INSERT
 * is logged + reported to the observer, but must not mask the original
 * job failure. `DeadLetterWorker` (adminPolicy) polls the table and
 * alerts on every parked row.
 *
 * Out of PR scope (lands with later PRs): checkpointing,
 * AsyncLocalStorage correlation ids.
 */
export abstract class BaseDeclutrWorker<TPayload, TResult> {
  /** Stable name for logs + failure capture. */
  abstract readonly workerName: string;

  /** Exactly one of the five D225 policies (`architecture-guardian` Check B). */
  abstract readonly policy: WorkerPolicy;

  /**
   * Pluggable failure-capture sink (D159 Sentry seam). Defaults to a
   * no-op so unit tests and dev (no `SENTRY_DSN`) need no wiring. The
   * composition root replaces it via `setObserver()` at boot.
   */
  private observer: WorkerObserver = NOOP_WORKER_OBSERVER;

  /**
   * Durable dead-letter sink (D225). `null` until the composition root
   * installs the Drizzle-backed recorder via `setDeadLetterRecorder()`
   * — unit tests and one-off harnesses run without one, in which case
   * terminal failures still emit `worker.dead_lettered` + the failure
   * capture, they just are not parked in Postgres.
   */
  private deadLetterRecorder: DeadLetterRecorder | null = null;

  /**
   * The job body. Subclasses do the real work here.
   *
   * `TResult` is logged on `worker.succeeded` (it carries job metrics —
   * counts, durations). It MUST stay metric-only — never message content
   * or any D7-sensitive data — because it lands in structured logs.
   */
  abstract processJob(payload: TPayload, ctx: WorkerContext): Promise<TResult>;

  /**
   * Optional idempotency key (D203). For `perMailboxPolicy` the BullMQ
   * `jobId` already dedups concurrent enqueues; subclasses still expose
   * the key so the lifecycle log records it.
   */
  protected getIdempotencyKey?(payload: TPayload): string;

  /**
   * Optional domain hook fired exactly once when the job fails
   * terminally (retries exhausted or a non-retryable error). The base
   * class never knows what a terminal failure MEANS for a feature — the
   * subclass writes the feature's failed state here. Runs BEFORE
   * `captureFailure` so domain side-effects land first and the observer
   * sees the canonical post-terminal state.
   */
  protected onTerminalFailure?(payload: TPayload, error: Error, ctx: WorkerContext): Promise<void>;

  /**
   * Install the failure-capture sink. The composition root calls this
   * once per worker at boot, BEFORE the BullMQ `Worker` starts pulling
   * jobs. Idempotent — safe to call multiple times across test setups.
   */
  setObserver(observer: WorkerObserver): void {
    this.observer = observer;
  }

  /**
   * Install the durable dead-letter sink (D225). The composition root
   * calls this once per worker at boot, alongside `setObserver()`.
   * Idempotent — safe to call multiple times across test setups.
   */
  setDeadLetterRecorder(recorder: DeadLetterRecorder): void {
    this.deadLetterRecorder = recorder;
  }

  /**
   * Sealed run lifecycle. The composition root's BullMQ `Worker`
   * processor calls this once per attempt.
   */
  async run(job: Job<TPayload, TResult>): Promise<TResult> {
    const config = WORKER_POLICIES[this.policy];
    const ctx: WorkerContext = {
      jobId: job.id ?? 'unknown',
      workerName: this.workerName,
      attempt: job.attemptsMade + 1,
      maxAttempts: config.maxAttempts,
      startedAt: new Date(),
      policy: this.policy,
      ...(job.data && typeof job.data === 'object' && 'mailboxAccountId' in job.data
        ? { mailboxAccountId: String((job.data as Record<string, unknown>).mailboxAccountId) }
        : {}),
    };

    this.emit('worker.started', ctx, {
      idempotencyKey: this.getIdempotencyKey?.(job.data),
    });

    try {
      const result =
        config.timeoutMs === null
          ? await this.processJob(job.data, ctx)
          : await withTimeout(this.processJob(job.data, ctx), config.timeoutMs, this.workerName);
      // `result` carries job metrics (counts, durations) — logged so a
      // sync's timing is observable. Metric-only per the processJob contract.
      this.emit('worker.succeeded', ctx, { result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const terminal = isNonRetryable(error) || ctx.attempt >= ctx.maxAttempts;
      this.emit('worker.failed', ctx, { error: error.name, message: error.message, terminal });

      if (terminal) {
        // Domain side-effect first, then the single capture point.
        if (this.onTerminalFailure) {
          await this.onTerminalFailure(job.data, error, ctx);
        }
        this.captureFailure(error, ctx);
        await this.recordDeadLetter(job, error, ctx);
        this.emit('worker.dead_lettered', ctx, { error: error.name });
        // Non-retryable → tell BullMQ to stop retrying.
        if (isNonRetryable(error)) {
          throw new UnrecoverableError(error.message);
        }
      } else {
        this.emit('worker.retried', ctx, { error: error.name });
      }
      // Rethrow so BullMQ applies the policy's attempts + backoff.
      throw error;
    }
  }

  /**
   * The single failure-capture point (D203 — "Sentry once per failure";
   * D159 — observability seam).
   *
   * Always emits a structured error log so failures remain greppable in
   * Cloud Logging even with no observer configured. Then forwards to the
   * injected observer (Sentry in prod, no-op otherwise). Observer-level
   * failures are themselves logged but never rethrown: losing one Sentry
   * event must not block the dead-letter path (silent-failure-hunter).
   */
  private captureFailure(error: Error, ctx: WorkerContext): void {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'worker.failure_capture',
        worker: ctx.workerName,
        jobId: ctx.jobId,
        mailboxAccountId: ctx.mailboxAccountId,
        attempt: ctx.attempt,
        error: error.name,
        message: error.message,
      }),
    );
    const observerCtx: WorkerFailureContext = {
      workerName: ctx.workerName,
      jobId: ctx.jobId,
      attempt: ctx.attempt,
      policy: ctx.policy,
      ...(ctx.mailboxAccountId ? { mailboxAccountId: ctx.mailboxAccountId } : {}),
    };
    try {
      this.observer.captureFailure(error, observerCtx);
    } catch (observerErr) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'worker.observer_failed',
          worker: ctx.workerName,
          message: observerErr instanceof Error ? observerErr.message : String(observerErr),
        }),
      );
    }
  }

  /**
   * Park a terminal failure in `dead_letter_jobs` (D225) so it is
   * durable beyond Redis. `DeadLetterWorker` (adminPolicy) polls the
   * table and alerts on every parked row.
   *
   * NEVER throws (silent-failure-hunter posture, inverted): a failed
   * INSERT must not mask the original job failure that is about to be
   * rethrown to BullMQ — but it is also never swallowed silently. The
   * recorder failure gets exactly one structured error log line AND a
   * `captureBackgroundFailure` to the observer (Sentry in prod), which
   * is itself wrapped because a broken observer must not break the
   * worker either.
   */
  private async recordDeadLetter(
    job: Job<TPayload, TResult>,
    error: Error,
    ctx: WorkerContext,
  ): Promise<void> {
    if (!this.deadLetterRecorder) {
      return;
    }
    try {
      await this.deadLetterRecorder.record({
        queue: job.queueName,
        jobId: ctx.jobId,
        payload: job.data,
        error: error.stack ?? error.message,
      });
    } catch (recorderErr) {
      const recorderError =
        recorderErr instanceof Error ? recorderErr : new Error(String(recorderErr));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'worker.dead_letter_record_failed',
          worker: ctx.workerName,
          jobId: ctx.jobId,
          message: recorderError.message,
        }),
      );
      try {
        this.observer.captureBackgroundFailure(recorderError, {
          kind: 'dead_letter.record_failed',
          tags: { worker: ctx.workerName, job_id: ctx.jobId },
        });
      } catch (observerErr) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'worker.observer_failed',
            worker: ctx.workerName,
            message: observerErr instanceof Error ? observerErr.message : String(observerErr),
          }),
        );
      }
    }
  }

  /** Structured lifecycle log line. */
  private emit(event: WorkerEvent, ctx: WorkerContext, extra?: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: 'info',
        kind: event,
        worker: ctx.workerName,
        jobId: ctx.jobId,
        mailboxAccountId: ctx.mailboxAccountId,
        attempt: ctx.attempt,
        ...extra,
      }),
    );
  }
}

/** Reject if `promise` does not settle within `ms` (policy timeout guard). */
async function withTimeout<T>(promise: Promise<T>, ms: number, workerName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${workerName} exceeded ${ms}ms timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
