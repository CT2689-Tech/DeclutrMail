/**
 * Initial-sync reconciler — the two stuck shapes it must sweep, and the
 * healthy one it must leave alone.
 *
 * The `syncing` half is the regression this file exists for
 * (FOUNDER-FOLLOWUPS 2026-07-08): the sweep used to read
 * `readiness_status='queued'` only, so a row whose BullMQ hash was
 * evicted mid-active wedged the onboarding progress bar forever with
 * nothing to recover it.
 *
 * Real schema via in-process PGlite (the `actions.service.spec.ts`
 * convention); the scheduler is a spy, because what is under test is
 * WHICH rows get routed to it, not BullMQ.
 */

import { mailboxAccounts, providerSyncState, schema, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileInitialSyncs,
  STALE_SYNCING_AFTER_MS,
  type ReconcileOutcome,
} from './initial-sync-reconciler.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-08-22T12:00:00.000Z');
/** Comfortably past the age gate. */
const STALE = new Date(NOW.getTime() - STALE_SYNCING_AFTER_MS - 60_000);
/** Inside the gate — a healthy sync that heartbeated a minute ago. */
const FRESH = new Date(NOW.getTime() - 60_000);

let db: Db;

async function seedMailbox(email: string): Promise<string> {
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
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

/**
 * Seed one sync row at a chosen heartbeat age.
 *
 * `updated_at` cannot simply be written: migration 0001 puts
 * `provider_sync_state_set_updated_at BEFORE UPDATE` on this table, so
 * the trigger stomps any value an UPDATE supplies with `now()`. The
 * first draft of this file did exactly that, and every row came back
 * looking equally stale — the FRESH cases passed for the wrong reason.
 * So the trigger is suspended for the one statement that backdates the
 * row, and restored immediately.
 */
async function seedSyncState(
  email: string,
  readinessStatus: 'queued' | 'syncing' | 'ready' | 'failed',
  updatedAt: Date,
): Promise<string> {
  const mailboxAccountId = await seedMailbox(email);
  await db.insert(providerSyncState).values({ mailboxAccountId, readinessStatus });
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
  return mailboxAccountId;
}

function run(
  schedule: (id: string) => Promise<'added' | 'replaced' | 'noop'>,
  isShuttingDown = () => false,
): Promise<ReconcileOutcome> {
  return reconcileInitialSyncs({
    db: db as never,
    schedule,
    isShuttingDown,
    now: () => NOW,
  });
}

beforeEach(async () => {
  db = await freshTestDb();
});

describe('reconcileInitialSyncs', () => {
  it('sweeps a `syncing` row whose heartbeat went stale', async () => {
    const stuck = await seedSyncState('stuck@x.test', 'syncing', STALE);
    const schedule = vi.fn().mockResolvedValue('added');

    const outcome = await run(schedule);

    // The regression: with the old `queued`-only sweep this row was
    // never read, and the onboarding bar wedged forever.
    expect(schedule).toHaveBeenCalledWith(stuck);
    expect(outcome.staleSyncing).toBe(1);
    expect(outcome.added).toBe(1);
  });

  it('leaves a `syncing` row that is still heartbeating alone', async () => {
    await seedSyncState('healthy@x.test', 'syncing', FRESH);
    const schedule = vi.fn().mockResolvedValue('added');

    const outcome = await run(schedule);

    // `syncing` is also the NORMAL state of a running sync. Sweeping on
    // status alone would re-enqueue every healthy in-flight sync once a
    // minute; the heartbeat age is the whole discriminator.
    expect(schedule).not.toHaveBeenCalled();
    expect(outcome.scanned).toBe(0);
  });

  it('still sweeps `queued` rows, regardless of age', async () => {
    // The pre-existing behaviour: a `queued` row means the enqueue was
    // lost at connect time, so there is nothing to wait for and no age
    // gate applies.
    const fresh = await seedSyncState('queued@x.test', 'queued', FRESH);
    const schedule = vi.fn().mockResolvedValue('added');

    const outcome = await run(schedule);

    expect(schedule).toHaveBeenCalledWith(fresh);
    expect(outcome.staleSyncing).toBe(0);
    expect(outcome.added).toBe(1);
  });

  it('ignores terminal rows however stale they are', async () => {
    await seedSyncState('done@x.test', 'ready', STALE);
    await seedSyncState('dead@x.test', 'failed', STALE);
    const schedule = vi.fn().mockResolvedValue('added');

    const outcome = await run(schedule);

    // `failed` is where a genuinely poisoned sync terminates. Sweeping
    // it would be an infinite retry loop wearing a reconciler costume.
    expect(schedule).not.toHaveBeenCalled();
    expect(outcome.scanned).toBe(0);
  });

  it('counts a no-op schedule without claiming it did anything', async () => {
    await seedSyncState('active@x.test', 'syncing', STALE);
    // What `ensureInitialSyncJob` returns when the job is genuinely
    // `active`: the row looks stale to us, the job is fine, leave it.
    const schedule = vi.fn().mockResolvedValue('noop');

    const outcome = await run(schedule);

    expect(schedule).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ added: 0, replaced: 0, scanned: 1 });
  });

  it('stops mid-sweep when a shutdown is signalled', async () => {
    await seedSyncState('a@x.test', 'queued', FRESH);
    await seedSyncState('b@x.test', 'queued', FRESH);
    await seedSyncState('c@x.test', 'queued', FRESH);
    const schedule = vi.fn().mockResolvedValue('added');
    let calls = 0;

    const outcome = await run(schedule, () => {
      calls += 1;
      // Shut down before the second row is scheduled.
      return calls > 1;
    });

    expect(schedule).toHaveBeenCalledOnce();
    expect(outcome.added).toBe(1);
  });

  it('sweeps both shapes in one tick', async () => {
    const queued = await seedSyncState('q@x.test', 'queued', FRESH);
    const stuck = await seedSyncState('s@x.test', 'syncing', STALE);
    await seedSyncState('ok@x.test', 'syncing', FRESH);
    const schedule = vi.fn().mockResolvedValue('added');

    const outcome = await run(schedule);

    expect(schedule.mock.calls.map(([id]) => id as string).sort()).toEqual([queued, stuck].sort());
    expect(outcome).toMatchObject({ scanned: 2, staleSyncing: 1, added: 2 });
  });
});
