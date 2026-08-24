import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { WorkerContext } from './worker-context.js';

/** Drizzle client bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/** Cron payload — D225 `(worker_name, scheduled_at_minute)` key. */
export interface OpsRetentionJobData {
  /** ISO-8601 minute (`2026-08-24T04:00`). */
  scheduledAtMinute: string;
}

export interface OpsRetentionResult {
  /** `cron_runs` rows removed this pass. */
  cronRunsDeleted: number;
  /** `dead_letter_jobs` rows removed this pass. */
  deadLetterDeleted: number;
  /** True when a table hit the batch ceiling and has more to remove. */
  moreRemaining: boolean;
  durationMs: number;
}

/**
 * Retention for the two ops ledgers that grow forever (D159, D225).
 *
 * Neither table has ever been pruned. `cron_runs` was at 24,968 rows
 * spanning 12 June — 24 Aug, 11,823 of them older than 30 days. It is
 * small on disk (10 MB) but it is not free: a 100-byte row costs ~10,900
 * bytes of WAL, so this is one of the two heaviest WAL producers on the
 * database, and every row of it is a worker-name-and-timestamp that
 * nothing reads after the week it was written.
 *
 * ## Why `cron_runs` cannot simply delete by age
 *
 * The table is the D225 IDEMPOTENCY LEDGER — `run_key`'s unique index is
 * what stops a double-fired tick running twice — and it is ALSO the
 * source for the ops watchdog's "has WatchRenewalWorker run in the last
 * 6h?" staleness check.
 *
 * Those two roles want opposite things from a delete. Age handles the
 * first: BullMQ retries live in minutes and `removeOnComplete` caps at
 * 24h, so a 30-day-old `run_key` can never be re-claimed by anything.
 * But the second breaks on age alone — deleting the last surviving row
 * for a worker that has not run in 31 days leaves the watchdog unable to
 * tell "stalled a month ago" from "never ran", which is precisely the
 * question it exists to answer, and it would go quiet exactly when a
 * worker had been dead longest. So the most recent row per worker is
 * always kept, however old.
 *
 * ## `dead_letter_jobs`
 *
 * 90 days, and no exception. A dead-letter row is a failure record, not
 * a control structure — nothing keys off it and `DeadLetterWorker` reads
 * only the newest rows to alert on. Longer than `cron_runs` because a
 * failure is worth more history than a heartbeat.
 *
 * ## Batching
 *
 * Both deletes are capped per pass. An unbounded `DELETE` on a table
 * this size takes row locks for its whole duration and writes one WAL
 * record per row in a single transaction; the ceiling keeps each pass
 * short and lets the next tick finish the job. `moreRemaining` says when
 * that is happening, so a backlog that never drains is visible rather
 * than inferred from a row count nobody is watching.
 */
export const CRON_RUNS_RETENTION_DAYS = 30;
export const DEAD_LETTER_RETENTION_DAYS = 90;
/** Max rows removed from ONE table in ONE pass. */
export const RETENTION_BATCH_LIMIT = 5_000;

export interface OpsRetentionDeps {
  db: WorkerDb;
}

export class OpsRetentionWorker extends BaseDeclutrWorker<OpsRetentionJobData, OpsRetentionResult> {
  override readonly workerName = 'OpsRetentionWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: OpsRetentionDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: OpsRetentionJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: OpsRetentionJobData,
    _ctx: WorkerContext,
  ): Promise<OpsRetentionResult> {
    const startedAt = Date.now();

    // `ctid` rather than `id`: the subselect picks a bounded batch and
    // the outer delete removes exactly those physical rows, so the plan
    // never has to re-scan the whole table to match a UUID set.
    //
    // The NOT IN clause is the watchdog guarantee. `DISTINCT ON` with
    // `ORDER BY worker_name, started_at DESC` is Postgres's cheapest
    // "latest row per group" and rides the existing
    // `cron_runs_worker_started_idx` — the same index the watchdog reads.
    const cronRows = await this.deps.db.execute(sql`
      WITH doomed AS (
        SELECT c.ctid
        FROM cron_runs c
        WHERE c.started_at < now() - ${sql.raw(`interval '${CRON_RUNS_RETENTION_DAYS} days'`)}
          AND c.id NOT IN (
            SELECT DISTINCT ON (worker_name) id
            FROM cron_runs
            ORDER BY worker_name, started_at DESC
          )
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM cron_runs WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);

    const deadRows = await this.deps.db.execute(sql`
      WITH doomed AS (
        SELECT d.ctid
        FROM dead_letter_jobs d
        WHERE d.failed_at < now() - ${sql.raw(`interval '${DEAD_LETTER_RETENTION_DAYS} days'`)}
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM dead_letter_jobs WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);

    const cronRunsDeleted = rowCount(cronRows);
    const deadLetterDeleted = rowCount(deadRows);

    return {
      cronRunsDeleted,
      deadLetterDeleted,
      moreRemaining:
        cronRunsDeleted >= RETENTION_BATCH_LIMIT || deadLetterDeleted >= RETENTION_BATCH_LIMIT,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Row count from a Drizzle `execute`.
 *
 * postgres.js returns an array-like of the RETURNING rows; PGlite (the
 * test driver) returns `{ rows }`. Both shapes appear in this package,
 * and reading only one of them would make the counts silently 0 under
 * the other — a retention sweep reporting `deleted: 0` forever while
 * quietly working is worse than one that fails.
 */
function rowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}
