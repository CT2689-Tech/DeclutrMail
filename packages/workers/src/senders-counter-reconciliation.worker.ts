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

    // SECOND COUNTER: `wrote_to_count`.
    //
    // Until 2026-08-21 this worker recounted `total_received` only, and
    // that was survivable because every incremental push re-derived
    // `wrote_to_count` for the WHOLE mailbox -- the sync path was
    // accidentally also its reconciler. Scoping that recompute to the
    // senders a batch touches (the change this ships alongside) removes
    // that safety net, so the counter needs a real one here.
    //
    // It matters more than a number being slightly wrong. `wrote_to_count
    // >= 3` is the `'replied'` branch of automatic protection (D245,
    // CLAUDE.md 2.6), so a stale-high value silently Protects a sender --
    // excluding it from bulk actions and showing the user a reason that
    // is not true -- and a stale-low value silently fails to protect one.
    //
    // Same shape as the recount above and the same source of truth as
    // migration 0063: outbound messages joined to senders on normalized
    // recipient address. `<>` on the join means zero-drift mailboxes pay
    // one scan and no writes.
    type WroteDriftRow = { old_val: string | number; new_val: string | number };
    const wroteDriftRes = await this.deps.db.execute<WroteDriftRow>(sql`
      WITH computed AS (
        SELECT s2.id AS sender_id, COUNT(DISTINCT m.id)::bigint AS cnt
        FROM mail_messages AS m
        CROSS JOIN LATERAL unnest(m.recipient_emails) AS r(addr)
        JOIN senders AS s2
          ON s2.mailbox_account_id = m.mailbox_account_id
         AND dm_normalize_email(s2.email::text) = dm_normalize_email(r.addr)
        WHERE m.is_outbound = true
        GROUP BY s2.id
      ),
      drift AS (
        SELECT s.id,
               s.wrote_to_count AS old_val,
               COALESCE(c.cnt, 0)::bigint AS new_val
        FROM senders s
        LEFT JOIN computed c ON c.sender_id = s.id
        WHERE s.wrote_to_count <> COALESCE(c.cnt, 0)
      )
      UPDATE senders
      SET wrote_to_count = drift.new_val, updated_at = now()
      FROM drift
      WHERE senders.id = drift.id
      RETURNING drift.old_val AS old_val, drift.new_val AS new_val
    `);
    const wroteDrifted = extractRows<WroteDriftRow>(wroteDriftRes);
    if (wroteDrifted.length > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'senders.wrote_to_counter_drift',
          corrected: wroteDrifted.length,
          totalSenders,
        }),
      );
    }

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
 * fallback). Normalises both to a plain array so callers don't branch
 * on the driver.
 */
function extractRows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}
