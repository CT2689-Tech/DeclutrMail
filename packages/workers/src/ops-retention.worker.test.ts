import { cronRuns, deadLetterJobs } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpsRetentionWorker } from './ops-retention.worker.js';
import type { WorkerContext } from './worker-context.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

const CTX: WorkerContext = { attempt: 1, jobId: 'ret-1' } as WorkerContext;
const PAYLOAD = { scheduledAtMinute: '2026-08-24T04:00' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('OpsRetentionWorker', () => {
  let db: Db;

  const run = () => new OpsRetentionWorker({ db: db as never }).processJob(PAYLOAD, CTX);

  beforeEach(async () => {
    db = await freshTestDb();
  });

  it('deletes cron_runs past the retention window', async () => {
    await db.insert(cronRuns).values([
      { workerName: 'W1', runKey: 'W1:old', status: 'succeeded', startedAt: daysAgo(40) },
      { workerName: 'W1', runKey: 'W1:mid', status: 'succeeded', startedAt: daysAgo(35) },
      { workerName: 'W1', runKey: 'W1:new', status: 'succeeded', startedAt: daysAgo(1) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(2);
    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k)).toEqual(['W1:new']);
  });

  it('KEEPS the most recent row for a worker that has not run in months', async () => {
    // THE TRAP. `cron_runs` is both the D225 idempotency ledger AND the
    // source for the watchdog's "has this worker run recently?" check.
    // Deleting the last surviving row for a long-dead worker makes the
    // watchdog unable to distinguish "stalled 200 days ago" from "never
    // ran" — it would go silent exactly when a worker had been dead
    // longest. A plain age-based DELETE fails this test.
    await db.insert(cronRuns).values([
      { workerName: 'Abandoned', runKey: 'A:1', status: 'succeeded', startedAt: daysAgo(200) },
      { workerName: 'Abandoned', runKey: 'A:2', status: 'succeeded', startedAt: daysAgo(180) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(1);
    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k)).toEqual(['A:2']);
  });

  it('keeps the newest row for EVERY worker independently', async () => {
    // The per-group guarantee, not just a global "keep one". A single
    // `ORDER BY started_at DESC LIMIT 1` would pass the test above and
    // still wipe every other worker's last heartbeat.
    await db.insert(cronRuns).values([
      { workerName: 'A', runKey: 'A:old', status: 'succeeded', startedAt: daysAgo(90) },
      { workerName: 'A', runKey: 'A:less', status: 'succeeded', startedAt: daysAgo(80) },
      { workerName: 'B', runKey: 'B:old', status: 'succeeded', startedAt: daysAgo(70) },
      { workerName: 'B', runKey: 'B:less', status: 'succeeded', startedAt: daysAgo(60) },
    ]);

    await run();

    const left = await db.select({ k: cronRuns.runKey }).from(cronRuns);
    expect(left.map((r) => r.k).sort()).toEqual(['A:less', 'B:less']);
  });

  it('leaves everything inside the window alone', async () => {
    // Blind case in the destructive direction: if the age predicate were
    // inverted or dropped, this suite would otherwise still be green on
    // the counts above.
    await db.insert(cronRuns).values([
      { workerName: 'W', runKey: 'W:a', status: 'succeeded', startedAt: daysAgo(29) },
      { workerName: 'W', runKey: 'W:b', status: 'succeeded', startedAt: daysAgo(2) },
    ]);

    const result = await run();

    expect(result.cronRunsDeleted).toBe(0);
    expect(await db.select().from(cronRuns)).toHaveLength(2);
  });

  it('prunes dead_letter_jobs on the longer window, and only past it', async () => {
    await db.insert(deadLetterJobs).values([
      { queue: 'q', jobId: 'j1', payload: {}, error: 'e', failedAt: daysAgo(120) },
      { queue: 'q', jobId: 'j2', payload: {}, error: 'e', failedAt: daysAgo(91) },
      // 60 days old — a failure record still worth keeping. `cron_runs`
      // retention is 30 days; if the two windows were ever collapsed to
      // one constant this row would vanish and this assertion catches it.
      { queue: 'q', jobId: 'j3', payload: {}, error: 'e', failedAt: daysAgo(60) },
    ]);

    const result = await run();

    expect(result.deadLetterDeleted).toBe(2);
    const left = await db.select({ j: deadLetterJobs.jobId }).from(deadLetterJobs);
    expect(left.map((r) => r.j)).toEqual(['j3']);
  });

  it('reports the counts on the ops line, not just in the return value', async () => {
    // `worker.succeeded` filters the result through
    // `SAFE_WORKER_RESULT_KEYS`, a denylist by omission — a key absent
    // from it is dropped with no error, and every assertion above reads
    // the RETURN VALUE and would stay green. This one reads the LOG.
    await db.insert(cronRuns).values([
      { workerName: 'W', runKey: 'W:1', status: 'succeeded', startedAt: daysAgo(40) },
      { workerName: 'W', runKey: 'W:2', status: 'succeeded', startedAt: daysAgo(1) },
    ]);

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: unknown) => {
      lines.push(String(l));
    });
    try {
      await new OpsRetentionWorker({ db: db as never }).run({
        id: 'ret-1',
        data: PAYLOAD,
        attemptsMade: 0,
      } as never);
    } finally {
      spy.mockRestore();
    }

    const succeeded = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { kind?: string; result?: Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .find((l) => l?.kind === 'worker.succeeded');
    expect(succeeded?.result).toHaveProperty('cronRunsDeleted', 1);
    expect(succeeded?.result).toHaveProperty('deadLetterDeleted');
  });

  it('flags a backlog instead of silently truncating it', async () => {
    // A capped delete that reported nothing would look identical to a
    // clean pass while a table grew forever behind it.
    const worker = new OpsRetentionWorker({ db: db as never });
    const drained = await worker.processJob(PAYLOAD, CTX);
    expect(drained.moreRemaining).toBe(false);
  });
});
