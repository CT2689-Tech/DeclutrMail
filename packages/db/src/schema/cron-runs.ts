import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Cron runs — D225 `cronPolicy` idempotency ledger.
 *
 * D225 keys cron-policy jobs on `(worker_name, scheduled_at_minute)`
 * instead of mailbox+messageId. `run_key` is that composite key
 * composed app-side — `<worker_name>:<scheduled_at_minute ISO>` — and
 * its unique index is the dedup gate: the scheduler's
 * `INSERT … ON CONFLICT DO NOTHING` claims the slot atomically, so a
 * double-fired cron tick (or two worker replicas) runs the job exactly
 * once.
 *
 * Lifecycle: insert with `status='running'` at claim time →
 * `BaseDeclutrWorker` runs `processJob()` → on success flip to
 * 'succeeded' + set `finished_at`; on terminal failure flip to
 * 'failed' (the failure itself is also Sentry'd per D203).
 *
 * `(worker_name, started_at DESC)` serves the "last run per worker"
 * reads — the ops watchdog's staleness check ("has WatchRenewalWorker
 * run in the last 6h?") and the admin surface.
 *
 * No FK to mailbox/workspace — cron jobs are global by definition
 * (D225: concurrency 1 globally, no mailbox keying).
 *
 * No body data; no privacy concerns — worker names and timestamps only.
 */

export const cronRunStatus = pgEnum('cron_run_status', ['running', 'succeeded', 'failed']);

export const cronRuns = pgTable(
  'cron_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** D157/D225 worker name, e.g. `WatchRenewalWorker`. */
    workerName: text('worker_name').notNull(),
    /** `<worker_name>:<scheduled_at_minute ISO>` — the D225 idempotency key. */
    runKey: text('run_key').notNull(),
    status: cronRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    /** The dedup gate — one run per (worker, scheduled minute). */
    runKeyUniq: uniqueIndex('cron_runs_run_key_uniq').on(table.runKey),
    /** "Last run per worker" — watchdog staleness check + admin surface. */
    workerStartedIdx: index('cron_runs_worker_started_idx').on(
      table.workerName,
      table.startedAt.desc(),
    ),
  }),
);

export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
