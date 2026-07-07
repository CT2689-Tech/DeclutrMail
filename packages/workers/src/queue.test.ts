import { describe, expect, it } from 'vitest';

import { ensureIncrementalSyncJob, ensureInitialSyncJob, workerTuningOptions } from './queue.js';

/**
 * `ensureInitialSyncJob` tests (Codex iter 5, 2026-05-22).
 *
 * The helper is the SINGLE scheduling implementation shared by the
 * connect path (`sync.service`) and the worker's periodic reconciler.
 * It must:
 *
 *   - add a job when none exists (`'added'`)
 *   - remove + re-add a `completed` / `failed` job (`'replaced'`) so
 *     terminal residue never blocks a reconnect
 *   - no-op for any live state (waiting/active/delayed/prioritized/
 *     waiting-children) so the reconciler tick can't double-enqueue
 *
 * A fake Queue stands in for BullMQ — only the surface
 * `ensureInitialSyncJob` touches (`getJob` + `add`).
 */

interface FakeJob {
  id: string;
  state:
    | 'completed'
    | 'failed'
    | 'unknown'
    | 'waiting'
    | 'active'
    | 'delayed'
    | 'prioritized'
    | 'waiting-children';
}

class FakeQueue {
  private job: FakeJob | null = null;
  addCalls = 0;
  removeCalls = 0;
  /** Simulate BullMQ rejecting `remove()` on a job that just got locked. */
  removeRejects = false;

  setJob(state: FakeJob['state'] | null, id = 'mailbox-1'): void {
    this.job = state ? { id, state } : null;
  }

  // BullMQ surface — only the methods the helper actually calls.
  async getJob(id: string): Promise<{
    getState: () => Promise<FakeJob['state']>;
    remove: () => Promise<void>;
  } | null> {
    if (!this.job || this.job.id !== id) return null;
    const job = this.job;
    return {
      getState: async () => job.state,
      remove: async () => {
        this.removeCalls += 1;
        if (this.removeRejects) throw new Error('Missing lock for job mailbox-1; could not remove');
        this.job = null;
      },
    };
  }

  async add(): Promise<void> {
    this.addCalls += 1;
    this.job = { id: 'mailbox-1', state: 'waiting' };
  }
}

