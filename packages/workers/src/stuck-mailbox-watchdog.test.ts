/**
 * Stuck-mailbox watchdog — proactive detection for a mailbox that is
 * silently broken with nobody aware, generalized beyond any one error
 * code.
 *
 * Two real production incidents motivate this, both found via manual
 * error review rather than any alert (2026-09-04/05):
 *   - `sync_failed`: an initial sync stuck on `readiness_status =
 *     'failed'` (RateLimitError) for 8+ days, never onboarded.
 *   - `needs_reconnect`: an incremental sync stuck on a revoked Gmail
 *     grant for 16+ days while `readiness_status` still read `'ready'`.
 *
 * Real schema via in-process PGlite (the `initial-sync-reconciler.spec.ts`
 * convention).
 */

import { mailboxAccounts, providerSyncState, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { findStuckMailboxes, STUCK_MAILBOX_GRACE_MS } from './stuck-mailbox-watchdog.js';

type Db = Awaited<ReturnType<typeof freshTestDb>>;

const NOW = new Date('2026-09-05T12:00:00.000Z');
/** Comfortably past the grace window. */
const STALE = new Date(NOW.getTime() - STUCK_MAILBOX_GRACE_MS - 60 * 60 * 1000);
/** Inside the grace window — a failure from a few minutes ago. */
const FRESH = new Date(NOW.getTime() - 5 * 60 * 1000);

let db: Db;

async function seedMailbox(
  email: string,
  status: 'active' | 'disconnected' = 'active',
): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
      status,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

/**
 * `updated_at` is trigger-maintained (`provider_sync_state_set_updated_at
 * BEFORE UPDATE`) — an ordinary UPDATE cannot backdate it, the trigger
 * stomps any supplied value with `now()` (the same gotcha
 * `initial-sync-reconciler.spec.ts` documents). Suspend it for the one
 * statement that backdates the row.
 */
async function backdateUpdatedAt(mailboxAccountId: string, updatedAt: Date): Promise<void> {
  await db.execute(
    sql`ALTER TABLE provider_sync_state DISABLE TRIGGER provider_sync_state_set_updated_at`,
  );
  await db
    .update(providerSyncState)
    .set({ updatedAt })
    .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
  await db.execute(
    sql`ALTER TABLE provider_sync_state ENABLE TRIGGER provider_sync_state_set_updated_at`,
  );
}

function run(): ReturnType<typeof findStuckMailboxes> {
  return findStuckMailboxes(db as never, { now: () => NOW });
}

beforeEach(async () => {
  db = await freshTestDb();
});

describe('findStuckMailboxes', () => {
  it('flags a sync_failed mailbox whose row has not been touched since before the grace window', async () => {
    const id = await seedMailbox('stale-failed@example.com');
    await db
      .insert(providerSyncState)
      .values({ mailboxAccountId: id, readinessStatus: 'failed', errorCode: 'RateLimitError' });
    await backdateUpdatedAt(id, STALE);

    const result = await run();

    expect(result).toEqual([
      {
        mailboxAccountId: id,
        reason: 'sync_failed',
        errorCode: 'RateLimitError',
        stuckSince: STALE,
      },
    ]);
  });

  it('does NOT flag a failed mailbox still inside the grace window — a retry may still land', async () => {
    const id = await seedMailbox('fresh-failed@example.com');
    await db
      .insert(providerSyncState)
      .values({ mailboxAccountId: id, readinessStatus: 'failed', errorCode: 'RateLimitError' });
    await backdateUpdatedAt(id, FRESH);

    expect(await run()).toEqual([]);
  });

  it('flags a needs_reconnect mailbox — a revoked grant unresolved since before the grace window', async () => {
    const id = await seedMailbox('stale-reconnect@example.com');
    await db.insert(providerSyncState).values({
      mailboxAccountId: id,
      readinessStatus: 'ready',
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: STALE,
      lastSyncedAt: new Date(STALE.getTime() - 60_000),
    });

    const result = await run();

    expect(result).toEqual([
      {
        mailboxAccountId: id,
        reason: 'needs_reconnect',
        errorCode: 'InvalidGrantError',
        stuckSince: STALE,
      },
    ]);
  });

  it('does NOT flag a revoked grant still inside the grace window', async () => {
    const id = await seedMailbox('fresh-reconnect@example.com');
    await db.insert(providerSyncState).values({
      mailboxAccountId: id,
      readinessStatus: 'ready',
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: FRESH,
      lastSyncedAt: new Date(FRESH.getTime() - 60_000),
    });

    expect(await run()).toEqual([]);
  });

  it('does NOT flag a mailbox that reconnected after the recorded error, even if the error is old', async () => {
    const id = await seedMailbox('recovered@example.com');
    await db.insert(providerSyncState).values({
      mailboxAccountId: id,
      readinessStatus: 'ready',
      lastIncrementalErrorCode: 'InvalidGrantError',
      lastIncrementalErrorAt: STALE,
      // Synced AFTER the error — the grant was fixed.
      lastSyncedAt: new Date(STALE.getTime() + 60_000),
    });

    expect(await run()).toEqual([]);
  });

  it('flags an unresolved non-auth incremental error without asking for reconnect', async () => {
    const id = await seedMailbox('other-error@example.com');
    await db.insert(providerSyncState).values({
      mailboxAccountId: id,
      readinessStatus: 'ready',
      lastIncrementalErrorCode: 'RateLimitError',
      lastIncrementalErrorAt: STALE,
      lastSyncedAt: null,
    });

    expect(await run()).toEqual([
      expect.objectContaining({ reason: 'incremental_failed', errorCode: 'RateLimitError' }),
    ]);
  });

  it('does NOT flag a disconnected mailbox even if its last state matches sync_failed', async () => {
    const id = await seedMailbox('disconnected@example.com', 'disconnected');
    await db
      .insert(providerSyncState)
      .values({ mailboxAccountId: id, readinessStatus: 'failed', errorCode: 'RateLimitError' });
    await backdateUpdatedAt(id, STALE);

    expect(await run()).toEqual([]);
  });

  it('does NOT flag a healthy mailbox', async () => {
    const id = await seedMailbox('healthy@example.com');
    await db.insert(providerSyncState).values({ mailboxAccountId: id, readinessStatus: 'ready' });

    expect(await run()).toEqual([]);
  });
  it.each(['queued', 'syncing'] as const)(
    'flags stale %s but permits recent progress',
    async (readinessStatus) => {
      const id = await seedMailbox('stalled@example.com');
      await db.insert(providerSyncState).values({ mailboxAccountId: id, readinessStatus });
      await backdateUpdatedAt(id, STALE);
      expect(await run()).toEqual([
        expect.objectContaining({ mailboxAccountId: id, reason: 'sync_stalled' }),
      ]);
      await backdateUpdatedAt(id, FRESH);
      expect(await run()).toEqual([]);
    },
  );
});
