import { cronRuns } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { billingVerdictJobOptions } from './billing-verdict.queue.js';
import {
  BILLING_VERDICT_STALE_RUNNING_MS,
  BillingVerdictWorker,
} from './billing-verdict.worker.js';
import type {
  BillingVerdictDeps,
  BillingVerdictJobData,
  BillingVerdictResult,
} from './billing-verdict.worker.js';
import type { WorkerContext } from './worker-context.js';
import type { WorkerObserver } from './worker-observer.js';
import { WORKER_POLICIES } from './worker-policies.js';

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

  function verdictJob(minute: string): Job<BillingVerdictJobData, BillingVerdictResult> {
    return {
      id: `BillingVerdictWorker:${minute}`,
      data: { scheduledAtMinute: minute },
      attemptsMade: 0,
      opts: { attempts: 3 },
      queueName: 'billing-verdict',
      timestamp: Date.now(),
    } as unknown as Job<BillingVerdictJobData, BillingVerdictResult>;
  }

  async function claimRow(db: Awaited<ReturnType<typeof freshTestDb>>, runKey: string) {
    const runs = await db.select().from(cronRuns);
    return runs.find((row) => row.runKey === runKey);
  }

  it('a hung enforce pass ends at the cron deadline and the next minute can run', async () => {
    const db = await freshTestDb();
    let inflight = 0;
    let maxInflight = 0;
    const calls: string[] = [];
    let hang = true;
    const seams: Seams = {
      enforceLocalVerdicts: (_runIndex, signal) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        calls.push('enforce');
        if (!hang) {
          inflight -= 1;
          return Promise.resolve({ enforced: 0, unenforced: 0, refuted: 0, settled: 0 });
        }
        // No signal: never settle. That is the production hang — the
        // deadline aborts ctx.signal and withTimeout waits forever.
        return new Promise((_resolve, reject) => {
          const stop = () => {
            hang = false;
            inflight -= 1;
            const reason = signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          };
          if (!signal) return;
          if (signal.aborted) stop();
          else signal.addEventListener('abort', stop, { once: true });
        });
      },
      watchSettledRefunds: () => {
        calls.push('watch');
        return Promise.resolve({ watched: 0, rebilling: 0, unreadable: 0 });
      },
    };
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const first = worker.run(verdictJob('2026-08-12T06:00')).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(WORKER_POLICIES.cronPolicy.timeoutMs);
      const outcome = await first;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(Error);
        expect((outcome.error as Error).message).toContain('exceeded');
      }
      expect(inflight).toBe(0);
      expect(maxInflight).toBe(1);
      expect(calls).toEqual(['enforce']);
      expect((await claimRow(db, 'BillingVerdictWorker:2026-08-12T06:00'))?.status).toBe('failed');

      vi.useRealTimers();
      const second = await worker.processJob({ scheduledAtMinute: '2026-08-12T06:10' }, CTX);
      expect(second.outcome).toBe('swept');
      expect(calls).toEqual(['enforce', 'enforce', 'watch']);
      expect(maxInflight).toBe(1);
      expect((await claimRow(db, 'BillingVerdictWorker:2026-08-12T06:10'))?.status).toBe(
        'succeeded',
      );
    } finally {
      vi.useRealTimers();
      errorLog.mockRestore();
    }
  });

  it('a hung watch pass keeps the claim succeeded so the retry does not resend', async () => {
    const db = await freshTestDb();
    const calls: string[] = [];
    const seams: Seams = {
      enforceLocalVerdicts: () => {
        calls.push('enforce');
        return Promise.resolve({ enforced: 1, unenforced: 0, refuted: 0, settled: 0 });
      },
      watchSettledRefunds: (_runIndex, signal) => {
        calls.push('watch');
        return new Promise((_resolve, reject) => {
          const stop = () => {
            const reason = signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          };
          if (!signal) return;
          if (signal.aborted) stop();
          else signal.addEventListener('abort', stop, { once: true });
        });
      },
    };
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const first = worker.run(verdictJob(MINUTE)).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(WORKER_POLICIES.cronPolicy.timeoutMs);
      const outcome = await first;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect((outcome.error as Error).message).toContain('exceeded');
      expect(calls).toEqual(['enforce', 'watch']);
      const hung = await claimRow(db, `BillingVerdictWorker:${MINUTE}`);
      expect(hung?.status).toBe('succeeded');
      expect(hung?.finishedAt).not.toBeNull();

      vi.useRealTimers();
      const retry = await worker.processJob({ scheduledAtMinute: MINUTE }, { ...CTX, attempt: 2 });
      expect(retry).toMatchObject({ outcome: 'duplicate_run_key', enforced: 0 });
      expect(calls).toEqual(['enforce', 'watch']);
    } finally {
      vi.useRealTimers();
      errorLog.mockRestore();
    }
  });

  it('fails a stale running claim for another minute without calling the provider', async () => {
    const db = await freshTestDb();
    const staleKey = 'BillingVerdictWorker:2026-08-12T05:00';
    const keptKey = 'BillingVerdictWorker:2026-08-12T05:50';
    const doneKey = 'BillingVerdictWorker:2026-08-12T04:00';
    await db.insert(cronRuns).values([
      {
        workerName: 'BillingVerdictWorker',
        runKey: staleKey,
        status: 'running',
        startedAt: new Date(Date.now() - BILLING_VERDICT_STALE_RUNNING_MS - 60_000),
      },
      {
        workerName: 'BillingVerdictWorker',
        runKey: keptKey,
        status: 'running',
        startedAt: new Date(Date.now() - 30_000),
      },
      {
        workerName: 'BillingVerdictWorker',
        runKey: doneKey,
        status: 'succeeded',
        startedAt: new Date(Date.now() - BILLING_VERDICT_STALE_RUNNING_MS - 120_000),
        finishedAt: new Date(Date.now() - BILLING_VERDICT_STALE_RUNNING_MS),
      },
    ]);
    const { seams, calls } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);
      expect(result.outcome).toBe('swept');
      expect(calls).toEqual(['enforce', 'watch']);
      expect((await claimRow(db, staleKey))?.status).toBe('failed');
      expect((await claimRow(db, staleKey))?.finishedAt).not.toBeNull();
      expect((await claimRow(db, keptKey))?.status).toBe('running');
      expect((await claimRow(db, keptKey))?.finishedAt).toBeNull();
      expect((await claimRow(db, doneKey))?.status).toBe('succeeded');
      const recovered = warn.mock.calls
        .map((call) => JSON.parse(String(call[0])) as { kind?: string; count?: number })
        .find((line) => line.kind === 'billing.verdict.stale_running_recovered');
      expect(recovered).toMatchObject({ count: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  it('reclaims a stale running claim for the SAME minute and calls each seam once', async () => {
    const db = await freshTestDb();
    const runKey = `BillingVerdictWorker:${MINUTE}`;
    await db.insert(cronRuns).values({
      workerName: 'BillingVerdictWorker',
      runKey,
      status: 'running',
      startedAt: new Date(Date.now() - BILLING_VERDICT_STALE_RUNNING_MS - 60_000),
    });
    const { seams, calls } = makeSeams();
    const worker = new BillingVerdictWorker({ db: db as never, ...seams });

    const result = await worker.processJob({ scheduledAtMinute: MINUTE }, CTX);

    expect(result.outcome).toBe('swept');
    expect(calls).toEqual(['enforce', 'watch']);
    const row = await claimRow(db, runKey);
    expect(row?.status).toBe('succeeded');
    expect(await db.select().from(cronRuns)).toHaveLength(1);
  });
});
