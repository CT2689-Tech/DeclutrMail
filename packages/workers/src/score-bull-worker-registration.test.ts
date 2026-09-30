import { randomUUID } from 'node:crypto';

import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { DeadLetterEntry, DeadLetterRecorder } from './dead-letter.recorder.js';
import { createRedisConnection, workerTuningOptions } from './queue.js';
import {
  scoreBullWorkerOptions,
  scoreJobId,
  scoreJobOptions,
  type ScoreJobData,
} from './score.worker.js';
import type { WorkerContext } from './worker-context.js';
import { TransientError } from './worker-errors.js';
import type { WorkerFailureContext, WorkerObserver } from './worker-observer.js';

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/**
 * PR #827 BLOCKING-1 (architecture-guardian). `scoreJobOptions()` sets
 * `backoff: { type: 'custom' }` on every score job, but `scoreBullWorker`'s
 * registration (`apps/api/src/worker.ts`) never spread in
 * `perMailboxWorkerSettings()` — the thing that registers a `custom`
 * backoff STRATEGY implementation with BullMQ. Every other test for this
 * fix (`score-job-options.test.ts`, `rescore-senders.test.ts`) checks the
 * PRODUCER's options against a mock or a plain object — never a real
 * BullMQ `Worker` that could actually hit the missing-registration crash.
 * This file drives the real seam instead: a `Worker` built with
 * `scoreBullWorkerOptions()` (`score.worker.ts`) — the SAME exported
 * function `apps/api/src/worker.ts` calls for its real registration, not a
 * hand-copied duplicate of its shape — consuming a job built with the real
 * `scoreJobOptions(scoreJobId(data))`.
 *
 * Round 1 of this file built its own `realScoreWorkerOptions()` literal
 * (`{ concurrency, ...workerTuningOptions('user-facing'),
 * ...perMailboxWorkerSettings() }`) instead of importing the real
 * registration's options. architecture-guardian's round-2 review proved
 * that duplicate couldn't catch a regression: deleting
 * `...perMailboxWorkerSettings()` from the real `worker.ts:1188` call site
 * left every test in this file still green, because the test never read
 * anything `worker.ts` actually built. `realScoreWorkerOptions()` below now
 * just calls `scoreBullWorkerOptions(connection!)` — the same function
 * `worker.ts` calls — so removing that spread from the shared function's
 * one real call site fails this file's tests for real (verified with the
 * same negative control: reverted, red; restored, green).
 *
 * Without the registration, BullMQ throws `Unknown backoff strategy
 * custom.` when it tries to schedule the SECOND attempt — after the
 * first attempt's own `BaseDeclutrWorker.run()` bookkeeping has already
 * decided (correctly, reading the job's real `opts.attempts = 5`) that
 * attempt 1 of 5 is NOT terminal, so it does not capture or dead-letter
 * it either. The job is then stuck: worse than the pre-#827 bug (a
 * clean single-attempt dead-letter), because now nothing observes the
 * failure at all until the stalled-job reclaim (5-10 min in production).
 *
 * Real BullMQ backoff delays (2s/4s/8s/16s for `perMailboxPolicy`'s
 * non-rate-limit path) are scheduled server-side against real Redis
 * timestamps, not JS timers, so `vi.useFakeTimers()` cannot accelerate
 * them — the exhaustion test below genuinely waits out the real
 * schedule. That is why it carries a 60s timeout.
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
    console.warn(`score-bull-worker-registration.test: Redis at ${REDIS_URL} unreachable (${why})`);
    return { connection: null, live: false, reason: why };
  }
}

afterAll(async () => {
  await connection?.quit().catch(() => undefined);
});

/**
 * A minimal, real `BaseDeclutrWorker` under `perMailboxPolicy` — the
 * same policy `scoreJobOptions` grants. Fails on every attempt up to
 * and including `failThroughAttempt`, then succeeds.
 */
class ProbeWorker extends BaseDeclutrWorker<ScoreJobData, { ok: true }> {
  readonly workerName = 'probe-score-worker';
  readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly failThroughAttempt: number) {
    super();
  }

  async processJob(_payload: ScoreJobData, ctx: WorkerContext): Promise<{ ok: true }> {
    if (ctx.attempt <= this.failThroughAttempt) {
      throw new TransientError(`probe: simulated failure on attempt ${ctx.attempt}`);
    }
    return { ok: true };
  }
}

function makeObserver(): { observer: WorkerObserver; failures: WorkerFailureContext[] } {
  const failures: WorkerFailureContext[] = [];
  return {
    observer: {
      captureFailure: (_error, ctx) => {
        failures.push(ctx);
      },
      captureBackgroundFailure: () => {},
      recordBackgroundNotice: () => {},
    },
    failures,
  };
}

function makeRecorder(): { recorder: DeadLetterRecorder; entries: DeadLetterEntry[] } {
  const entries: DeadLetterEntry[] = [];
  return {
    recorder: {
      record: async (entry) => {
        entries.push(entry);
      },
    },
    entries,
  };
}

function scoreJobData(): ScoreJobData {
  return {
    mailboxAccountId: randomUUID(),
    senderKey: 'a'.repeat(64),
    trigger: 'signal_change',
    producedAtMs: Date.now(),
  };
}

