import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

import { SyncService } from './sync.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

/**
 * `SyncService.retryFailedInitialSync` — the exit from the first-run
 * trap (flow audit 2026-07-28).
 *
 * The trap: after `maxAttempts` the worker writes
 * `readiness_status = 'failed'`, the continuous reconciler sweeps
 * `'queued'` only, and no route re-queued a failed row. The gate's
 * "Try again" was a page reload and the onboarding guard bounced every
 * other route — including /settings and /billing — back to that same
 * screen, so clearing cookies was the only way out.
 *
 * The gating is the load-bearing part: re-queuing a `syncing` mailbox
 * races the live worker, and re-queuing a `ready` one wipes the applied
 * cursor (`markQueued` clears `last_history_id` by design) and forces a
 * needless full re-sync.
 */
describe('SyncService.retryFailedInitialSync', () => {
  function service(rows: Array<{ readinessStatus: string }>) {
    const db = {
      select: vi.fn(() => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
      })),
      insert: vi.fn(() => ({
        values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }),
      })),
    };
    const initialQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new SyncService(
      initialQueue as unknown as Queue<InitialSyncJobData>,
      {} as unknown as Queue<IncrementalSyncJobData>,
      db as unknown as DrizzleDb,
    );
    return { svc, db, initialQueue };
  }

  it('re-queues a terminally FAILED initial sync', async () => {
    const { svc, db, initialQueue } = service([{ readinessStatus: 'failed' }]);
    await expect(svc.retryFailedInitialSync('mb-1')).resolves.toBe('requeued');
    // Both halves of the durable intent: the `queued` row AND the job.
    expect(db.insert).toHaveBeenCalled();
    expect(initialQueue.add).toHaveBeenCalled();
  });

  it('still reports requeued when the BullMQ enqueue fails — the row IS the intent', async () => {
    // D157/D224 contract: `readiness_status = 'queued'` is the durable
    // sync intent and BullMQ is the execution cache. A Redis blip must
    // not turn a successful re-queue into a user-visible failure — the
    // continuous reconciler sweeps `queued` rows and picks it up.
    const { svc, db, initialQueue } = service([{ readinessStatus: 'failed' }]);
    initialQueue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.retryFailedInitialSync('mb-1')).resolves.toBe('requeued');
    expect(db.insert).toHaveBeenCalled();
  });

  it('refuses a SYNCING mailbox — re-queuing would race the live worker', async () => {
    const { svc, db, initialQueue } = service([{ readinessStatus: 'syncing' }]);
    await expect(svc.retryFailedInitialSync('mb-1')).resolves.toBe('not_failed');
    expect(db.insert).not.toHaveBeenCalled();
    expect(initialQueue.add).not.toHaveBeenCalled();
  });

  it('refuses a READY mailbox — re-queuing would wipe the applied cursor', async () => {
    const { svc, db, initialQueue } = service([{ readinessStatus: 'ready' }]);
    await expect(svc.retryFailedInitialSync('mb-1')).resolves.toBe('not_failed');
    expect(db.insert).not.toHaveBeenCalled();
    expect(initialQueue.add).not.toHaveBeenCalled();
  });

  it('reports no_state when the mailbox has no sync row at all', async () => {
    const { svc, initialQueue } = service([]);
    await expect(svc.retryFailedInitialSync('mb-1')).resolves.toBe('no_state');
    expect(initialQueue.add).not.toHaveBeenCalled();
  });
});
