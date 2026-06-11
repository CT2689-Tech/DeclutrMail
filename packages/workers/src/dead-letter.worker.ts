import { asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deadLetterJobs } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Sweep payload. The scheduler enqueues one job per minute keyed on
 * `(worker_name, scheduled_at_minute)` per D225; the payload carries no
 * other state because the worker scans the full table.
 */
export interface DeadLetterSweepJobData {
  /** ISO-8601 minute (`2026-06-11T14:35`) — the D225 idempotency key. */
  scheduledAtMinute: string;
}

/**
 * Counts returned by one sweep — logged on `worker.succeeded`.
 * Metric-only per the `BaseDeclutrWorker.processJob` contract.
 */
export interface DeadLetterSweepResult {
  /** Unreplayed rows visible this sweep. */
  scanned: number;
  /** Rows alerted for the first time this sweep. */
  alerted: number;
  /** Total wall-clock ms. */
  durationMs: number;
}

/**
 * DeadLetterWorker (D225, named exception) — polls `dead_letter_jobs`
 * every 60s and alerts on every newly parked row. The failure IS the
 * alert.
 *
 * Policy: `adminPolicy` (D225) — its purpose is to surface failures,
 * so it is exempt from the "Sentry once per failure" invariant and may
 * capture multiple times per run (one per parked row).
 *
 * Alert routing: each new row produces (a) one structured
 * `dead_letter.parked` error log line — the greppable observability
 * event in Cloud Logging — and (b) one
 * `observer.captureBackgroundFailure()` (Sentry in prod), the same
 * seam the reconciler uses. The observer is injected via constructor
 * deps because the base class's observer is reserved for THIS worker's
 * own lifecycle failures; the composition root passes the same
 * instance to both.
 *
 * Dedup ("one alert per row"): an in-memory id set, pruned every sweep
 * to the currently unreplayed rows. Within a process lifetime each row
 * alerts exactly once. After a process restart, still-parked rows
 * alert once more — deliberate: a parked dead letter is an unresolved
 * incident, and re-surfacing it on deploy beats persisting alert state
 * (the table has no `alerted_at` column and the schema is frozen;
 * Sentry's own issue grouping collapses the repeats).
 *
 * Replay is MANUAL only — see `replayDeadLetterJob` below. The worker
 * never re-enqueues anything (D233 spirit: no auto-replay of failed
 * work).
 *
 * Privacy (D7, D228): reads queue names, job ids, and worker error
 * text only — job payloads are never logged or sent to the observer.
 */
export class DeadLetterWorker extends BaseDeclutrWorker<
  DeadLetterSweepJobData,
  DeadLetterSweepResult
> {
  override readonly workerName = 'DeadLetterWorker';
  override readonly policy = 'adminPolicy' as const;

  /**
   * Upper bound per sweep. Dead letters are rare (each one is a
   * terminal worker failure); 500 bounds both the query and the
   * dedup set. Overflow rows surface on later sweeps once older rows
   * are replayed.
   */
  static readonly SCAN_LIMIT = 500;

  /** Row ids already alerted this process lifetime — pruned per sweep. */
  private alertedIds = new Set<string>();

  constructor(private readonly deps: { db: WorkerDb; observer: WorkerObserver }) {
    super();
  }

  /** D225 cron-style idempotency key — `(worker_name, scheduled_at_minute)`. */
  protected override getIdempotencyKey(payload: DeadLetterSweepJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: DeadLetterSweepJobData,
    _ctx: WorkerContext,
  ): Promise<DeadLetterSweepResult> {
    const startedAt = Date.now();
    // Unreplayed rows only — served by `dead_letter_jobs_unreplayed_idx`.
    const rows = await this.deps.db
      .select({
        id: deadLetterJobs.id,
        queue: deadLetterJobs.queue,
        jobId: deadLetterJobs.jobId,
        error: deadLetterJobs.error,
        failedAt: deadLetterJobs.failedAt,
      })
      .from(deadLetterJobs)
      .where(isNull(deadLetterJobs.replayedAt))
      .orderBy(asc(deadLetterJobs.failedAt))
      .limit(DeadLetterWorker.SCAN_LIMIT);

    // Prune ids that are no longer parked (replayed or deleted) so the
    // set stays bounded by the live row count.
    const liveIds = new Set(rows.map((r) => r.id));
    for (const id of this.alertedIds) {
      if (!liveIds.has(id)) {
        this.alertedIds.delete(id);
      }
    }

    let alerted = 0;
    for (const row of rows) {
      if (this.alertedIds.has(row.id)) {
        continue;
      }
      // The observability event — greppable in Cloud Logging even with
      // no observer configured (same posture as worker.failure_capture).
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'dead_letter.parked',
          deadLetterId: row.id,
          queue: row.queue,
          jobId: row.jobId,
          failedAt: row.failedAt.toISOString(),
        }),
      );
      try {
        this.deps.observer.captureBackgroundFailure(
          new Error(`Dead letter parked: ${row.queue}/${row.jobId} — ${errorSummary(row.error)}`),
          {
            kind: 'dead_letter.parked',
            tags: { dead_letter_id: row.id, queue: row.queue, job_id: row.jobId },
          },
        );
        this.alertedIds.add(row.id);
        alerted += 1;
      } catch (observerErr) {
        // Observer contract violation (it must never throw). Log and
        // leave the row un-marked so the next sweep retries the alert
        // — at-least-once delivery beats losing the alert.
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'worker.observer_failed',
            worker: this.workerName,
            message: observerErr instanceof Error ? observerErr.message : String(observerErr),
          }),
        );
      }
    }

    return { scanned: rows.length, alerted, durationMs: Date.now() - startedAt };
  }
}