/**
 * Calls the SAME `scoreBullWorkerOptions()` `apps/api/src/worker.ts`
 * imports for `scoreBullWorker`'s actual registration — not a duplicate
 * of its shape. See the file-header comment for why that distinction is
 * the whole point of this file.
 */
function realScoreWorkerOptions() {
  return scoreBullWorkerOptions(connection!);
}

describe('scoreBullWorker registration (real Redis + real BullMQ, PR #827 BLOCKING-1)', () => {
  // ALWAYS runs, per the `incremental-sync.queue.test.ts` convention: every
  // other test here is `runIf(live)`, so an unreachable Redis must fail,
  // by name, rather than read as a green skip.
  it('reaches Redis whenever TEST_REDIS_URL is set', () => {
    if (process.env['TEST_REDIS_URL']) expect(reason).toBe('reachable');
  });

  it.runIf(live)(
    'a job that fails once retries with perMailboxPolicy backoff and completes',
    async () => {
      const queueName = `score-registration-test-${randomUUID()}`;
      const queue = new Queue<ScoreJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(1); // fails attempt 1, succeeds attempt 2
      const worker = new Worker<ScoreJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        realScoreWorkerOptions(),
      );
      try {
        const completed = new Promise<number>((resolve, reject) => {
          worker.on('completed', (job) => resolve(job.attemptsMade));
          // BullMQ emits 'failed' after attempt 1 too (retryable, not
          // terminal) — only reject once attempts are exhausted without
          // ever completing, which would mean the retry never happened.
          worker.on('failed', (job, err) => {
            if (job && job.attemptsMade >= 5) reject(err);
          });
        });
        const data = scoreJobData();
        await queue.add('score', data, scoreJobOptions(scoreJobId(data)));
        await expect(completed).resolves.toBe(2); // retried exactly once, then completed
      } finally {
        await worker.close();
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
      }
    },
    15_000,
  );

  it.runIf(live)(
    "a job that always fails exhausts perMailboxPolicy's 5 attempts, reaches BullMQ `failed`, and captures/dead-letters EXACTLY once — not stuck active",
    async () => {
      const queueName = `score-registration-test-${randomUUID()}`;
      const queue = new Queue<ScoreJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(Number.POSITIVE_INFINITY); // never succeeds
      const { observer, failures } = makeObserver();
      const { recorder, entries } = makeRecorder();
      probe.setObserver(observer);
      probe.setDeadLetterRecorder(recorder);
      const worker = new Worker<ScoreJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        realScoreWorkerOptions(),
      );
      try {
        const exhausted = new Promise<number>((resolve) => {
          // BullMQ emits 'failed' after EVERY attempt, retryable or not —
          // only the attempt where attemptsMade reaches the policy's
          // maxAttempts (5) is the terminal one.
          worker.on('failed', (job) => {
            if (job && job.attemptsMade >= 5) resolve(job.attemptsMade);
          });
        });
        const data = scoreJobData();
        await queue.add('score', data, scoreJobOptions(scoreJobId(data)));
        await expect(exhausted).resolves.toBe(5);
        expect(failures).toHaveLength(1); // Sentry captured exactly once
        expect(entries).toHaveLength(1); // dead-lettered exactly once
      } finally {
        await worker.close();
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
      }
    },
    60_000,
  );

  it.runIf(live)(
    'negative control: without perMailboxWorkerSettings(), the custom backoff strategy is never registered',
    async () => {
      const queueName = `score-registration-test-${randomUUID()}`;
      const queue = new Queue<ScoreJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(1); // would succeed on attempt 2 — if it ever got there
      const worker = new Worker<ScoreJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        // Deliberately OMITS `...perMailboxWorkerSettings()` — this IS
        // the BLOCKING-1 bug, reproduced on purpose. `realScoreWorkerOptions()`
        // is NOT reused here for exactly that reason.
        { connection: connection!, concurrency: 20, ...workerTuningOptions('user-facing') },
      );
      try {
        type Outcome = { kind: 'completed' | 'failed' | 'error' | 'timeout'; message?: string };
        const settled = new Promise<Outcome>((resolve) => {
          worker.on('completed', () => resolve({ kind: 'completed' }));
          worker.on('failed', (_job, err) => resolve({ kind: 'failed', message: err.message }));
          worker.on('error', (err) => resolve({ kind: 'error', message: err.message }));
        });
        const data = scoreJobData();
        await queue.add('score', data, scoreJobOptions(scoreJobId(data)));
        const outcome = await Promise.race([
          settled,
          new Promise<Outcome>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 8_000)),
        ]);
        // Whichever shape BullMQ surfaces it as (a worker-level 'error',
        // or the job's own 'failed' event carrying that message), the
        // unregistered strategy must be named — never a silent hang and
        // never the job just completing/retrying as if nothing were wrong.
        expect(outcome.kind).not.toBe('completed');
        expect(outcome.kind).not.toBe('timeout');
        expect(outcome.message).toMatch(/Unknown backoff strategy custom\./);
      } finally {
        await worker.close();
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
      }
    },
    15_000,
  );
});
