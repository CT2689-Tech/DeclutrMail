import { cronRuns } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { billingVerdictJobOptions } from './billing-verdict.queue.js';
import { BillingVerdictWorker } from './billing-verdict.worker.js';
import type {
  BillingVerdictDeps,
  BillingVerdictJobData,
  BillingVerdictResult,
} from './billing-verdict.worker.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';

/**
 * BillingVerdictWorker integration tests (D253, D249, D225).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Asserts the D225 `cron_runs` idempotency claim
 * (fresh insert / succeeded-skip / failed-takeover) and — the half that
 * actually matters — that the injected seams fire exactly as many times
 * as the claim says they did. A `duplicate_run_key` return that still
 * hit the provider twice would be a passing test and a broken worker.
 */

type Seams = Pick<BillingVerdictDeps, 'enforceLocalVerdicts' | 'watchSettledRefunds'>;

/** Seam stubs that record their call order. */
function makeSeams(fail: { enforce?: Error; watch?: Error } = {}): {
  seams: Seams;
  calls: string[];
  runIndexes: number[];
} {
  const calls: string[] = [];
  const runIndexes: number[] = [];
  const seams: Seams = {
    enforceLocalVerdicts: (runIndex: number) => {
      calls.push('enforce');
      runIndexes.push(runIndex);
      return fail.enforce
        ? Promise.reject(fail.enforce)
        : Promise.resolve({ enforced: 2, unenforced: 1, refuted: 1, settled: 4 });
    },
    watchSettledRefunds: (runIndex: number) => {
      calls.push('watch');
      runIndexes.push(runIndex);
      return fail.watch
        ? Promise.reject(fail.watch)
        : Promise.resolve({ watched: 3, rebilling: 1, unreadable: 1 });
    },
  };
  return { seams, calls, runIndexes };
}

