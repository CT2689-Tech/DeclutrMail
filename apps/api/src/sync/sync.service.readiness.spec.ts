import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

import { SyncService } from './sync.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { InitialSyncJobData } from '@declutrmail/workers';

/**
 * `SyncService.getReadinessByMailbox` — the batch facade the account
 * switcher reads through (D116) so the mailboxes feature never joins
 * `provider_sync_state` itself (D204).
 */
describe('SyncService.getReadinessByMailbox', () => {
  function service(rows: Array<{ mailboxAccountId: string; readinessStatus: string }>) {
    const db = {
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve(rows) }),
      })),
    };
    const svc = new SyncService(
      {} as unknown as Queue<InitialSyncJobData>,
      db as unknown as DrizzleDb,
    );
    return { svc, db };
  }

  it('short-circuits to an empty map without querying for an empty id list', async () => {
    const { svc, db } = service([]);
    expect(await svc.getReadinessByMailbox([])).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('maps mailbox id → readiness; ids with no sync row are absent', async () => {
    const { svc } = service([
      { mailboxAccountId: 'a', readinessStatus: 'ready' },
      { mailboxAccountId: 'b', readinessStatus: 'syncing' },
    ]);
    const map = await svc.getReadinessByMailbox(['a', 'b', 'c']);
    expect(map.get('a')).toBe('ready');
    expect(map.get('b')).toBe('syncing');
    expect(map.has('c')).toBe(false);
  });
});
