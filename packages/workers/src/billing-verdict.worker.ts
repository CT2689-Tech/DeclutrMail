import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { cronRuns } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { WorkerContext } from './worker-context.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Periodic verdict payload. The cron scheduler enqueues one job per
 * tick keyed on `(worker_name, scheduled_at_minute)` per D225; the
 * payload carries no per-workspace state because the pass sweeps every
 * outstanding verdict row itself.
 */
export interface BillingVerdictJobData {
  /**
   * The scheduling minute — the BullMQ jobId component AND the
   * `cron_runs.run_key` suffix (D225 cron idempotency). ISO-8601
   * minute (`2026-08-12T14:35`), derived by the scheduler from `now()`.
   */
  scheduledAtMinute: string;
}

/**
 * Counts returned by one pass — logged on `worker.succeeded`. Every key
 * here must also be listed in `SAFE_WORKER_RESULT_KEYS`
 * (`base-declutr-worker.ts`) or it is silently dropped from that line.
 * Metric-only per the `BaseDeclutrWorker.processJob` contract: counts
 * and durations, never provider identifiers (D7).
 */
export interface BillingVerdictResult {
  /**
   * `swept` — this run claimed the `cron_runs` slot and ran the pass.
   * `duplicate_run_key` — another run already SUCCEEDED for this
   * run-key (double-fired tick / second replica); clean no-op.
   */
  outcome: 'swept' | 'duplicate_run_key';
  /** Local refund/chargeback verdicts newly pushed to the provider. */
  enforced: number;
  /** Verdict rows the provider would not confirm a cancel for this run. */
  unenforced: number;
  /** Verdicts the provider CONTRADICTED — refund rejected / chargeback reversed. */
  refuted: number;
  /**
   * Refunds the provider CONFIRMED — the plan slot was freed and the
   * customer can purchase again. This is the counter D253 exists for, so
   * it is the one this line must never drop.
   */
  settled: number;
  /** Locally-canceled rows checked against provider billing state. */
  watched: number;
  /** Of those, rows the provider is still billing — the leak this catches. */
  rebilling: number;
  /** Rows the provider would not answer for — nothing asserted. */
  unreadable: number;
  /**
   * The settled-refund safety net threw and this pass therefore checked
   * NOTHING. Load-bearing: without it a broken watch is indistinguishable
   * from a clean `watched: 0` run, and a guard that reports green having
   * verified nothing is the failure mode this codebase keeps rediscovering.
   */
  watchFailed: boolean;
  /** Total wall-clock ms. */
  durationMs: number;
}

export interface BillingVerdictDeps {
  db: WorkerDb;
  /**
   * The OUTBOUND half: push local refund/chargeback verdicts to the
   * provider so it stops billing a customer whose entitlement we already
   * ended. Injected as a plain function seam rather than a service
   * because `packages/workers` cannot depend on `apps/api`, where
   * `BillingReconciliationService` (and its provider adapters, catalog
   * and Nest DI) lives. The composition root binds the method.
   */
  enforceLocalVerdicts: () => Promise<{
    enforced: number;
    unenforced: number;
    refuted: number;
    settled: number;
  }>;
  /**
   * The READ-ONLY half: detect a provider still billing a customer whose
   * subscription row we canceled locally. Same seam rationale as above.
   */
  watchSettledRefunds: () => Promise<{
    watched: number;
    rebilling: number;
    unreadable: number;
  }>;
}

/**
 * BillingVerdictWorker (D253, D249, D225) — converges the provider onto
 * the refund/chargeback verdicts only WE hold.
 *
 * Policy: `cronPolicy`. The scheduler in the composition root ticks every
 * `BILLING_VERDICT_INTERVAL_MS` (10 minutes).
 *
 * WHY IT IS NOT IN THE DRIFT SWEEP ANY MORE: this pass used to run inside
 * the 6-hourly billing reconciliation sweep, where a several-hour latency
 * only meant a refunded customer kept getting billed slightly longer than
 * necessary. D253 makes it the gate on whether that customer can BUY
 * AGAIN, and six hours of "you cannot give us money yet" is not a latency
 * budget a revenue path can carry. Its own 10-minute queue also gives it
 * BullMQ retries and a dead-letter row, which a `setInterval` sweep in the
 * composition root never had.
 *
 * Idempotency — TWO layers per D225:
 *   1. BullMQ `jobId = BillingVerdictWorker:<minute>` dedups enqueues.
 *   2. A `cron_runs` row claims `(worker_name, scheduled_at_minute)`
 *      durably: `INSERT … ON CONFLICT (run_key) DO UPDATE … WHERE
 *      status <> 'succeeded'` — a fresh run inserts, a RETRY of a
 *      crashed/failed run takes the slot back over, and a run that
 *      already succeeded returns no row → clean `duplicate_run_key`
 *      no-op. Both seams are convergence loops (they re-read state and
 *      stop matching once the provider agrees), so even a double pass is
 *      harmless — the claim exists to stop redundant provider traffic,
 *      not to protect correctness.
 *
 * FAILURE ASYMMETRY, deliberate:
 *   - `enforceLocalVerdicts` throwing FAILS the job. It is the outbound
 *     revenue path; a lost run means a customer keeps being charged, so
 *     it must retry, and on exhaustion dead-letter and page.
 *   - `watchSettledRefunds` throwing does NOT fail the job. It is a
 *     read-only detector whose next run is 10 minutes away, and failing
 *     the job would retry the outbound enforcement pass — re-sending
 *     provider cancels — purely to re-run a detection pass. Instead it is
 *     logged, sent to the observer (Sentry), and reported as
 *     `watchFailed: true` so a permanently broken detector cannot read as
 *     a clean zero.
 */
