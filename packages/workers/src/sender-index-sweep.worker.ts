import { mailboxAccounts, providerSyncState } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { applyAutomaticProtection } from './automatic-protection.js';
import { BaseDeclutrWorker, telemetryReference } from './base-declutr-worker.js';
import { deletionPendingSql } from './deletion-pause.js';
import {
  expireUnbackedPrimaryKeeps,
  reconcileSenderCategories,
  sendersAwaitingRescore,
} from './gmail-category.js';
import type { MailboxActionLock } from './label-action.worker.js';
import { notNeedingReconnect } from './mailbox-reconnect.js';
import { reconcileSenderTimeseries } from './sender-timeseries-reconcile.js';
import type { WorkerContext } from './worker-context.js';

/** Drizzle client bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/** Each transaction batch stays bounded; keyset continuations cover the whole fleet. */
export const MAILBOX_BATCH_SIZE = 1;

/**
 * Most senders one sweep asks the score worker to re-score for a mailbox.
 * The set travels as one BullMQ job and, if it dead-letters, one row, so
 * it is bounded: a sender key is a 64-character hash, ~67 bytes in the
 * JSON payload, so this is ~134 KB. Senders past the cap (the smallest —
 * `sendersAwaitingRescore` lists the largest first) stay marked and are
 * asked for on the next sweep; Autopilot ignores a marked verdict
 * meanwhile.
 */
export const MAX_RESCORE_SET = 2_000;

/**
 * Sweep payload. The composition root enqueues a tick at every worker
 * boot, then every 24 hours: one job per tick keyed on
 * `(worker_name, scheduled_at_minute)` per D225. Continuations
 * carry an exclusive cursor so bounded jobs cover every eligible mailbox.
 */
export interface SenderIndexSweepJobData {
  /** ISO-8601 minute (`2026-08-24T03:00`) — the D225 cron key. */
  scheduledAtMinute: string;
  /** Exclusive mailbox cursor for a durable continuation of this sweep. */
  afterMailboxId?: string;
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
  /** Senders whose Gmail tab changed on a recount of their labelled mail. */
  categoriesCorrected: number;
  /** Primary Keeps (rule 3) the current rule no longer backs, marked for re-score. */
  primaryKeepsExpired: number;
  /** Automatic protections withdrawn and not restored under a current reason. */
  protectionsReleased: number;
  /**
   * Senders handed to the score worker because a recount marked their
   * decision stale — this run's changes plus any earlier request that
   * never landed (see `sendersAwaitingRescore`).
   */
  rescoresRequested: number;
  /** Senders whose re-score request failed; asked for again on the next sweep. */
  rescoresNotRequested: number;
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
 * ticks the queue; idempotency keys include the scheduling minute and
 * optional continuation cursor so repeated enqueues deduplicate.
 *
 * FAILURE ISOLATION: each bounded job enqueues its continuation before
 * reporting failure. A bad mailbox can retry or dead-letter without
 * preventing later mailboxes in the same sweep from being attempted.
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

  constructor(
    private readonly deps: {
      db: WorkerDb;
      lock: MailboxActionLock;
      statementTimeoutMs?: number;
      enqueueContinuation?: (payload: SenderIndexSweepJobData) => Promise<void>;
      /**
       * Re-score the senders whose Gmail tab a recount changed. Their
       * verdict and explanation were computed from the old tab — "Kept
       * because Gmail puts them in your Primary inbox" on a sender with
       * no Primary mail — and nothing else re-scores a sender on a
       * timer. Called after the transaction commits and the lock is
       * released, never inside either (CLAUDE.md §2.6). Required: an
       * optional hook left unwired would correct every tab and quietly
       * keep every verdict computed from the old one.
       */
      onSendersRecategorized: (
        mailboxAccountId: string,
        senderKeys: readonly string[],
      ) => Promise<void>;
      /** Test seam for `MAX_RESCORE_SET`. */
      rescoreSetLimit?: number;
    },
  ) {
    super();
  }

