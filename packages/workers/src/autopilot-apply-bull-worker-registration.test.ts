import { randomUUID } from 'node:crypto';

import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import {
  autopilotApplyJobOptions,
  autopilotApplyWorkerOptions,
  type AutopilotApplyJobData,
} from './autopilot-apply.worker.js';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { DeadLetterEntry, DeadLetterRecorder } from './dead-letter.recorder.js';
import { createRedisConnection, workerTuningOptions } from './queue.js';
import type { WorkerContext } from './worker-context.js';
import { TransientError } from './worker-errors.js';
import type { WorkerFailureContext, WorkerObserver } from './worker-observer.js';

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/**
 * The `autopilot-apply` analog of `score-bull-worker-registration.test.ts`
 * (PR #827 BLOCKING-1). `autopilotApplyJobOptions()` sets
 * `backoff: { type: 'custom' }` on every apply-sweep job, but
 * `autopilotApplyBullWorker`'s registration (`apps/api/src/worker.ts`) —
 * unlike its sibling `perMailboxPolicy` consumers (initial-sync,
 * incremental-sync, label-action, autopilot-action, action-recovery,
 * score) — never spread in `perMailboxWorkerSettings()`, the thing that
 * registers a `custom` backoff STRATEGY implementation with BullMQ.
 *
 * This file drives the real seam: a `Worker` built from
 * `autopilotApplyWorkerOptions()` — the SAME exported function
 * `apps/api/src/worker.ts` calls for the production registration —
 * consuming a job built with the real `autopilotApplyJobOptions()`.
 * Importing the shared function (rather than re-listing its fields, as
 * `score-bull-worker-registration.test.ts`'s own `realScoreWorkerOptions()`
 * does) means this test cannot stay green if `...perMailboxWorkerSettings()`
 * is ever removed from `autopilotApplyWorkerOptions()` — the exact
 * removal it exists to catch.
 *
 * Without the registration, BullMQ throws `Unknown backoff strategy
 * custom.` when it tries to schedule the SECOND attempt — after the
 * first attempt's own `BaseDeclutrWorker.run()` bookkeeping has already
 * decided (correctly, reading the job's real `opts.attempts = 5`) that
 * attempt 1 of 5 is NOT terminal, so it does not capture or dead-letter
 * it either. The job is then stuck: worse than the pre-fix bug (a clean
 * single-attempt dead-letter — see the "bare options" test below),
 * because now nothing observes the failure at all until the stalled-job
 * reclaim (5-10 min in production).
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
    console.warn(
      `autopilot-apply-bull-worker-registration.test: Redis at ${REDIS_URL} unreachable (${why})`,
    );
    return { connection: null, live: false, reason: why };
  }
}

afterAll(async () => {
  await connection?.quit().catch(() => undefined);
});

/**
 * A minimal, real `BaseDeclutrWorker` under `perMailboxPolicy` — the
 * same policy `autopilotApplyJobOptions` grants. Fails on every attempt
 * up to and including `failThroughAttempt`, then succeeds.
 */
