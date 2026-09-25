import {
  mailboxAccounts,
  outboxEvents,
  providerSyncState,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { isAwaitingReconnect, recordMailboxSyncFailure } from './mailbox-reconnect.js';

/**
 * A sign-in keeps a synced mailbox `ready` — no re-scan stamps
 * `last_synced_at` over a stray failure any more. So a job that read the
 * OLD, already-dead grant before the reconnect committed, and fails
 * after it, must not put the just-reconnected mailbox back behind the
 * reconnect gate (and send the reconnect email).
 */
const CONNECTED_AT = new Date('2026-09-25T10:00:00Z');
const BEFORE = new Date(CONNECTED_AT.getTime() - 1_000);
const AFTER = new Date(CONNECTED_AT.getTime() + 1_000);

type Db = Awaited<ReturnType<typeof freshTestDb>>;

async function seed(db: Db): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Reconnect test' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'reconnect@x.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'reconnect@x.com',
      connectedAt: CONNECTED_AT,
    })
    .returning({ id: mailboxAccounts.id });
  await db.insert(providerSyncState).values({
    mailboxAccountId: mb!.id,
    readinessStatus: 'ready',
    currentStage: 'ready',
    lastSyncedAt: new Date('2026-09-24T10:00:00Z'),
  });
  return mb!.id;
}

describe('recordMailboxSyncFailure — a failure against a replaced grant', () => {
  it('ignores a revoked grant from an attempt that began before the reconnect', async () => {
    const db = await freshTestDb();
    const mailbox = await seed(db);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await recordMailboxSyncFailure(db as never, mailbox, 'InvalidGrantError', {
      attemptStartedAt: BEFORE,
    });

    expect(await isAwaitingReconnect(db as never, mailbox)).toBe(false);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    expect(log.mock.calls.some(([line]) => String(line).includes('superseded_grant'))).toBe(true);
    log.mockRestore();
  });

  it('records a revoked grant from an attempt that began after the reconnect', async () => {
    const db = await freshTestDb();
    const mailbox = await seed(db);

    await recordMailboxSyncFailure(db as never, mailbox, 'InvalidGrantError', {
      attemptStartedAt: AFTER,
    });

    expect(await isAwaitingReconnect(db as never, mailbox)).toBe(true);
    const notices = await db.select().from(outboxEvents);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ topic: 'mailbox.reconnect_required', aggregateId: mailbox });
  });

  it('records it as before when the caller has no attempt start', async () => {
    const db = await freshTestDb();
    const mailbox = await seed(db);

    await recordMailboxSyncFailure(db as never, mailbox, 'InvalidGrantError');

    expect(await isAwaitingReconnect(db as never, mailbox)).toBe(true);
  });

  it('still records a non-grant error from an earlier attempt — only the grant was replaced', async () => {
    const db = await freshTestDb();
    const mailbox = await seed(db);

    await recordMailboxSyncFailure(db as never, mailbox, 'TransientError', {
      attemptStartedAt: BEFORE,
    });

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailbox));
    expect(state?.lastIncrementalErrorCode).toBe('TransientError');
  });
});
