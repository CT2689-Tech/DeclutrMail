import { mailMessages, readStateNotSweeperMarked, senderTimeseries } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';

/**
 * Recompute `sender_timeseries.volume` + `read_count` from `mail_messages`.
 *
 * Both were write-once counters: the sync workers incremented them at
 * message-INSERT time and nothing ever revisited them. `read_count` is
 * the one that broke visibly. Read state is not fixed at arrival — the
 * user reads mail afterwards, Gmail emits a `labelsRemoved: [UNREAD]`
 * history record, and `IncrementalSyncWorker.handleLabelChange` correctly
 * flips `mail_messages.is_unread`. The counter was never part of that
 * flip, so a message's contribution to `read_count` was frozen at
 * whatever it was in its first second of life.
 *
 * The two readers then disagreed permanently. Measured on the founder's
 * mailbox 2026-08-18: one message was read in Gmail, the worker applied
 * the label change within seconds, the live `mail_messages` aggregate
 * moved `0/9 → 1/9`, and `sender_timeseries` for that month stayed at
 * `volume 9, read_count 0`. 753 sender-months disagreed with a live
 * recount.
 *
 * That mattered because `read_count` is the ONLY reader the scoring and
 * Autopilot paths use (`score.worker.ts`, `autopilot-signals.ts`), while
 * the UI reads `mail_messages` live — so the number shown to the user and
 * the number driving an Unsubscribe recommendation came from different
 * places, and only the second was stale.
 *
 * ## Why `volume` is recomputed too, and not left alone
 *
 * The first cut of this helper recomputed only `read_count`, on the
 * assumption that `volume` only ever increments and therefore stays >=
 * the live row count. That assumption is false, and a rollback-guarded
 * dry run caught it before it shipped: on the founder's mailbox 671
 * sender-months already had a drifted `volume` and 330 of them
 * UNDERCOUNTED. Recomputing the numerator against a stale denominator
 * would have pushed 269 rows to `read_count > volume` — a read rate above
 * 1, which `runCascade` rule 5 (`>= 0.5`) would have read as an engaged
 * reader. Today 0 rows violate that invariant; the partial fix would have
 * created the violation.
 *
 * Deriving both from one aggregate keeps the ratio in `[0, 1]` by
 * construction and makes the two columns describe the same set: the
 * messages we currently hold. It also matches the convergence rule the
 * neighbouring `reply_count` reconcile already states — backfill, initial
 * sync and incremental sync all land on the same derived state.
 *
 * Consequence worth naming: a month whose messages Gmail has since
 * deleted now reports the volume we actually hold, not the volume we once
 * saw. That is the same thing every live `mail_messages` query on the
 * senders surface already reports, so this removes a divergence rather
 * than creating one.
 *
 * Recompute rather than delta-adjust inside `handleLabelChange`: a
 * recompute is idempotent under BullMQ retries and cannot drift, which is
 * why the `reply_count` reconcile is written the same way. It is also
 * self-healing — a mailbox whose read state went stale during worker
 * downtime is corrected by the next sync rather than staying wrong until
 * a full re-sync.
 *
 * ## The month key is UTC, deliberately
 *
 * Rows are keyed by `startOfMonthISO`, which reads `getUTCFullYear()` /
 * `getUTCMonth()`. A bare `date_trunc('month', internal_date)` uses the
 * SESSION time zone instead, so for any message near a month boundary the
 * two disagree and this helper would look at a live row, find no matching
 * group, and treat it as an orphan — zeroing a month that has mail in it.
 * `AT TIME ZONE 'UTC'` pins the read to the writer's semantics.
 * (`incremental-sync.worker.test.ts`'s redelivery case caught exactly
 * this: `volume` came back 0 where the fixture had 1.)
 *
 * The neighbouring `reply_count` reconcile still truncates in the session
 * zone. It is not corrected here — it only ever UPDATEs matched rows, so a
 * key mismatch silently skips rather than destroys — but it is the same
 * latent inconsistency and worth its own pass.
 *
 * Returns row counts so the drift is CHARTABLE. The premise of this
 * module is that 753 sender-months were wrong for months with nobody
 * noticing; shipping a silent fix would leave the next drift just as
 * invisible. `SendersCounterReconciliationWorker` already sets this
 * precedent by putting its correction counts on `worker.succeeded`.
 * Counts carry no PII.
 *
 * ## The numerator excludes sweeper-marked mail
 *
 * `read_count` counts messages WITHOUT the `UNREAD` label — a bit any
 * tool with API access can write, and on the founder's mailbox one
 * third-party sweeper wrote it 20,819 times (27.5% of the read signal,
 * F012). `readStateNotSweeperMarked` removes those from the numerator
 * only; the message still counts toward `volume`, because it did arrive.
 *
 * The predicate is IMPORTED, not repeated: the live senders query applies
 * the identical one, and this module exists because those two disagreeing
 * is what made a read rate mean two different things at once.
 *
 * Privacy (D7 / D228): reads `sender_key`, `internal_date`, `is_unread`,
 * `is_outbound` and `label_ids`, plus label names from `mailbox_labels`.
 * No body, no snippet, no header.
 */