const CTX: WorkerContext = {
  jobId: 'j1',
  workerName: 'BillingVerdictWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

const MINUTE = '2026-08-12T06:00';

describe('BillingVerdictWorker', () => {
  it('runs both seams in order and records a succeeded cron_runs row', async () => {
    const db = await freshTestDb();
    const { seams, calls } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    // Enforcement (outbound) precedes detection (read-only): the watch
    // must see the state the enforcement pass just converged.
    expect(calls).toEqual(['enforce', 'watch']);
    expect(result).toMatchObject({
      outcome: 'swept',
      enforced: 2,
      unenforced: 1,
      refuted: 1,
      // The counter D253 turns on: a settled refund frees the plan slot.
      settled: 4,
      watched: 3,
      rebilling: 1,
      unreadable: 1,
      watchFailed: false,
    });

    // D225 idempotency ledger: one succeeded row for the run-key.
    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workerName: 'BillingVerdictWorker',
      runKey: `BillingVerdictWorker:${MINUTE}`,
      status: 'succeeded',
    });
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it('PREVENTS OVERLAP: a second run for the same minute calls neither seam', async () => {
    const db = await freshTestDb();
    const { seams, calls } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });

    await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);
    const second = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(second).toMatchObject({
      outcome: 'duplicate_run_key',
      enforced: 0,
      settled: 0,
      watched: 0,
    });
    // The load-bearing assertion: no second round of provider calls.
    expect(calls).toEqual(['enforce', 'watch']);
    expect(await db.select().from(cronRuns)).toHaveLength(1);
  });

  it('RETRIES take a failed run-key back over instead of skipping', async () => {
    const db = await freshTestDb();
    // Attempt 1: the enforcement seam throws → cron_runs flips to 'failed'.
    const failing = makeSeams({ enforce: new Error('paddle 503') });
    const worker1 = new BillingVerdictWorker({ db: db as never, ...failing.seams });
    await expect(worker1.processJob({ scheduledAtMinute: MINUTE }, CTX)).rejects.toThrow(
      'paddle 503',
    );
    const afterFailure = await db.select().from(cronRuns);
    expect(afterFailure).toHaveLength(1);
    expect(afterFailure[0]!.status).toBe('failed');
    // A throw must not leave the detector running against a half-claimed slot.
    expect(failing.calls).toEqual(['enforce']);

    // Attempt 2 (BullMQ retry, same minute): must re-claim and succeed.
    const healthy = makeSeams();
    const worker2 = new BillingVerdictWorker({ db: db as never, ...healthy.seams });
    const result = await worker2.processJob({ scheduledAtMinute: MINUTE }, { ...CTX, attempt: 2 });

    expect(result).toMatchObject({ outcome: 'swept', enforced: 2 });
    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
  });

  it('ISOLATES a settled-refund watch failure: job succeeds, but never silently', async () => {
    const db = await freshTestDb();
    const watchError = new Error('paddle transactions 500');
    const { seams, calls } = makeSeams({ watch: watchError });
    const captured: { error: Error; kind: string }[] = [];
    const observer: WorkerObserver = {
      captureFailure: () => {},
      captureBackgroundFailure: (error, ctx) => captured.push({ error, kind: ctx.kind }),
      recordBackgroundNotice: () => {},
    };
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });
    worker.setObserver(observer);

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    // The enforcement half landed and is durable — failing the job would
    // only retry the OUTBOUND pass to fix a read-only detector.
    expect(calls).toEqual(['enforce', 'watch']);
    expect(result).toMatchObject({
      outcome: 'swept',
      enforced: 2,
      watched: 0,
      rebilling: 0,
      unreadable: 0,
      // Zero counters would otherwise be indistinguishable from a clean run.
      watchFailed: true,
    });
    expect(captured).toEqual([{ error: watchError, kind: 'billing.verdict.watch_failed' }]);

    // Claim released, not left 'running' — the pass really did end.
    const runs = await db.select().from(cronRuns);
    expect(runs[0]!.status).toBe('succeeded');
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it('declares cronPolicy and the D225 (worker, minute) idempotency key', () => {
    const { seams } = makeSeams();
    const worker = new BillingVerdictWorker({ db: null as never, ...seams });
    expect(worker.policy).toBe('cronPolicy');
    expect(
      (
        worker as unknown as { getIdempotencyKey(p: { scheduledAtMinute: string }): string }
      ).getIdempotencyKey({ scheduledAtMinute: MINUTE }),
    ).toBe(`BillingVerdictWorker:${MINUTE}`);
  });

  it('builds minute-keyed BullMQ job options (queue-level dedup layer)', () => {
    const opts = billingVerdictJobOptions(MINUTE);
    expect(opts.jobId).toBe(`BillingVerdictWorker:${MINUTE}`);
    expect(opts.attempts).toBe(3); // cronPolicy.maxAttempts
    expect(opts.removeOnFail).toBe(false);
  });

  it('reports EVERY counter on worker.succeeded — the allowlist drops silently', async () => {
    // `SAFE_WORKER_RESULT_KEYS` is a denylist by omission: a counter
    // missing from it vanishes from the ops line with no error anywhere.
    // `settled` is the one D253 is judged on, so this asserts the whole
    // set arrives rather than trusting the edit.
    const db = await freshTestDb();
    const { seams } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await worker.run({
        id: 'job-1',
        data: { scheduledAtMinute: MINUTE },
        attemptsMade: 0,
        queueName: 'billing-verdict',
      } as unknown as Job<BillingVerdictJobData, BillingVerdictResult>);
      const succeeded = logSpy.mock.calls
        .map((call) => JSON.parse(String(call[0])) as { kind: string; result?: unknown })
        .find((line) => line.kind === 'worker.succeeded');
      expect(succeeded?.result).toMatchObject({
        outcome: 'swept',
        enforced: 2,
        unenforced: 1,
        refuted: 1,
        settled: 4,
        watched: 3,
        rebilling: 1,
        unreadable: 1,
        watchFailed: false,
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  // Both passes partition their rows and take the slice this index
  // names, so every row is examined at least once every `buckets` runs.
  // That bound is worth exactly as much as the stride below.
  it('hands both seams a run index that advances by exactly ONE per run', async () => {
    const db = await freshTestDb();
    const { seams, runIndexes } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });

    // Three consecutive scheduled runs at the real 10-minute cadence.
    for (const minute of ['2026-08-12T06:00', '2026-08-12T06:10', '2026-08-12T06:20']) {
      await worker.processJob({ scheduledAtMinute: minute }, CTX);
    }

    // Both seams within a run see the SAME index — they slice the same
    // population and must agree on which slice this run owns.
    expect(runIndexes).toHaveLength(6);
    const [enforce0, watch0, enforce1, watch1, enforce2, watch2] = runIndexes as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    expect(watch0).toBe(enforce0);
    expect(watch1).toBe(enforce1);
    expect(watch2).toBe(enforce2);

    // Stride of exactly one. A counter advancing by the cadence instead
    // (raw minutes, +10 per run) would resonate against any bucket count
    // sharing a factor with 10 and revisit the same buckets forever —
    // reintroducing the starvation one level up.
    expect(enforce1 - enforce0).toBe(1);
    expect(enforce2 - enforce1).toBe(1);
  });
});
