import { mailboxAccounts, providerSyncState } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { applyAutomaticProtection } from './automatic-protection.js';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { MailboxActionLock } from './label-action.worker.js';
import { reconcileSenderTimeseries } from './sender-timeseries-reconcile.js';
import type { WorkerContext } from './worker-context.js';

/** Drizzle client bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Mailboxes swept per tick.
 *
 * `cronPolicy` caps the job at 60s, and `withTimeout` enforces that with
 * a bare `Promise.race` — it rejects the outer promise but does NOT
 * cancel the transaction underneath, which keeps running on its backend
 * still holding the per-mailbox advisory lock. So an unbounded serial
 * loop does not merely run long; it fails the job, and the retry starts
 * again from the FIRST mailbox and then blocks up to
 * `MAILBOX_LOCK_TIMEOUT` (45s of its own 60s budget) on the lock the
 * previous attempt leaked.
 *
 * With a stable select order that starves the tail deterministically:
 * the same head mailboxes are swept every night and the same tail
 * mailboxes are never swept at all. Since this worker is the ONLY path
 * that retires the clock-driven protections, those mailboxes would keep
 * showing "protected because you starred it" against a two-year-old
 * star — the D245 §2.6 violation this file exists to prevent, reached by
 * a different route.
 *
 * `random()` is what makes the cap a DELAY rather than an exclusion: a
 * capped tick truncates at different mailboxes each night, so every
 * mailbox is swept eventually instead of a fixed set never being swept.
 * Same reasoning and same shape as `LapseReengagementWorker`'s
 * `CANDIDATE_BATCH_SIZE`, which documents this failure mode for the same
 * policy.
 *
 * Sized against the measured worst case in the header below: ~10-15s for
 * a 100k-message mailbox, so 4 fits inside 60s with margin. Raise it
 * only alongside a real measurement, or move to one job per mailbox
 * under `perMailboxPolicy` if the fleet outgrows a single tick.
 */
export const MAILBOX_BATCH_SIZE = 4;

/**
 * Nightly sweep payload. The cron scheduler enqueues one job per tick
 * keyed on `(worker_name, scheduled_at_minute)` per D225; the payload
 * carries no per-mailbox state because the worker sweeps every eligible
 * mailbox in one pass.
 */
export interface SenderIndexSweepJobData {
  /** ISO-8601 minute (`2026-08-24T03:00`) — the D225 cron key. */
  scheduledAtMinute: string;
}

/**
 * One sweep pass, surfaced on the `worker.succeeded` structured log so
 * the D159 seam can chart drift over time. Metric-only — no mailbox
 * ids, no sender keys (D7/D228).
 */
export interface SenderIndexSweepResult {
  /**
   * Mailboxes the sweep completed.
   *
   * NAMED to match `SAFE_WORKER_RESULT_KEYS` in `base-declutr-worker`,
   * which is a denylist by omission: a key absent from it is silently
   * dropped from the `worker.succeeded` line with no error anywhere.
   * This field shipped as `mailboxesSwept` and vanished from the ops log
   * while `mailboxesFailed: 0` sat next to it — a sweep reporting a
   * duration and no scope. Caught by the local smoke, not by any test.
   */
  mailboxesProcessed: number;
  /** Mailboxes that threw and were skipped (the sweep continued). */
  mailboxesFailed: number;
  /** Sender-months whose stored counters disagreed with a live recount. */
  timeseriesCorrected: number;
  /** Sender-months whose messages are all gone, zeroed rather than deleted. */
  timeseriesZeroed: number;
  /** Wall-clock duration of the whole pass. */
  durationMs: number;
}

/**
 * SenderIndexSweepWorker — the unscoped half of the derived sender index.
 *
 * ## Why this exists
 *
 * Two recomputes used to run on EVERY Gmail Pub/Sub push, inside the
 * per-mailbox advisory lock:
 *
 *   - `applyAutomaticProtection` (unscoped): 95,090 rows / 17,918
 *     buffers / 5,984 ms on the founder's 100k-message mailbox,
 *     measured on prod 2026-08-23.
 *   - `reconcileSenderTimeseries`: two full-mailbox passes, 79,552
 *     buffers and ~9.8 MB spilled to temp per call.
 *
 * At 362 pushes a day producing 144 new messages, that is roughly two
 * gigabytes of buffer traffic per new message — and because it ran
 * under the lock, a user pressing Delete queued behind it. The measured
 * `pg_advisory_lock` wait on 2026-08-23 was 5,462 ms mean.
 *
 * The per-push path now runs auto-protection SCOPED to the senders the
 * push actually touched. That covers every event-driven input. It
 * cannot cover the two CLOCK-driven ones — a star or an IMPORTANT count
 * ageing past `interval '1 year'` — because no Gmail event announces
 * the passage of time. This worker is what retires those, and what
 * closes `volume` / `read_count` drift.
 *
 * Dropping this cron would leave protections pinned to expired
 * evidence: a sender the product says is protected "because you starred
 * it" whose star is two years old. D245 requires the reason be true.
 *
 * ## Policy and isolation
 *
 * `cronPolicy` (D203/D225). The cron driver in `apps/api/src/worker.ts`
 * ticks the queue; idempotency keys to `(worker_name,
 * scheduled_at_minute)` so concurrent enqueues collapse to one run.
 *
 * FAILURE ISOLATION: one bad mailbox must not stop the sweep. Each
 * mailbox runs inside its own try/catch — a failure is logged, counted,
 * and the sweep continues. The JOB only fails when EVERY eligible
 * mailbox failed, which indicates a systemic fault rather than one bad
 * row.
 *
 * Privacy (D7/D228): no Gmail call, no body, snippet, attachment or
 * non-allowlisted header. Pure recompute over columns already held.
 */