export interface SenderTimeseriesReconcileResult {
  /** Months whose stored counters disagreed with `mail_messages`. */
  corrected: number;
  /** Months whose messages are all gone, zeroed rather than deleted. */
  zeroed: number;
}

export async function reconcileSenderTimeseries(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<SenderTimeseriesReconcileResult> {
  // 1. Months we still hold messages for — both columns from one scan, so
  //    `read_count <= volume` cannot be violated.
  const corrected = await tx.execute(sql`
    UPDATE ${senderTimeseries} AS st
    SET ${sql.identifier('volume')} = sub.total,
        ${sql.identifier('read_count')} = sub.read_total
    FROM (
      SELECT
        m.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
        m.${sql.identifier('sender_key')} AS sender_key,
        date_trunc('month', m.${sql.identifier('internal_date')} AT TIME ZONE 'UTC')::date AS year_month,
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (
          WHERE m.${sql.identifier('is_unread')} = false
            AND ${readStateNotSweeperMarked('m')}
        )::integer AS read_total
      FROM ${mailMessages} AS m
      WHERE m.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND m.${sql.identifier('is_outbound')} = false
      GROUP BY
        m.${sql.identifier('mailbox_account_id')},
        m.${sql.identifier('sender_key')},
        date_trunc('month', m.${sql.identifier('internal_date')} AT TIME ZONE 'UTC')
    ) AS sub
    WHERE st.${sql.identifier('mailbox_account_id')} = sub.mailbox_account_id
      AND st.${sql.identifier('sender_key')} = sub.sender_key
      AND st.${sql.identifier('year_month')} = sub.year_month
      AND (
        st.${sql.identifier('volume')} IS DISTINCT FROM sub.total
        OR st.${sql.identifier('read_count')} IS DISTINCT FROM sub.read_total
      )
    RETURNING 1
  `);

  // 2. Months whose messages are all gone (Gmail tombstones). The join
  //    above cannot reach these — there is no group left to join to — so
  //    without this they keep a stale non-zero volume forever. Zeroed
  //    rather than deleted: the row is the sender's history for that
  //    month, and "we hold nothing" is a fact worth keeping addressable.
  const zeroed = await tx.execute(sql`
    UPDATE ${senderTimeseries} AS st
    SET ${sql.identifier('volume')} = 0,
        ${sql.identifier('read_count')} = 0
    WHERE st.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND (st.${sql.identifier('volume')} <> 0 OR st.${sql.identifier('read_count')} <> 0)
      AND NOT EXISTS (
        SELECT 1
        FROM ${mailMessages} AS m
        WHERE m.${sql.identifier('mailbox_account_id')} = st.${sql.identifier('mailbox_account_id')}
          AND m.${sql.identifier('sender_key')} = st.${sql.identifier('sender_key')}
          AND m.${sql.identifier('is_outbound')} = false
          AND date_trunc('month', m.${sql.identifier('internal_date')} AT TIME ZONE 'UTC')::date
              = st.${sql.identifier('year_month')}
      )
    RETURNING 1
  `);

  return { corrected: rowCount(corrected), zeroed: rowCount(zeroed) };
}

/**
 * Row count from a Drizzle `execute` result, which is array-like for
 * postgres.js. Defensive rather than cast: a shape change here would
 * otherwise turn into a fabricated `0` on a telemetry field, which is
 * the exact defect class this module exists to fix.
 */
function rowCount(result: unknown): number {
  // postgres.js returns an array-like; PGlite (the test driver) returns
  // `{ rows }`. Both shapes are handled because a driver-shape mismatch
  // would otherwise report a confident `0` corrected on a run that
  // corrected hundreds — a fabricated telemetry value, which is the
  // defect class this module exists to fix.
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
    const len = (result as { length?: unknown }).length;
    if (typeof len === 'number') return len;
  }
  return 0;
}