  /** D225 cron idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: SenderIndexSweepJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}:${payload.afterMailboxId ?? 'root'}`;
  }

  override async processJob(
    payload: SenderIndexSweepJobData,
    ctx: WorkerContext,
  ): Promise<SenderIndexSweepResult> {
    const startedAt = Date.now();

    // The recount and the clock-driven retirements spend no Gmail grant:
    // they recompute derived state from rows we already hold, so a
    // mailbox awaiting reconnect is swept exactly as usefully as any
    // other — its protections must still retire while the user is away.
    //
    // Every mailbox whose senders can still be read or exported, except
    // one mid-scan (`queued`/`syncing`): its rebuild rewrites the same
    // derived state itself. A disconnected mailbox keeps its data until
    // it is deleted, and the data export prints its `gmail_category`, so
    // skipping it would leave a Primary no label backs in the user's
    // own export.
    //
    // The RE-SCORE is different: `triage.score_run_completed` wakes the
    // Autopilot apply sweep, whose Active presets archive and unsubscribe
    // in Gmail. So it is asked for only where that chain may run — an
    // active, ready mailbox with a working grant and no account or data
    // deletion in its undo window (D232). The other mailboxes keep their
    // marks, which the first sweep after they are eligible again asks for.
    const mailboxes = await this.deps.db
      .select({
        id: mailboxAccounts.id,
        rescoreEligible: sql<boolean>`(
          ${mailboxAccounts.status} = 'active'
          AND ${providerSyncState.readinessStatus} = 'ready'
          AND (${notNeedingReconnect})
          AND NOT (${deletionPendingSql})
        )`,
      })
      .from(mailboxAccounts)
      .innerJoin(providerSyncState, eq(providerSyncState.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(
          or(
            eq(mailboxAccounts.status, 'disconnected'),
            inArray(providerSyncState.readinessStatus, ['ready', 'failed']),
          ),
          payload.afterMailboxId ? gt(mailboxAccounts.id, payload.afterMailboxId) : undefined,
        ),
      )
      .orderBy(mailboxAccounts.id)
      .limit(MAILBOX_BATCH_SIZE + 1);

    const overflowed = mailboxes.length > MAILBOX_BATCH_SIZE;
    // A full batch is normal; a durable continuation, not a warning, handles the tail.
    if (overflowed) mailboxes.length = MAILBOX_BATCH_SIZE;

    let mailboxesProcessed = 0;
    let mailboxesFailed = 0;
    let timeseriesCorrected = 0;
    let timeseriesZeroed = 0;
    let categoriesCorrected = 0;
    let primaryKeepsExpired = 0;
    let protectionsReleased = 0;
    let rescoresRequested = 0;
    let rescoresNotRequested = 0;
    const statementTimeout = String(this.deps.statementTimeoutMs ?? 25_000);

    for (const { id: mailboxAccountId, rescoreEligible } of mailboxes) {
      ctx.signal?.throwIfAborted();
      // Which step threw, for the failure line — the error itself may
      // carry row data and never leaves this process (D7). `lock` is a
      // failure to acquire, before any step ran.
      let step: 'lock' | 'timeseries' | 'categories' | 'protection' = 'lock';
      // One SHORT hold per step, not one for all of them. Same per-mailbox
      // advisory lock the label actions and the incremental sync take: not
      // needed for correctness (every step is idempotent), it keeps a sweep
      // and a sync from computing from interleaved snapshots. A user's
      // Archive or Delete queues behind whichever hold is open, so each is
      // kept to one pass. The ORDER is what matters: the recount commits
      // before protection reads `gmail_category = 'primary'`.
      const hold = <T>(
        name: 'timeseries' | 'categories' | 'protection',
        body: (tx: Parameters<Parameters<WorkerDb['transaction']>[0]>[0]) => Promise<T>,
      ): Promise<T> => {
        step = 'lock';
        return this.deps.lock.run(mailboxAccountId, async () => {
          ctx.signal?.throwIfAborted();
          step = name;
          return this.deps.db.transaction(async (tx) => {
            // SET LOCAL disappears at transaction end and works through transaction pooling.
            await tx.execute(
              sql`select set_config('statement_timeout', ${statementTimeout}, true)`,
            );
            ctx.signal?.throwIfAborted();
            const out = await body(tx);
            ctx.signal?.throwIfAborted();
            return out;
          });
        });
      };
      try {
        const reconciled = await hold('timeseries', (tx) =>
          reconcileSenderTimeseries(tx, mailboxAccountId),
        );
        timeseriesCorrected += reconciled.corrected;
        timeseriesZeroed += reconciled.zeroed;

        const recount = await hold('categories', async (tx) => {
          const changed = await reconcileSenderCategories(tx, mailboxAccountId);
          ctx.signal?.throwIfAborted();
          return { changed, expired: await expireUnbackedPrimaryKeeps(tx, mailboxAccountId) };
        });
        categoriesCorrected += recount.changed.length;
        primaryKeepsExpired += recount.expired;

        // UNSCOPED on purpose. This call is the entire reason the per-push
        // path is allowed to be scoped.
        const { released, awaiting } = await hold('protection', async (tx) => {
          const protection = await applyAutomaticProtection(tx, mailboxAccountId);
          ctx.signal?.throwIfAborted();
          return {
            released: protection.released,
            awaiting: await sendersAwaitingRescore(tx, mailboxAccountId),
          };
        });
        protectionsReleased += released.length;
        if (released.length > 0) this.logReleased(mailboxAccountId, released);
        mailboxesProcessed += 1;

        if (rescoreEligible && awaiting.length > 0) {
          const batch = awaiting.slice(0, this.deps.rescoreSetLimit ?? MAX_RESCORE_SET);
          if (await this.requestRescore(mailboxAccountId, batch)) {
            rescoresRequested += batch.length;
          } else {
            rescoresNotRequested += batch.length;
          }
        }
      } catch (err) {
        mailboxesFailed += 1;
        // SQLSTATE only — a closed five-character code ("57014" is a
        // statement timeout), never the message, which can carry row
        // data (D7).
        const code = (err as { code?: unknown } | null)?.code;
        console.error(
          JSON.stringify({
            severity: 'ERROR',
            level: 'error',
            kind: 'sender_index_sweep.mailbox_failed',
            worker: this.workerName,
            mailboxRef: telemetryReference(mailboxAccountId),
            step,
            ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { sqlState: code } : {}),
            errorKind: ctx.signal?.aborted ? 'cancelled' : 'reconciliation_failed',
          }),
        );
      }
    }

    if (overflowed) {
      if (!this.deps.enqueueContinuation)
        throw new Error('sender index sweep continuation is not configured');
      await this.deps.enqueueContinuation({
        scheduledAtMinute: payload.scheduledAtMinute,
        afterMailboxId: mailboxes[mailboxes.length - 1]!.id,
      });
    }

    ctx.signal?.throwIfAborted();
    if (mailboxes.length > 0 && mailboxesProcessed === 0) {
      // Retry this batch instead of reporting a clean pass that swept
      // nothing. Its durable continuation has already been enqueued.
      throw new Error(`sender index sweep failed for all ${mailboxesFailed} eligible mailboxes`);
    }

    return {
      mailboxesProcessed,
      mailboxesFailed,
      timeseriesCorrected,
      timeseriesZeroed,
      categoriesCorrected,
      primaryKeepsExpired,
      protectionsReleased,
      rescoresRequested,
      rescoresNotRequested,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * One line per mailbox that lost automatic protections this pass, by
   * the reason they had — a release is withdrawn safety state, so it is
   * never silent. Counts only: no sender identity leaves the process.
   */
  private logReleased(
    mailboxAccountId: string,
    released: ReadonlyArray<{ priorReason: string }>,
  ): void {
    const byReason: Record<string, number> = {};
    for (const r of released) byReason[r.priorReason] = (byReason[r.priorReason] ?? 0) + 1;
    console.log(
      JSON.stringify({
        severity: 'INFO',
        level: 'info',
        kind: 'sender_index_sweep.protections_released',
        worker: this.workerName,
        mailboxRef: telemetryReference(mailboxAccountId),
        released: released.length,
        byReason,
      }),
    );
  }

