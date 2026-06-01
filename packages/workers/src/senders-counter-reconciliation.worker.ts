import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { WorkerContext } from './worker-context.js';

/** Drizzle client bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Periodic recount payload. The cron scheduler enqueues one job per
 * tick keyed on `(worker_name, scheduled_at_minute)` per D225; the
 * payload itself carries no per-mailbox state because the worker
 * sweeps every mailbox in a single pass.
 */
export interface SendersCounterReconciliationJobData {
  /**
   * Scheduling minute used as the BullMQ jobId for cron-keyed
   * idempotency per D225. Format: ISO-8601 minute (`2026-05-29T03:00`).
   */
  scheduledAtMinute: string;
}

/**
 * One reconciliation pass — surfaced on the `worker.succeeded` structured
 * log so the D159 observability seam can chart drift over time.
 *
 * `corrected` = senders whose stored `total_received` did not match the
 * recount; `maxAbsDelta` = largest |new - old| across corrected rows.
 * `totalSenders` is the population size so the corrected/total ratio is
 * inspectable without a follow-up query. Metric-only — no row data
 * (no mailbox ids, no sender keys) leaks into the log.
 */
export interface SendersCounterReconciliationResult {
  /** Number of senders whose stored count diverged from the recount. */
  corrected: number;
  /** Largest |new - old| across corrected rows. 0 when none drifted. */
  maxAbsDelta: number;
  /** Total senders examined (full population, not just drifted). */
  totalSenders: number;
  /** Wall-clock duration of the reconciliation pass. */
  durationMs: number;
}

/**
 * SendersCounterReconciliationWorker (ADR-0014 §"Reconciliation & drift").
 *
 * Periodic recount of `senders.total_received` against the source of
 * truth in `mail_messages`. Closes any drift the incremental Path B
 * (`xmax = 0` increment on the Pub/Sub ingest upsert) accumulates
 * between full rebuilds, and emits the `senders.counter_drift` metric
 * so drift trends are visible (D159).
 *
 * Policy: `cronPolicy` (D203/D225). Default cadence: nightly. The cron
 * driver in `apps/api/src/worker.ts` ticks the queue; idempotency keys
 * to `(worker_name, scheduled_at_minute)` so concurrent enqueues for
 * the same minute collapse to one run.
 *
 * Mechanism — one CTE statement:
 *   1. Aggregate `mail_messages WHERE is_outbound = false` GROUP BY
 *      `(mailbox_account_id, sender_key)` (the source of truth).
 *   2. LEFT JOIN `senders` so senders with no inbound messages still
 *      participate (`COALESCE(c.cnt, 0)`) — a sender with a stale
 *      non-zero count + zero remaining messages is the retention-prune
 *      drift case (ADR-0014 §"Reconciliation & drift").
 *   3. UPDATE only rows where stored <> recount; RETURNING the BEFORE
 *      value (from the CTE) so the metric can compute the delta without
 *      a second query.
 *
 * Atomicity: one UPDATE statement → either every drifted row updates or
 * none does. A torn pass cannot leave senders half-corrected because
 * Postgres' MVCC scopes the statement to a single snapshot.
 *
 * Privacy (D7 / D228): no body, snippet, attachment, or non-allowlisted
 * header touched. Counts the existing ADR-0004 `is_outbound` boolean.
 *
 * Failure mode: a single failed pass is harmless. The next nightly
 * tick re-attempts; Path A rebuilds (which fire on every new connect,
 * reconnect, OAuth re-grant) ALSO close drift atomically, so the
 * reconciliation worker is the steady-state safety net, not the only
 * source of correctness.
 */
export class SendersCounterReconciliationWorker extends BaseDeclutrWorker<
  SendersCounterReconciliationJobData,
  SendersCounterReconciliationResult
> {
  override readonly workerName = 'SendersCounterReconciliationWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: { db: WorkerDb }) {
    super();
  }

  /**
   * D225 cron idempotency key — `(worker_name, scheduled_at_minute)`.
   * Repeated enqueues for the same minute are deduped by BullMQ's
   * `jobId` (set in the queue helper).
   */
  protected override getIdempotencyKey(payload: SendersCounterReconciliationJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: SendersCounterReconciliationJobData,
    _ctx: WorkerContext,
  ): Promise<SendersCounterReconciliationResult> {
    const startedAt = Date.now();

    // Snapshot population size FIRST so the metric's denominator is
    // stable. Done outside the CTE because the UPDATE only sees
    // drifted rows; the `corrected / total` ratio in the metric needs
    // the full count.
    type CountRow = { count: string | number };
    const totalRows = await this.deps.db.execute<CountRow>(
      sql`SELECT COUNT(*)::bigint AS count FROM senders`,
    );
    const totalSenders = Number(extractRows<CountRow>(totalRows)[0]?.count ?? 0);

    // Recount in one statement. CTE computes the (mailbox, sender_key)
    // aggregate from `mail_messages`; the join carries the BEFORE value
    // (`old_val`) into the UPDATE so RETURNING can report it back
    // without a second SELECT. The `<>` filter on the CTE join itself
    // means the UPDATE only touches drifted rows — zero-drift mailboxes
    // pay one bounded scan and no writes.
    type DriftRow = { old_val: string | number; new_val: string | number };
    const driftRes = await this.deps.db.execute<DriftRow>(sql`
      WITH drift AS (
        SELECT s.id,
               s.total_received AS old_val,
               COALESCE(c.cnt, 0)::bigint AS new_val
        FROM senders s
        LEFT JOIN (
          SELECT mailbox_account_id, sender_key, COUNT(*)::bigint AS cnt
          FROM mail_messages
          WHERE is_outbound = false
          GROUP BY mailbox_account_id, sender_key
        ) c ON c.mailbox_account_id = s.mailbox_account_id
           AND c.sender_key = s.sender_key
        WHERE s.total_received <> COALESCE(c.cnt, 0)
      )
      UPDATE senders
      SET total_received = drift.new_val, updated_at = now()
      FROM drift
      WHERE senders.id = drift.id
      RETURNING drift.old_val AS old_val, drift.new_val AS new_val
    `);

    const drifted = extractRows<DriftRow>(driftRes);
    let maxAbsDelta = 0;
    for (const row of drifted) {
      const delta = Math.abs(Number(row.new_val) - Number(row.old_val));
      if (delta > maxAbsDelta) maxAbsDelta = delta;
    }

    return {
      corrected: drifted.length,
      maxAbsDelta,
      totalSenders,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * postgres-js and PGlite both wrap `db.execute()` results in a `.rows`
 * envelope (with the array-like result on the outer object as a
 * fallback). Mirrors the shape extractor in
 * `SendersReadService.listWeeklyHero` so the access pattern is
 * consistent across the codebase.
 */
function extractRows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}
