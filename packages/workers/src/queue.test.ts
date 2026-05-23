import { describe, expect, it } from 'vitest';

import { ensureInitialSyncJob } from './queue.js';

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

  setJob(state: FakeJob['state'] | null): void {
    this.job = state ? { id: 'mailbox-1', state } : null;
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
