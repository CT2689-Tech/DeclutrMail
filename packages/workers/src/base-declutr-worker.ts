import { type Job, UnrecoverableError } from 'bullmq';

import type { WorkerContext } from './worker-context.js';
import { isNonRetryable } from './worker-errors.js';
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
 * the SINGLE failure-capture point. Subclasses implement only
 * `processJob()` and declare a `policy`.
 *
 * Deliberate deviation from D203's `extends WorkerHost` sketch: this is a
 * framework-agnostic abstract class, not a NestJS `WorkerHost`. That
 * keeps `packages/workers` free of a NestJS dependency — the BullMQ
 * `Worker` is created in the composition root (`apps/api`) and delegates
 * each job to `run()`. D203's *core principle* (abstract class +
 * `processJob()` + named policy) is preserved; only the NestJS coupling
 * is dropped. Surfaced in the PR body.
 *
 * Out of PR-C scope (lands with later PRs): checkpointing, the
 * `dead_letter_jobs` table, AsyncLocalStorage correlation ids, and
 * Sentry/PostHog emission (D159). `captureFailure()` is the single seam
 * those route through later.
 */
export abstract class BaseDeclutrWorker<TPayload, TResult> {
  /** Stable name for logs + failure capture. */
  abstract readonly workerName: string;

  /** Exactly one of the five D225 policies (`architecture-guardian` Check B). */
  abstract readonly policy: WorkerPolicy;

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
   * subclass writes the feature's failed state here.
   */
  protected onTerminalFailure?(payload: TPayload, error: Error, ctx: WorkerContext): Promise<void>;

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
   * The single failure-capture point (D203 — "Sentry once per failure").
   * Wired to Sentry by D159; until then it writes a structured error log.
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
