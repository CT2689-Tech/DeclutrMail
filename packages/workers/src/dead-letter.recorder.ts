import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deadLetterJobs } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/**
 * Dead-letter recorder seam (D225).
 *
 * `BaseDeclutrWorker` persists every TERMINAL failure to the
 * `dead_letter_jobs` table so the failure is durable beyond Redis
 * (BullMQ's failed set is capped and Redis is not the system of
 * record). The base class only knows this interface — the Drizzle
 * implementation below is constructed by the composition root
 * (`apps/api/src/worker.ts`) and installed on every worker via
 * `setDeadLetterRecorder()`, mirroring the `WorkerObserver` seam.
 *
 * Privacy (D7, D228): `payload` is the job's data exactly as enqueued —
 * queue metadata only (mailbox ids, message id lists, action intents).
 * Job payloads never contain message bodies, so neither does this table.
 */

/** One terminal failure, ready to park in `dead_letter_jobs`. */
export interface DeadLetterEntry {
  /** BullMQ queue name, e.g. `initial-sync`. */
  queue: string;
  /** BullMQ job id within the queue. */
  jobId: string;
  /** Job data as enqueued — queue metadata only, never body content (D7). */
  payload: unknown;
  /** Final error message/stack from the exhausting attempt. */
  error: string;
}

/**
 * The seam the base class records through. Implementations may throw —
 * the base class wraps every call and never lets a recorder failure
 * mask the original job failure.
 */
export interface DeadLetterRecorder {
  record(entry: DeadLetterEntry): Promise<void>;
}

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Production recorder — one INSERT per terminal failure. `failed_at`
 * defaults to `now()` in the schema; `(queue, job_id)` is deliberately
 * NOT unique so a replayed-then-dead-lettered-again job gets a fresh
 * row, preserving the full failure history.
 */
export class DrizzleDeadLetterRecorder implements DeadLetterRecorder {
  constructor(private readonly deps: { db: WorkerDb }) {}

  async record(entry: DeadLetterEntry): Promise<void> {
    await this.deps.db.insert(deadLetterJobs).values({
      queue: entry.queue,
      jobId: entry.jobId,
      payload: entry.payload,
      error: entry.error,
    });
  }
}
