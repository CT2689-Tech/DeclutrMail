import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Dead letter jobs — D225 `adminPolicy` surface.
 *
 * When a BullMQ job exhausts its retries, the worker's failure handler
 * writes the job here so the failure is durable beyond Redis (BullMQ's
 * failed set is capped and Redis is not the system of record).
 * `DeadLetterWorker` (adminPolicy per D225) polls this table every 60s
 * and alerts Sentry on any new row — the failure IS the alert.
 *
 * `queue` + `job_id` identify the BullMQ job; NOT unique — a job that
 * was replayed and dead-lettered again gets a fresh row, preserving
 * the full failure history.
 *
 * `payload` is the job's data as enqueued (mailbox ids, message id
 * lists, action intents — the same metadata the queues already carry).
 * Privacy (D7, D228): ENFORCED at the write boundary, not assumed —
 * `DrizzleDeadLetterRecorder` (packages/workers) allowlists payload
 * keys before persist, so a non-allowlisted field (e.g. a future
 * worker's `snippet`) is dropped and recorded under `__redacted_keys`
 * rather than stored.
 *
 * `replayed_at` — null until an operator replays the job (re-enqueue
 * via admin tooling). The partial index on unreplayed rows serves both
 * the DeadLetterWorker poll and the admin "needs attention" list
 * without scanning replayed history.
 *
 * No FK columns — the payload references queue-domain entities, and a
 * dead letter must survive even if its mailbox row was since deleted
 * (the row documents the failure, not the entity).
 */

export const deadLetterJobs = pgTable(
  'dead_letter_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** BullMQ queue name, e.g. `initial-sync`. */
    queue: text('queue').notNull(),
    /** BullMQ job id within the queue. */
    jobId: text('job_id').notNull(),
    /** Job data as enqueued — recorder allowlists keys before persist (D7). */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Final error message/stack from the exhausting attempt. */
    error: text('error').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Set when an operator re-enqueues the job; null while parked. */
    replayedAt: timestamp('replayed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    /** DeadLetterWorker poll + admin "needs attention" list. */
    unreplayedIdx: index('dead_letter_jobs_unreplayed_idx')
      .on(table.failedAt)
      .where(sql`${table.replayedAt} IS NULL`),
  }),
);

export type DeadLetterJob = typeof deadLetterJobs.$inferSelect;
export type NewDeadLetterJob = typeof deadLetterJobs.$inferInsert;
