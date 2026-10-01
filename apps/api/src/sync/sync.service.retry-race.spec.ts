import { mailboxAccounts, providerSyncState, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { STALE_INITIAL_SYNC_MS } from '@declutrmail/shared/contracts';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service.js';

describe('initial sync retry concurrency', () => {
  it('accepts only one retry when two tabs retry the same failed scan', async () => {
    const db = await freshTestDb();
    const [workspace] = await db.insert(workspaces).values({ name: 'Retry race' }).returning();
    const [user] = await db
      .insert(users)
      .values({
        workspaceId: workspace!.id,
        email: 'retry-race@example.test',
      })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'retry-race@example.test',
      })
      .returning();
    const mailboxId = mailbox!.id;
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'failed',
      currentStage: 'failed',
      errorCode: 'Error',
      lastHistoryId: 123n,
    });
    const queue = {
      getJob: vi.fn().mockResolvedValue(undefined),
      add: vi.fn(async () => {
        // The worker can start as soon as the first request schedules it.
        await db
          .update(providerSyncState)
          .set({
            readinessStatus: 'syncing',
            currentStage: 'fetching_metadata',
            progressPct: 35,
            lastHistoryId: 456n,
          })
          .where(eq(providerSyncState.mailboxAccountId, mailboxId));
      }),
    };
    const service = new SyncService(queue as never, {} as never, db as never);

    const results = await Promise.all([
      service.retryFailedInitialSync(mailboxId),
      service.retryFailedInitialSync(mailboxId),
    ]);

    expect(results.sort()).toEqual(['not_failed', 'requeued']);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state).toMatchObject({
      readinessStatus: 'syncing',
      progressPct: 35,
      lastHistoryId: 456n,
    });
  });

  it('nudges a stale syncing scan without wiping progress or the cursor', async () => {
    const db = await freshTestDb();
    const [workspace] = await db.insert(workspaces).values({ name: 'Stuck nudge' }).returning();
    const [user] = await db
      .insert(users)
      .values({
        workspaceId: workspace!.id,
        email: 'stuck-nudge@example.test',
      })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'stuck-nudge@example.test',
      })
      .returning();
    const mailboxId = mailbox!.id;
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailboxId,
      readinessStatus: 'syncing',
      currentStage: 'fetching_metadata',
      progressPct: 42,
      lastHistoryId: 789n,
    });
    await db.execute(
      sql`ALTER TABLE provider_sync_state DISABLE TRIGGER provider_sync_state_set_updated_at`,
    );
    await db
      .update(providerSyncState)
      .set({ updatedAt: new Date(Date.now() - STALE_INITIAL_SYNC_MS - 60_000) })
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    await db.execute(
      sql`ALTER TABLE provider_sync_state ENABLE TRIGGER provider_sync_state_set_updated_at`,
    );

    const queue = {
      getJob: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SyncService(queue as never, {} as never, db as never);

    await expect(service.retryFailedInitialSync(mailboxId)).resolves.toBe('requeued');
    expect(queue.add).toHaveBeenCalledTimes(1);

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(state).toMatchObject({
      readinessStatus: 'syncing',
      progressPct: 42,
      lastHistoryId: 789n,
    });
  });
});
