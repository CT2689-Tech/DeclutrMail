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
  /** `product_events` rows older than 13 months removed this pass. */
  productEventsDeleted: number;
  /** OAuth rows past retention removed this pass, all five tables together. */
  oauthRowsDeleted: number;
  /** Grants that owned no token or code any more and were marked revoked. */
  oauthGrantsRetired: number;
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
/** Product funnel rows. 13 months, no exception. */
export const PRODUCT_EVENTS_RETENTION_MONTHS = 13;
/**
 * MCP connector OAuth retention (docs/spec/mcp-connector.md §7). Every
 * row here is already useless to a client by the time it is removed —
 * an expired code or token cannot be redeemed — so the windows only
 * decide how long a dead row stays readable for debugging.
 */
export const OAUTH_AUTH_CODE_RETENTION_DAYS = 1;
export const OAUTH_TOKEN_RETENTION_DAYS = 7;
export const OAUTH_GRANT_RETENTION_DAYS = 30;
/**
 * A registered client nobody ever approved (registration is
 * unauthenticated). One that WAS approved is kept: the app may come back
 * with the client id it stored, and an unknown id cannot be recovered
 * from inside the browser flow.
 */
export const OAUTH_UNUSED_CLIENT_RETENTION_DAYS = 30;
/** Max rows removed from ONE table in ONE pass. */
export const RETENTION_BATCH_LIMIT = 5_000;
/**
 * The OAuth tables take rows from unauthenticated requests (a
 * registration, a parked authorization request), so one batch a day
 * could fall behind what a single address may write. Each OAuth
 * statement repeats until it runs dry, up to this many batches.
 */
export const OAUTH_SWEEP_MAX_PASSES = 20;

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

    const productRows = await this.deps.db.execute(sql`
      WITH doomed AS (
        SELECT p.ctid
        FROM product_events p
        WHERE p.occurred_at < now() - ${sql.raw(`interval '${PRODUCT_EVENTS_RETENTION_MONTHS} months'`)}
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM product_events WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);

    const cronRunsDeleted = rowCount(cronRows);
    const deadLetterDeleted = rowCount(deadRows);
    const productEventsDeleted = rowCount(productRows);
    const oauth = await this.sweepOAuth();

    return {
      cronRunsDeleted,
      deadLetterDeleted,
      productEventsDeleted,
      oauthRowsDeleted: oauth.deleted,
      oauthGrantsRetired: oauth.retired,
      moreRemaining:
        cronRunsDeleted >= RETENTION_BATCH_LIMIT ||
        deadLetterDeleted >= RETENTION_BATCH_LIMIT ||
        productEventsDeleted >= RETENTION_BATCH_LIMIT ||
        oauth.moreRemaining,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * OAuth retention, in dependency order.
   *
   * A grant has no expiry of its own, so one whose every code and token
   * has expired and been removed would otherwise sit unrevoked forever.
   * It is marked revoked here; the 30-day rule then removes it like any
   * other. Deleting a grant cascades to whatever it still owns.
   *
   * Unlike the ledgers above, each statement here repeats until it runs
   * dry (`OAUTH_SWEEP_MAX_PASSES`): these tables grow with requests
   * nobody had to sign in to make.
   */
  private async sweepOAuth(): Promise<{
    deleted: number;
    retired: number;
    moreRemaining: boolean;
  }> {
    const { db } = this.deps;
    const days = (n: number) => sql.raw(`interval '${n} days'`);
    let deleted = 0;
    let moreRemaining = false;
    /** Run one bounded statement until it comes back short of a full batch. */
    const drain = async (statement: ReturnType<typeof sql>): Promise<number> => {
      let total = 0;
      for (let pass = 0; pass < OAUTH_SWEEP_MAX_PASSES; pass += 1) {
        const count = rowCount(await db.execute(statement));
        total += count;
        if (count < RETENTION_BATCH_LIMIT) return total;
      }
      moreRemaining = true;
      return total;
    };

    deleted += await drain(sql`
      WITH doomed AS (
        SELECT i.ctid FROM oauth_interactions i
        WHERE i.expires_at < now()
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM oauth_interactions WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);
    deleted += await drain(sql`
      WITH doomed AS (
        SELECT c.ctid FROM oauth_auth_codes c
        WHERE c.expires_at < now() - ${days(OAUTH_AUTH_CODE_RETENTION_DAYS)}
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM oauth_auth_codes WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);
    deleted += await drain(sql`
      WITH doomed AS (
        SELECT t.ctid FROM oauth_tokens t
        WHERE t.expires_at < now() - ${days(OAUTH_TOKEN_RETENTION_DAYS)}
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM oauth_tokens WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);
    // Not a delete: retire grants that own nothing. Bounded and counted
    // like the deletes — it writes the field that decides whether a
    // connection is live.
    const retired = await drain(sql`
      WITH doomed AS (
        SELECT g.ctid FROM oauth_grants g
        WHERE g.revoked_at IS NULL
          AND g.created_at < now() - ${days(1)}
          AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = g.id)
          AND NOT EXISTS (SELECT 1 FROM oauth_auth_codes c WHERE c.grant_id = g.id)
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      UPDATE oauth_grants SET revoked_at = now() WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);
    deleted += await drain(sql`
      WITH doomed AS (
        SELECT g.ctid FROM oauth_grants g
        WHERE g.revoked_at < now() - ${days(OAUTH_GRANT_RETENTION_DAYS)}
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM oauth_grants WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);
    // `last_granted_at IS NULL` is "never approved". "Has no grant now"
    // would also match an app whose grant the statement above just
    // removed, and delete a registration that app still holds.
    deleted += await drain(sql`
      WITH doomed AS (
        SELECT c.ctid FROM oauth_clients c
        WHERE c.last_granted_at IS NULL
          AND c.created_at < now() - ${days(OAUTH_UNUSED_CLIENT_RETENTION_DAYS)}
          AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.client_id)
        LIMIT ${RETENTION_BATCH_LIMIT}
      )
      DELETE FROM oauth_clients WHERE ctid IN (SELECT ctid FROM doomed)
      RETURNING 1
    `);

    return { deleted, retired, moreRemaining };
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