export class BillingVerdictWorker extends BaseDeclutrWorker<
  BillingVerdictJobData,
  BillingVerdictResult
> {
  override readonly workerName = 'BillingVerdictWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: BillingVerdictDeps) {
    super();
  }

  /** D225 cron idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: BillingVerdictJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    payload: BillingVerdictJobData,
    _ctx: WorkerContext,
  ): Promise<BillingVerdictResult> {
    const startedAt = Date.now();
    const runKey = `${this.workerName}:${payload.scheduledAtMinute}`;

    // D225 durable claim. `setWhere` makes the conflict-update a no-op
    // when the slot already SUCCEEDED — RETURNING is then empty and we
    // bail idempotently. A 'running'/'failed' conflict row is a retry
    // of a crashed or failed attempt of THIS SAME jobId (BullMQ holds
    // one job per run-key), so taking the slot over is safe.
    const claimed = await this.deps.db
      .insert(cronRuns)
      .values({ workerName: this.workerName, runKey, status: 'running' })
      .onConflictDoUpdate({
        target: cronRuns.runKey,
        set: { status: 'running', startedAt: sql`now()`, finishedAt: null },
        setWhere: sql`${cronRuns.status} <> 'succeeded'`,
      })
      .returning({ id: cronRuns.id });

    if (claimed.length === 0) {
      return {
        outcome: 'duplicate_run_key',
        enforced: 0,
        unenforced: 0,
        refuted: 0,
        settled: 0,
        watched: 0,
        rebilling: 0,
        unreadable: 0,
        watchFailed: false,
        durationMs: Date.now() - startedAt,
      };
    }

    let verdicts: Awaited<ReturnType<BillingVerdictDeps['enforceLocalVerdicts']>>;
    try {
      verdicts = await this.deps.enforceLocalVerdicts();
    } catch (err) {
      // Release the slot as 'failed' before rethrowing: the base class
      // retries per cronPolicy and the retry must be able to re-claim
      // (setWhere above). Leaving it 'running' would still be re-claimable
      // but would report a pass that never ended.
      await this.releaseClaim(runKey, 'failed');
      throw err;
    }

    let watch = { watched: 0, rebilling: 0, unreadable: 0 };
    let watchFailed = false;
    try {
      watch = await this.deps.watchSettledRefunds();
    } catch (err) {
      watchFailed = true;
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'billing.verdict.watch_failed',
          error: error.name,
          message: error.message,
        }),
      );
      // Not a terminal job failure (the job completes), so it routes
      // through the background seam rather than the base class's single
      // terminal capture — same Sentry adapter either way (D159).
      this.observer.captureBackgroundFailure(error, {
        kind: 'billing.verdict.watch_failed',
        tags: { worker: this.workerName },
      });
    }

    // The enforcement half landed and is durable; a failed detector must
    // not mark the run 'failed', which would only invite a retry of the
    // outbound pass. `watchFailed` carries that fact instead.
    await this.releaseClaim(runKey, 'succeeded');

    // Listed field by field rather than spread. A spread carries seam
    // fields this type never declared straight past excess-property
    // checking, and `sanitizeWorkerResult` then drops them from
    // `worker.succeeded` — so a counter added upstream would exist and be
    // invisible. `settled` was already that field once (2026-08-12).
    return {
      outcome: 'swept',
      enforced: verdicts.enforced,
      unenforced: verdicts.unenforced,
      refuted: verdicts.refuted,
      settled: verdicts.settled,
      watched: watch.watched,
      rebilling: watch.rebilling,
      unreadable: watch.unreadable,
      watchFailed,
      durationMs: Date.now() - startedAt,
    };
  }

  private async releaseClaim(runKey: string, status: 'succeeded' | 'failed'): Promise<void> {
    await this.deps.db
      .update(cronRuns)
      .set({ status, finishedAt: sql`now()` })
      .where(eq(cronRuns.runKey, runKey));
  }
}
