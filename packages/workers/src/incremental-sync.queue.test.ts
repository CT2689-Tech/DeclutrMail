import { randomUUID } from 'node:crypto';

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import {
  COALESCED_STUCK_ACTIVE_MS,
  createRedisConnection,
  ensureIncrementalSyncJob,
  type IncrementalSyncJobData,
} from './queue.js';

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/**
 * Incremental-sync coalescing against REAL BullMQ + REAL Redis
 * (2026-09-25 incident).
 *
 * The coalescing is BullMQ's `deduplication.keepLastIfActive`, which lives
 * in Lua. A fake queue can only replay what this file already believes
 * about that Lua, so these run the real scripts and are skipped, loudly,
 * when no Redis is reachable (same contract as `gmail-quota-limiter.test.ts`,
 * including why the connection is made at MODULE scope: `it.runIf` is
 * evaluated at collection, before any hook runs).
 *
 * The incident these pin: one bulk Delete produced a Pub/Sub push per
 * Gmail label change, each push enqueued its own job for the SAME mailbox,
 * and eight of them spent five attempts each waiting 45s on the mailbox
 * lock before dead-lettering.
 */
const { connection, live, reason } = await connect();

async function connect(): Promise<{ connection: Redis | null; live: boolean; reason: string }> {
  const client = createRedisConnection(REDIS_URL);
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    return { connection: client, live: true, reason: 'reachable' };
  } catch (err) {
    client.disconnect();
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`incremental-sync.queue.test: Redis at ${REDIS_URL} unreachable (${why})`);
    return { connection: null, live: false, reason: why };
  }
}

afterAll(async () => {
  await connection?.quit().catch(() => undefined);
});

const MAILBOX = 'mailbox-a';
const OTHER_MAILBOX = 'mailbox-b';

function push(mailboxAccountId: string, endHistoryId: number): IncrementalSyncJobData {
  // A webhook plans `start` from the APPLIED cursor, which does not move
  // until a job finishes — so every push in a burst carries the same start.
  return { mailboxAccountId, startHistoryId: '100', endHistoryId: String(endHistoryId) };
}