export class SenderIndexSweepWorker extends BaseDeclutrWorker<
  SenderIndexSweepJobData,
  SenderIndexSweepResult
> {
  override readonly workerName = 'SenderIndexSweepWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: { db: WorkerDb; lock: MailboxActionLock }) {
    super();
  }

  /** D225 cron idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: SenderIndexSweepJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: SenderIndexSweepJobData,
    _ctx: WorkerContext,
  ): Promise<SenderIndexSweepResult> {
    const startedAt = Date.now();

    // No `notNeedingReconnect` here, deliberately — unlike every other
    // periodic sweep, this one spends no Gmail grant. It recomputes
    // derived state from rows we already hold, so a mailbox awaiting
    // reconnect is swept exactly as usefully as any other: its
    // protections must still retire on the clock while the user is away.
    const mailboxes = await this.deps.db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .innerJoin(providerSyncState, eq(providerSyncState.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(eq(mailboxAccounts.status, 'active'), eq(providerSyncState.readinessStatus, 'ready')),
      )
      // RANDOM, and BOUNDED. Both matter, and neither is a performance
      // tweak — see MAILBOX_BATCH_SIZE.
      .orderBy(sql`random()`)
      // ONE MORE THAN THE CAP, deliberately. The extra row is a probe:
      // it is the difference between "the batch was full" and "there was
      // more than the batch could take", and only the second is worth
      // warning about. Prod currently has exactly MAILBOX_BATCH_SIZE
      // eligible mailboxes, so a `>= cap` test would fire every single
      // night having swept every one of them — and a guard that cries
      // wolf nightly is one nobody reads by the time it is true.
      .limit(MAILBOX_BATCH_SIZE + 1);

    const overflowed = mailboxes.length > MAILBOX_BATCH_SIZE;
    if (overflowed) {
      // Never silent. Mailboxes went unswept this tick and
      // `mailboxesProcessed` cannot show it — a capped run and a
      // complete run otherwise report the same shape.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'sender_index_sweep.batch_capped',
          cap: MAILBOX_BATCH_SIZE,
        }),
      );
      mailboxes.length = MAILBOX_BATCH_SIZE;
    }

    let mailboxesProcessed = 0;
    let mailboxesFailed = 0;
    let timeseriesCorrected = 0;
    let timeseriesZeroed = 0;

    for (const { id: mailboxAccountId } of mailboxes) {
      try {
        // Same per-mailbox advisory lock the label actions and the
        // incremental sync take. Neither recompute mutates Gmail and
        // both are idempotent, so the lock is not required for
        // correctness — it is here so a sweep and a sync never compute
        // from interleaved snapshots and write each other's answer.
        // Nightly, at concurrency 1, the hold costs nothing a user sees.
        await this.deps.lock.run(mailboxAccountId, async () => {
          await this.deps.db.transaction(async (tx) => {
            const reconciled = await reconcileSenderTimeseries(tx, mailboxAccountId);
            timeseriesCorrected += reconciled.corrected;
            timeseriesZeroed += reconciled.zeroed;
            // UNSCOPED on purpose. This call is the entire reason the
            // per-push path is allowed to be scoped.
            await applyAutomaticProtection(tx, mailboxAccountId);
          });
        });
        mailboxesProcessed += 1;
      } catch (err) {
        mailboxesFailed += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'sender_index_sweep.mailbox_failed',
            worker: this.workerName,
            mailboxAccountId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    if (mailboxes.length > 0 && mailboxesProcessed === 0) {
      // Every eligible mailbox failed — systemic, so let the job fail
      // into retry + dead-letter rather than reporting a clean pass that
      // swept nothing. A partial failure is isolated above.
      throw new Error(`sender index sweep failed for all ${mailboxesFailed} eligible mailboxes`);
    }

    return {
      mailboxesProcessed,
      mailboxesFailed,
      timeseriesCorrected,
      timeseriesZeroed,
      durationMs: Date.now() - startedAt,
    };
  }
}