describe('ensureInitialSyncJob', () => {
  it('adds a job when none exists', async () => {
    const q = new FakeQueue();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1');
    expect(outcome).toBe('added');
    expect(q.addCalls).toBe(1);
    expect(q.removeCalls).toBe(0);
  });

  it("replaces a 'completed' job (terminal residue must not block reconnect)", async () => {
    const q = new FakeQueue();
    q.setJob('completed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1');
    expect(outcome).toBe('replaced');
    expect(q.removeCalls).toBe(1);
    expect(q.addCalls).toBe(1);
  });

  it("replaces a 'failed' job", async () => {
    const q = new FakeQueue();
    q.setJob('failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1');
    expect(outcome).toBe('replaced');
    expect(q.removeCalls).toBe(1);
    expect(q.addCalls).toBe(1);
  });

  it("replaces an 'unknown' job (Redis eviction; Codex iter 6)", async () => {
    // `getState()` returns `'unknown'` when the job's Redis hash has
    // been evicted (TTL, flushdb, cluster failover). If we left this as
    // 'noop' a `queued` durable intent could never materialize: the
    // reconciler would forever see a thin job handle and skip. Must be
    // treated as terminal residue → remove + re-add.
    const q = new FakeQueue();
    q.setJob('unknown');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1');
    expect(outcome).toBe('replaced');
    expect(q.removeCalls).toBe(1);
    expect(q.addCalls).toBe(1);
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'] as const)(
    "no-ops for live state '%s' (reconciler tick must not double-enqueue)",
    async (state) => {
      const q = new FakeQueue();
      q.setJob(state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1');
      expect(outcome).toBe('noop');
      expect(q.addCalls).toBe(0);
      expect(q.removeCalls).toBe(0);
    },
  );

  describe('force (re)connect — supersede stale-token jobs', () => {
    it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'] as const)(
      "force reaps a non-active pending job '%s' (its token is now stale)",
      async (state) => {
        const q = new FakeQueue();
        q.setJob(state);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1', { force: true });
        expect(outcome).toBe('replaced');
        expect(q.removeCalls).toBe(1);
        expect(q.addCalls).toBe(1);
      },
    );

    it('force NEVER removes an active (locked) job — leaves it as a no-op', async () => {
      const q = new FakeQueue();
      q.setJob('active');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1', { force: true });
      expect(outcome).toBe('noop');
      expect(q.removeCalls).toBe(0);
      expect(q.addCalls).toBe(0);
    });

    it('force still adds when no job exists', async () => {
      const q = new FakeQueue();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1', { force: true });
      expect(outcome).toBe('added');
      expect(q.addCalls).toBe(1);
    });

    it('force still replaces terminal residue (failed) — same as without force', async () => {
      const q = new FakeQueue();
      q.setJob('failed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1', { force: true });
      expect(outcome).toBe('replaced');
      expect(q.removeCalls).toBe(1);
      expect(q.addCalls).toBe(1);
    });

    it('lost race: remove() rejects (job locked mid-flight) → noop, no double-add', async () => {
      const q = new FakeQueue();
      q.setJob('waiting');
      q.removeRejects = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureInitialSyncJob(q as any, 'mailbox-1', { force: true });
      expect(outcome).toBe('noop');
      // remove was attempted, but the failure must NOT lead to an add.
      expect(q.removeCalls).toBe(1);
      expect(q.addCalls).toBe(0);
    });
  });

  it('repeated calls remain idempotent (the reconciler runs every 60s)', async () => {
    const q = new FakeQueue();
    // First sweep — adds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await ensureInitialSyncJob(q as any, 'mailbox-1')).toBe('added');
    // Job is now `waiting`; subsequent sweeps must NOT add again.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await ensureInitialSyncJob(q as any, 'mailbox-1')).toBe('noop');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await ensureInitialSyncJob(q as any, 'mailbox-1')).toBe('noop');
    expect(q.addCalls).toBe(1);
  });
});

describe('workerTuningOptions', () => {
  it('returns safe defaults per profile when env is unset', () => {
    expect(workerTuningOptions('user-facing', {})).toEqual({
      drainDelay: 10,
      stalledInterval: 60_000,
    });
    expect(workerTuningOptions('cron', {})).toEqual({
      drainDelay: 60,
      stalledInterval: 300_000,
    });
  });

  it('parses env overrides, clamps user-facing drainDelay to 10s, falls back on garbage', () => {
    const env = {
      WORKER_DRAIN_DELAY_SEC: '5',
      WORKER_STALLED_INTERVAL_MS: 'not-a-number',
      WORKER_CRON_DRAIN_DELAY_SEC: '120',
      WORKER_CRON_STALLED_INTERVAL_MS: '600000',
    };
    expect(workerTuningOptions('user-facing', env)).toEqual({
      drainDelay: 5,
      stalledInterval: 60_000, // garbage env → fallback
    });
    expect(workerTuningOptions('cron', env)).toEqual({
      drainDelay: 120,
      stalledInterval: 600_000,
    });
    // Snappy-pickup invariant: env can never push user-facing past 10s.
    expect(workerTuningOptions('user-facing', { WORKER_DRAIN_DELAY_SEC: '60' }).drainDelay).toBe(
      10,
    );
  });

  it('rejects zero, negative, and whitespace env (a 0s drainDelay is a hot-spin)', () => {
    expect(workerTuningOptions('cron', { WORKER_CRON_DRAIN_DELAY_SEC: '0' }).drainDelay).toBe(60);
    expect(workerTuningOptions('cron', { WORKER_CRON_DRAIN_DELAY_SEC: '-5' }).drainDelay).toBe(60);
    expect(
      workerTuningOptions('user-facing', { WORKER_STALLED_INTERVAL_MS: '  ' }).stalledInterval,
    ).toBe(60_000);
  });
});

/**
 * `ensureIncrementalSyncJob` terminal-residue tests (2026-07-07
 * integrated smoke). A completed ack is retained 24h and a failed job
 * forever; both satisfy `getJob`, so without the state check a quiet
 * mailbox turned "Sync now" into a silent no-op (watch timeout), and a
 * dead-lettered incremental bricked the cursor permanently — every
 * webhook/drift/manual enqueue dropped against the failed ack.
 */
describe('ensureIncrementalSyncJob', () => {
  const DATA = { mailboxAccountId: 'mailbox', startHistoryId: '42', endHistoryId: '42' };
  const JOB_ID = 'mailbox__42';

  it('adds a job when none exists', async () => {
    const q = new FakeQueue();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureIncrementalSyncJob(q as any, DATA);
    expect(outcome).toBe('added');
    expect(q.addCalls).toBe(1);
  });

  it.each(['completed', 'failed', 'unknown'] as const)(
    "replaces terminal residue '%s' — a retained ack must not swallow a re-sync",
    async (state) => {
      const q = new FakeQueue();
      q.setJob(state, JOB_ID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureIncrementalSyncJob(q as any, DATA);
      expect(outcome).toBe('added');
      expect(q.removeCalls).toBe(1);
      expect(q.addCalls).toBe(1);
    },
  );

  it.each(['waiting', 'active', 'delayed'] as const)(
    "no-ops for live state '%s' (webhook redelivery dedup preserved)",
    async (state) => {
      const q = new FakeQueue();
      q.setJob(state, JOB_ID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await ensureIncrementalSyncJob(q as any, DATA);
      expect(outcome).toBe('noop');
      expect(q.addCalls).toBe(0);
      expect(q.removeCalls).toBe(0);
    },
  );

  it('lost race: remove() rejects (job locked mid-flight) → noop, no double-add', async () => {
    const q = new FakeQueue();
    q.setJob('completed', JOB_ID);
    q.removeRejects = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = await ensureIncrementalSyncJob(q as any, DATA);
    expect(outcome).toBe('noop');
    expect(q.addCalls).toBe(0);
  });
});