async function withQueue(
  fn: (queue: Queue<IncrementalSyncJobData>, name: string) => Promise<void>,
): Promise<void> {
  const name = `incremental-sync-test-${randomUUID()}`;
  const queue = new Queue<IncrementalSyncJobData>(name, { connection: connection! });
  try {
    await fn(queue, name);
  } finally {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition not reached before the deadline');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('incremental-sync coalescing: one queued + one running per mailbox (real Redis)', () => {
  // ALWAYS runs. Every other test here is `runIf(live)`, so without this
  // an unreachable Redis is a green skip. CI sets TEST_REDIS_URL (the
  // Workers job has a Redis service), which is the promise that these
  // tests execute there — so a missing Redis must fail, by name.
  it('reaches Redis whenever TEST_REDIS_URL is set', () => {
    if (process.env['TEST_REDIS_URL']) expect(reason).toBe('reachable');
  });

  it.runIf(live)('collapses a burst of pushes into ONE queued job per mailbox', async () => {
    await withQueue(async (queue) => {
      const outcomes: string[] = [];
      for (let end = 101; end <= 109; end += 1) {
        outcomes.push(await ensureIncrementalSyncJob(queue, push(MAILBOX, end)));
      }

      expect(outcomes).toEqual(['added', ...Array<string>(8).fill('noop')]);
      expect(await queue.getJobCounts('waiting', 'delayed', 'active')).toEqual({
        waiting: 1,
        delayed: 0,
        active: 0,
      });

      // Coalescing is per MAILBOX, never across mailboxes.
      expect(await ensureIncrementalSyncJob(queue, push(OTHER_MAILBOX, 101))).toBe('added');
      expect((await queue.getJobCounts('waiting')).waiting).toBe(2);
    });
  });

  it.runIf(live)(
    'queues exactly one follow-up behind a RUNNING job, and it carries the latest push',
    async () => {
      await withQueue(async (queue, name) => {
        const seen: string[] = [];
        let firstStarted!: () => void;
        const started = new Promise<void>((resolve) => (firstStarted = resolve));
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const workerConnection = createRedisConnection(REDIS_URL);
        // Production concurrency. Nothing but the dedup key stops the
        // follow-up from running beside the first job.
        const worker = new Worker<IncrementalSyncJobData>(
          name,
          async (job) => {
            seen.push(job.data.endHistoryId);
            if (seen.length === 1) {
              firstStarted();
              await gate;
            }
          },
          { connection: workerConnection, concurrency: 20 },
        );
        try {
          expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 100))).toBe('added');
          await started;

          for (let end = 101; end <= 109; end += 1) {
            // `noop` to the caller, but NOT a drop: BullMQ stores the
            // request and enqueues it when the running job finishes.
            expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, end))).toBe('noop');
          }
          expect(await queue.getJobCounts('waiting', 'active')).toEqual({ waiting: 0, active: 1 });

          release();
          await waitUntil(async () => (await queue.getJobCounts('completed')).completed === 2);
          // Give a stray third job the chance to appear before asserting it did not.
          await new Promise((resolve) => setTimeout(resolve, 200));

          expect(seen).toEqual(['100', '109']);
          expect(await queue.getJobCounts('waiting', 'active', 'delayed')).toEqual({
            waiting: 0,
            active: 0,
            delayed: 0,
          });
        } finally {
          release();
          await worker.close();
          await workerConnection.quit().catch(() => undefined);
        }
      });
    },
  );

  it.runIf(live)(
    'a finished job does not swallow the next push (no terminal residue)',
    async () => {
      await withQueue(async (queue, name) => {
        let runs = 0;
        const workerConnection = createRedisConnection(REDIS_URL);
        const worker = new Worker<IncrementalSyncJobData>(
          name,
          async () => {
            runs += 1;
          },
          { connection: workerConnection },
        );
        try {
          expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 100))).toBe('added');
          await waitUntil(async () => runs === 1);

          // The completed job is retained for 24h. The drift sweep and
          // "Sync now" re-enqueue at an UNCHANGED cursor on a quiet mailbox,
          // so the same payload must still produce a fresh run.
          expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 100))).toBe('added');
          await waitUntil(async () => runs === 2);
        } finally {
          await worker.close();
          await workerConnection.quit().catch(() => undefined);
        }
      });
    },
  );

  it.runIf(live)('a dead-lettered job releases the mailbox for the next push', async () => {
    await withQueue(async (queue, name) => {
      let runs = 0;
      const workerConnection = createRedisConnection(REDIS_URL);
      // Fails for good on the first run — the terminal state the eight
      // incident jobs reached. 2026-07-07 is why this matters: a dead-
      // lettered sync used to block every later enqueue for its cursor.
      const worker = new Worker<IncrementalSyncJobData>(
        name,
        async () => {
          runs += 1;
          if (runs === 1) throw new UnrecoverableError('simulated terminal failure');
        },
        { connection: workerConnection },
      );
      try {
        expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 100))).toBe('added');
        await waitUntil(async () => (await queue.getJobCounts('failed')).failed === 1);

        expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 101))).toBe('added');
        await waitUntil(async () => runs === 2);
      } finally {
        await worker.close();
        await workerConnection.quit().catch(() => undefined);
      }
    });
  });

  it.runIf(live)('stops absorbing into a job that has run past the stuck bound', async () => {
    await withQueue(async (queue, name) => {
      const seen: string[] = [];
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => (firstStarted = resolve));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const workerConnection = createRedisConnection(REDIS_URL);
      const worker = new Worker<IncrementalSyncJobData>(
        name,
        async (job) => {
          seen.push(job.data.endHistoryId);
          if (seen.length === 1) {
            firstStarted();
            await gate;
          }
        },
        { connection: workerConnection, concurrency: 20 },
      );
      try {
        expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 100))).toBe('added');
        await started;
        // The data shape of a processor that never settled: still active,
        // started longer ago than any healthy run takes.
        const [running] = await queue.getJobs(['active']);
        await connection!.hset(
          `bull:${name}:${running!.id}`,
          'processedOn',
          String(Date.now() - COALESCED_STUCK_ACTIVE_MS - 60_000),
        );

        // Absorbed, this push would wait on a job that may never finish.
        expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 101))).toBe('added');
        // It ran BESIDE the stuck job, which is still active behind the gate.
        await waitUntil(async () => seen.includes('101'));
        expect(seen[0]).toBe('100');
        expect((await queue.getJobCounts('active')).active).toBeGreaterThanOrEqual(1);
        // The first, absorbed attempt left a follow-up that runs once more
        // after the fresh job — a second harmless run, never a job-id
        // collision (every run has its own id).
        await waitUntil(async () => ((await queue.getJobCounts('completed')).completed ?? 0) >= 1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const finished = await queue.getJobs(['completed']);
        expect(new Set(finished.map((job) => job.id)).size).toBe(finished.length);
        expect(seen.filter((end) => end === '101').length).toBe(finished.length);
      } finally {
        release();
        await worker.close();
        await workerConnection.quit().catch(() => undefined);
      }
    });
  });

  it.runIf(live)('recovers when the dedup key outlived its job', async () => {
    await withQueue(async (queue) => {
      // The shape of an evicted job hash: the mailbox's dedup key still
      // names a job that no longer exists. Without recovery every later
      // enqueue for this mailbox would be deduplicated into a ghost, and
      // the mailbox would stop syncing with nothing failing loudly.
      await connection!.set(`bull:${queue.name}:de:${MAILBOX}`, 'ghost-job');

      expect(await ensureIncrementalSyncJob(queue, push(MAILBOX, 101))).toBe('added');
      const waiting = await queue.getJobs(['waiting']);
      expect(waiting.map((job) => job.data.mailboxAccountId)).toEqual([MAILBOX]);
    });
  });
});
