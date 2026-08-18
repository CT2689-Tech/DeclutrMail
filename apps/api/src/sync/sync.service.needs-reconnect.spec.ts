import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

import { SyncService } from './sync.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

interface Row {
  mailboxAccountId: string;
  errorCode: string | null;
  lastIncrementalErrorCode: string | null;
  lastIncrementalErrorAt: Date | null;
  lastSyncedAt: Date | null;
}

/**
 * `SyncService.getNeedsReconnectByMailbox` — the batch facade `me` reads
 * through so the app chrome can gate EVERY broken mailbox without a
 * `/sync/status` poll per mailbox on every page (D224), and so the
 * mailboxes/auth features never join `provider_sync_state` (D204).
 *
 * The rule must stay identical to the frontend's
 * `syncStatusNeedsReconnect` and the workers' `notNeedingReconnect`:
 * a recorded `InvalidGrantError` counts only while it is NEWER than the
 * last success. These cases are the three-way contract.
 */
describe('SyncService.getNeedsReconnectByMailbox', () => {
  const T0 = new Date('2026-08-18T00:00:00.000Z');
  const LATER = new Date('2026-08-18T01:00:00.000Z');

  function row(overrides: Partial<Row> & { mailboxAccountId: string }): Row {
    return {
      errorCode: null,
      lastIncrementalErrorCode: null,
      lastIncrementalErrorAt: null,
      lastSyncedAt: null,
      ...overrides,
    };
  }

  function service(rows: Row[]) {
    const db = {
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve(rows) }),
      })),
    };
    const svc = new SyncService(
      {} as unknown as Queue<InitialSyncJobData>,
      {} as unknown as Queue<IncrementalSyncJobData>,
      db as unknown as DrizzleDb,
    );
    return { svc, db };
  }

  it('short-circuits to an empty map without querying for an empty id list', async () => {
    const { svc, db } = service([]);
    expect(await svc.getNeedsReconnectByMailbox([])).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('flags a revoked grant with no successful sync yet', async () => {
    const { svc } = service([
      row({
        mailboxAccountId: 'a',
        lastIncrementalErrorCode: 'InvalidGrantError',
        lastIncrementalErrorAt: T0,
      }),
    ]);
    expect((await svc.getNeedsReconnectByMailbox(['a'])).get('a')).toBe(true);
  });

  it('flags a revoked grant NEWER than the last success', async () => {
    const { svc } = service([
      row({
        mailboxAccountId: 'a',
        lastIncrementalErrorCode: 'InvalidGrantError',
        lastIncrementalErrorAt: LATER,
        lastSyncedAt: T0,
      }),
    ]);
    expect((await svc.getNeedsReconnectByMailbox(['a'])).get('a')).toBe(true);
  });

  it('clears once a success lands after the error — the user reconnected', async () => {
    const { svc } = service([
      row({
        mailboxAccountId: 'a',
        lastIncrementalErrorCode: 'InvalidGrantError',
        lastIncrementalErrorAt: T0,
        lastSyncedAt: LATER,
      }),
    ]);
    expect((await svc.getNeedsReconnectByMailbox(['a'])).get('a')).toBe(false);
  });

  it('ignores a non-grant failure — a rate limit is not a reconnect', async () => {
    const { svc } = service([
      row({
        mailboxAccountId: 'a',
        lastIncrementalErrorCode: 'TransientError',
        lastIncrementalErrorAt: LATER,
        lastSyncedAt: T0,
      }),
    ]);
    expect((await svc.getNeedsReconnectByMailbox(['a'])).get('a')).toBe(false);
  });

  it('flags an initial-sync grant failure with no recency check', async () => {
    // Readiness stays `failed` until a successful run, so `error_code`
    // being set at all is current — there is no stamp to compare.
    const { svc } = service([row({ mailboxAccountId: 'a', errorCode: 'InvalidGrantError' })]);
    expect((await svc.getNeedsReconnectByMailbox(['a'])).get('a')).toBe(true);
  });

  it('reports false for a healthy mailbox and absent for one with no sync row', async () => {
    const { svc } = service([row({ mailboxAccountId: 'a', lastSyncedAt: T0 })]);
    const map = await svc.getNeedsReconnectByMailbox(['a', 'b']);
    expect(map.get('a')).toBe(false);
    expect(map.has('b')).toBe(false);
  });
});