  /**
   * Ask the score worker for the recount's senders. Never throws: the
   * correction has already committed, and the senders stay marked
   * (`sendersAwaitingRescore`), so the next sweep asks again. Until a
   * new verdict lands, lists and Triage show the old one and a page open
   * refreshes it; Autopilot does not act on it (a marked decision reads
   * as "no decision" in `materializeAutopilotSignals`). A failure is
   * captured, not just printed — `console.error` reaches nobody (Sentry
   * runs with `integrations: []`) — and counted on the success line, so
   * "corrected N tabs" cannot read as "and re-scored them".
   */
  private async requestRescore(
    mailboxAccountId: string,
    senderKeys: readonly string[],
  ): Promise<boolean> {
    try {
      await this.deps.onSendersRecategorized(mailboxAccountId, senderKeys);
      return true;
    } catch (err) {
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          level: 'error',
          kind: 'sender_index_sweep.rescore_enqueue_failed',
          worker: this.workerName,
          mailboxRef: telemetryReference(mailboxAccountId),
          senders: senderKeys.length,
        }),
      );
      this.observer.captureBackgroundFailure(err instanceof Error ? err : new Error(String(err)), {
        kind: 'sender_index_sweep.rescore_enqueue_failed',
        // Server Sentry tags are allowlisted (sentry-scrubber.ts); the
        // count rides on the log line above.
        tags: { worker: this.workerName, mailbox_account_id: mailboxAccountId },
      });
      return false;
    }
  }
}