class ProbeWorker extends BaseDeclutrWorker<AutopilotApplyJobData, { ok: true }> {
  readonly workerName = 'probe-autopilot-apply-worker';
  readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly failThroughAttempt: number) {
    super();
  }

  async processJob(_payload: AutopilotApplyJobData, ctx: WorkerContext): Promise<{ ok: true }> {
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

function applyJobData(): AutopilotApplyJobData {
  return { mailboxAccountId: randomUUID(), triggeredAtMs: Date.now() };
}

describe('autopilotApplyBullWorker registration (real Redis + real BullMQ)', () => {
  // ALWAYS runs, per the `incremental-sync.queue.test.ts` convention: every
  // other test here is `runIf(live)`, so an unreachable Redis must fail,
  // by name, rather than read as a green skip.
  it('reaches Redis whenever TEST_REDIS_URL is set', () => {
    if (process.env['TEST_REDIS_URL']) expect(reason).toBe('reachable');
  });

  it.runIf(live)(
    'a job that fails once retries with perMailboxPolicy backoff and completes',
    async () => {
      const queueName = `autopilot-apply-registration-test-${randomUUID()}`;
      const queue = new Queue<AutopilotApplyJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(1); // fails attempt 1, succeeds attempt 2
      const worker = new Worker<AutopilotApplyJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        autopilotApplyWorkerOptions(connection!),
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
          // If the backoff STRATEGY isn't registered, BullMQ throws
          // `Unknown backoff strategy custom.` as a Worker-level 'error'
          // while trying to schedule the retry — never a 'failed'/'completed'
          // event for this job at all. Without this listener the promise
          // just times out (a real failure mode observed in review: the
          // test still fails, but by timeout, 15s later, with the real
          // cause buried in stderr instead of the rejection).
          worker.on('error', reject);
        });
        const data = applyJobData();
        await queue.add('apply', data, autopilotApplyJobOptions(`retry-${data.mailboxAccountId}`));
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
    'a job added with the pre-fix bare { jobId } options gets exactly ONE attempt and dead-letters immediately — proving the producer fix matters independently of the registration fix',
    async () => {
      const queueName = `autopilot-apply-registration-test-${randomUUID()}`;
      const queue = new Queue<AutopilotApplyJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(Number.POSITIVE_INFINITY); // never succeeds
      const { observer, failures } = makeObserver();
      const { recorder, entries } = makeRecorder();
      probe.setObserver(observer);
      probe.setDeadLetterRecorder(recorder);
      // Registered WITH the fix (`autopilotApplyWorkerOptions`) — isolating
      // this scenario to the PRODUCER-side half of the two-part bug. BullMQ
      // defaults an option-less job's `attempts` to 0 (bullmq's own
      // `Job` constructor), so it never even reaches the backoff-strategy
      // lookup this Worker's registration exists to satisfy.
      const worker = new Worker<AutopilotApplyJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        autopilotApplyWorkerOptions(connection!),
      );
      try {
        const settled = new Promise<{ attemptsMade: number }>((resolve) => {
          worker.on('failed', (job) => {
            if (job) resolve({ attemptsMade: job.attemptsMade });
          });
        });
        const data = applyJobData();
        // Deliberately the OLD shape: no attempts, no backoff.
        await queue.add('apply', data, { jobId: `bare-${data.mailboxAccountId}` });
        const { attemptsMade } = await settled;
        expect(attemptsMade).toBe(1); // BullMQ never retried
        expect(failures).toHaveLength(1); // but the worker still dead-lettered cleanly...
        expect(entries).toHaveLength(1); // ...once, on attempt 1 — not stuck, just short-budgeted
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
      const queueName = `autopilot-apply-registration-test-${randomUUID()}`;
      const queue = new Queue<AutopilotApplyJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(Number.POSITIVE_INFINITY); // never succeeds
      const { observer, failures } = makeObserver();
      const { recorder, entries } = makeRecorder();
      probe.setObserver(observer);
      probe.setDeadLetterRecorder(recorder);
      const worker = new Worker<AutopilotApplyJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        autopilotApplyWorkerOptions(connection!),
      );
      try {
        const exhausted = new Promise<number>((resolve, reject) => {
          // BullMQ emits 'failed' after EVERY attempt, retryable or not —
          // only the attempt where attemptsMade reaches the policy's
          // maxAttempts (5) is the terminal one.
          worker.on('failed', (job) => {
            if (job && job.attemptsMade >= 5) resolve(job.attemptsMade);
          });
          // See the "fails once, retries, completes" case above for why
          // this listener matters: without it, a missing backoff-strategy
          // registration times out (60s here) instead of failing by name.
          worker.on('error', reject);
        });
        const data = applyJobData();
        await queue.add(
          'apply',
          data,
          autopilotApplyJobOptions(`exhaust-${data.mailboxAccountId}`),
        );
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
      const queueName = `autopilot-apply-registration-test-${randomUUID()}`;
      const queue = new Queue<AutopilotApplyJobData>(queueName, { connection: connection! });
      const probe = new ProbeWorker(1); // would succeed on attempt 2 — if it ever got there
      const worker = new Worker<AutopilotApplyJobData, { ok: true }>(
        queueName,
        (job) => probe.run(job),
        // Deliberately OMITS `...perMailboxWorkerSettings()` — this IS
        // the registration bug, reproduced on purpose. `autopilotApplyWorkerOptions()`
        // is NOT reused here for exactly that reason.
        { connection: connection!, concurrency: 5, ...workerTuningOptions('user-facing') },
      );
      try {
        type Outcome = { kind: 'completed' | 'failed' | 'error' | 'timeout'; message?: string };
        const settled = new Promise<Outcome>((resolve) => {
          worker.on('completed', () => resolve({ kind: 'completed' }));
          worker.on('failed', (_job, err) => resolve({ kind: 'failed', message: err.message }));
          worker.on('error', (err) => resolve({ kind: 'error', message: err.message }));
        });
        const data = applyJobData();
        await queue.add(
          'apply',
          data,
          autopilotApplyJobOptions(`unregistered-${data.mailboxAccountId}`),
        );
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