/** First line of the parked error, capped — keeps Sentry titles scannable. */
function errorSummary(error: string): string {
  const firstLine = error.split('\n', 1)[0] ?? '';
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

/** What the operator's enqueue callback receives — the parked job verbatim. */
export interface DeadLetterReplayTarget {
  /** BullMQ queue name the job originally ran on. */
  queue: string;
  /** ORIGINAL BullMQ job id — see the fresh-jobId note on `replayDeadLetterJob`. */
  jobId: string;
  /** Job data exactly as enqueued. */
  payload: unknown;
}

export type DeadLetterReplayOutcome = 'replayed' | 'not_found' | 'already_replayed';

/**
 * Replay one parked dead letter — MANUAL trigger only (D233 spirit:
 * dead-lettered work is never auto-replayed; an operator decides).
 * Nothing in the worker process calls this; it exists for admin
 * tooling / a REPL session.
 *
 * The caller supplies the enqueue step because only the composition
 * root holds `Queue` instances. IMPORTANT for the caller: BullMQ
 * silently ignores an `add` that reuses a jobId still present in the
 * queue's failed set — derive a fresh id for the replay (e.g.
 * `${target.jobId}:replay:${deadLetterId}`); downstream idempotency
 * ledgers (action_jobs, cron_runs) keep the replay safe.
 *
 * Ordering: enqueue FIRST, then mark `replayed_at`. If the mark fails
 * after a successful enqueue the row stays parked (worst case: a
 * duplicate replay attempt, absorbed by worker idempotency). The
 * reverse order could mark a job replayed that never re-ran — losing
 * work is worse than retrying it.
 */
export async function replayDeadLetterJob(
  db: WorkerDb,
  deadLetterId: string,
  enqueue: (target: DeadLetterReplayTarget) => Promise<void>,
): Promise<DeadLetterReplayOutcome> {
  const [row] = await db
    .select({
      id: deadLetterJobs.id,
      queue: deadLetterJobs.queue,
      jobId: deadLetterJobs.jobId,
      payload: deadLetterJobs.payload,
      replayedAt: deadLetterJobs.replayedAt,
    })
    .from(deadLetterJobs)
    .where(eq(deadLetterJobs.id, deadLetterId))
    .limit(1);

  if (!row) {
    return 'not_found';
  }
  if (row.replayedAt) {
    return 'already_replayed';
  }

  await enqueue({ queue: row.queue, jobId: row.jobId, payload: row.payload });
  await db
    .update(deadLetterJobs)
    .set({ replayedAt: new Date() })
    .where(eq(deadLetterJobs.id, deadLetterId));

  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'dead_letter.replayed',
      deadLetterId: row.id,
      queue: row.queue,
      jobId: row.jobId,
    }),
  );
  return 'replayed';
}
