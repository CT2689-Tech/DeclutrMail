import { PGlite } from '@electric-sql/pglite';
import { mailboxAccounts, providerSyncState, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Queue } from 'bullmq';
import type { IncrementalSyncJobData, InitialSyncJobData } from '@declutrmail/workers';

import type { DrizzleDb } from '../db/db.module.js';
import { SyncService } from './sync.service.js';

/**
 * What a Google sign-in or connect-mailbox callback does to sync state.
 *
 * Every returning sign-in used to re-queue an already-synced mailbox and
 * force a full scan, which re-scored every sender — 6,022 Haiku calls for
 * one mailbox on 2026-09-24. A synced, healthy mailbox now stays exactly
 * as it is; the genuine cases still get their full scan.
 */
describe('SyncService.markConnected', () => {
  let pg: PGlite;
  let db: DrizzleDb;
  let service: SyncService;
  let mailboxId: string;

  const SYNCED_AT = new Date('2026-09-20T10:00:00Z');
  const CURSOR = 364_323n;

  beforeAll(async () => {
    pg = await freshTestPglite();
    db = drizzle(pg, { schema }) as unknown as DrizzleDb;

    const [workspace] = await db.insert(workspaces).values({ name: 'Connect test' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'connect@example.com' })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'connect@example.com',
      })
      .returning();
    mailboxId = mailbox!.id;
    service = new SyncService(
      {} as Queue<InitialSyncJobData>,
      {} as Queue<IncrementalSyncJobData>,
      db,
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await db.delete(providerSyncState);
  });

  async function seed(
    overrides: Partial<typeof providerSyncState.$inferInsert> = {},
  ): Promise<void> {
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'ready',
      currentStage: 'ready',
      progressPct: 100,
      lastHistoryId: CURSOR,
      lastSyncedAt: SYNCED_AT,
      ...overrides,
    });
  }

  /** As the orchestrator calls it: inside the connect's transaction. */
  function connect(opts: { wasActive: boolean }) {
    return db.transaction((tx) => service.markConnected(tx, mailboxId, opts));
  }

  async function readState() {
    const [row] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    return row;
  }

  it('keeps a synced, healthy mailbox exactly as it is', async () => {
    await seed();
    const before = await readState();

    await expect(connect({ wasActive: true })).resolves.toBe('kept_ready');

    // Not one column moved: still ready, cursor still applied — so
    // incremental sync carries on and no scan or re-score runs.
    expect(await readState()).toEqual(before);
  });

  it('keeps it when an old revoked grant has since been fixed by a later sync', async () => {
    await seed({
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: new Date('2026-09-10T10:00:00Z'),
    });

    await expect(connect({ wasActive: true })).resolves.toBe('kept_ready');
  });

  it('keeps it through a non-grant error — only a revoked grant needs a reconnect scan', async () => {
    await seed({
      lastIncrementalErrorCode: 'TransientError',
      lastIncrementalErrorAt: new Date('2026-09-21T10:00:00Z'),
    });

    await expect(connect({ wasActive: true })).resolves.toBe('kept_ready');
  });

  it.each([
    ['a first connect (new mailbox, no sync row)', null, false],
    ['an active mailbox with no sync row', null, true],
    ['a mailbox that was disconnected', {}, false],
    [
      'a revoked grant being reconnected',
      {
        lastIncrementalErrorCode: 'InvalidGrantError',
        lastIncrementalErrorAt: new Date('2026-09-22T10:00:00Z'),
      },
      true,
    ],
    [
      'a failed initial sync',
      {
        readinessStatus: 'failed',
        currentStage: 'failed',
        lastHistoryId: null,
        lastSyncedAt: null,
      },
      true,
    ],
    [
      'an initial sync still running',
      { readinessStatus: 'syncing', currentStage: 'fetching_metadata', lastSyncedAt: null },
      true,
    ],
    ['a ready row with no cursor to catch up from', { lastHistoryId: null }, true],
  ] as const)('gives %s a full scan', async (_case, overrides, wasActive) => {
    if (overrides !== null) await seed(overrides as Partial<typeof providerSyncState.$inferInsert>);

    await expect(connect({ wasActive })).resolves.toBe('queued');

    const row = await readState();
    expect(row?.readinessStatus).toBe('queued');
    expect(row?.lastHistoryId).toBeNull();
  });

  it('a reconnect scan clears the revoked-grant evidence the fresh token supersedes', async () => {
    await seed({
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: new Date('2026-09-22T10:00:00Z'),
    });

    await connect({ wasActive: true });

    const row = await readState();
    expect(row?.lastIncrementalErrorCode).toBeNull();
    // The ready-email stamp survives every re-queue (#771 relies on it).
    expect(row?.lastSyncedAt).toEqual(SYNCED_AT);
  });
});

describe('SyncService.scheduleCatchUp', () => {
  function build() {
    return new SyncService(
      {} as Queue<InitialSyncJobData>,
      {} as Queue<IncrementalSyncJobData>,
      {} as DrizzleDb,
    );
  }

  it('enqueues one incremental sync, tagged as a connect', async () => {
    const service = build();
    const enqueue = vi
      .spyOn(service, 'enqueueManualIncrementalSync')
      .mockResolvedValue({ kind: 'enqueued', cursorHistoryId: '1' });

    await service.scheduleCatchUp('mbx-1');

    expect(enqueue).toHaveBeenCalledWith('mbx-1', 'connect');
  });

  it('never fails a sign-in: an enqueue error is logged, not thrown', async () => {
    const service = build();
    vi.spyOn(service, 'enqueueManualIncrementalSync').mockRejectedValue(new Error('redis down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.scheduleCatchUp('mbx-1')).resolves.toBeUndefined();
    expect(error.mock.calls[0]?.[0]).toContain('sync.enqueue_failed');
    error.mockRestore();
  });
});
