import { mailboxAccounts, mailboxLabels, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { syncMailboxLabels } from './mailbox-label-sync.js';
import type { OutboxTx } from './outbox-publisher.js';
import type { GmailMetadataClient } from './ports.js';

type Db = Awaited<ReturnType<typeof freshTestDb>>;

/** A client that only knows how to list labels — the surface under test. */
function clientListing(labels: { id: string; name: string }[]): GmailMetadataClient {
  return {
    listMessageIds: async () => ({ ids: [] }),
    getMessageMetadata: async () => null,
    getProfile: async () => ({ historyId: '1' }),
    listLabels: async () => labels,
  } as unknown as GmailMetadataClient;
}

/** The pre-0064 shape: a client with no `listLabels` at all. */
function clientWithoutLabels(): GmailMetadataClient {
  return {
    listMessageIds: async () => ({ ids: [] }),
    getMessageMetadata: async () => null,
    getProfile: async () => ({ historyId: '1' }),
  } as unknown as GmailMetadataClient;
}

describe('syncMailboxLabels', () => {
  let db: Db;
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = await freshTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'W' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'owner@example.com' })
      .returning({ id: users.id });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'owner@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxAccountId = mailbox!.id;
  });

  /** The helper takes the caller's transaction; the tests pass the db. */
  const asTx = (): OutboxTx => db as unknown as OutboxTx;

  async function storedLabels() {
    return db
      .select()
      .from(mailboxLabels)
      .where(eq(mailboxLabels.mailboxAccountId, mailboxAccountId));
  }

  it('stores names and flags only the sweeper labels', async () => {
    const result = await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([
        { id: 'INBOX', name: 'INBOX' },
        { id: 'Label_117', name: 'Unroll.me/Unsubscribed' },
        { id: 'Label_9', name: 'Receipts' },
      ]),
    );

    expect(result).toEqual({ total: 3, sweeper: 1, pruned: 0 });
    const rows = await storedLabels();
    expect(rows.find((r) => r.labelId === 'Label_117')?.sweeperVendor).toBe('unroll_me');
    expect(rows.find((r) => r.labelId === 'Label_9')?.sweeperVendor).toBeNull();
    expect(rows.find((r) => r.labelId === 'INBOX')?.name).toBe('INBOX');
  });

  // THE BLIND CASE, TWICE OVER. A missing listing must never be read as
  // "this mailbox has no labels": emptying the table un-excludes the
  // sweeper's marks, which inflates read rate again and pushes its
  // senders back toward looking engaged. Both shapes of "we did not
  // learn anything" are tested before any success path is trusted.
  it('leaves stored labels alone when the client cannot list them', async () => {
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'Label_117', name: 'Unroll.me/Unsubscribed' }]),
    );

    const result = await syncMailboxLabels(asTx(), mailboxAccountId, clientWithoutLabels());

    expect(result).toBeNull();
    expect(await storedLabels()).toHaveLength(1);
  });

  it('leaves stored labels alone on an empty response', async () => {
    // Gmail always returns the system labels, so `[]` is a malformed or
    // failed response — never a mailbox with no labels.
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'Label_117', name: 'Unroll.me/Unsubscribed' }]),
    );

    const result = await syncMailboxLabels(asTx(), mailboxAccountId, clientListing([]));

    expect(result).toBeNull();
    const rows = await storedLabels();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sweeperVendor).toBe('unroll_me');
  });

  it('recomputes the vendor on every pass rather than preserving it', async () => {
    // A write-once column would strand rows on the vendor list as it
    // stood the day they were created, so adding a vendor would apply
    // only to mailboxes connected afterwards. Simulated here by a label
    // being RENAMED out of a sweeper's namespace.
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'Label_117', name: 'Unroll.me/Unsubscribed' }]),
    );
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'Label_117', name: 'Newsletters' }]),
    );

    const rows = await storedLabels();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Newsletters');
    expect(rows[0]!.sweeperVendor).toBeNull();
  });

  it('prunes labels the user deleted in Gmail', async () => {
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([
        { id: 'INBOX', name: 'INBOX' },
        { id: 'Label_117', name: 'Unroll.me/Unsubscribed' },
      ]),
    );

    // A stale sweeper row would keep excluding read state forever on a
    // label id that no longer exists.
    const result = await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'INBOX', name: 'INBOX' }]),
    );

    expect(result).toEqual({ total: 1, sweeper: 0, pruned: 1 });
    expect(await storedLabels()).toHaveLength(1);
  });

  it('never touches another mailbox', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'W2' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'other@example.com' })
      .returning({ id: users.id });
    const [other] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'other@example.com',
      })
      .returning({ id: mailboxAccounts.id });

    await syncMailboxLabels(
      asTx(),
      other!.id,
      clientListing([{ id: 'Label_117', name: 'Unroll.me/Unsubscribed' }]),
    );
    // The same label id means something different in each mailbox, so a
    // prune scoped too widely would delete a live row next door.
    await syncMailboxLabels(
      asTx(),
      mailboxAccountId,
      clientListing([{ id: 'INBOX', name: 'INBOX' }]),
    );

    const otherRows = await db
      .select()
      .from(mailboxLabels)
      .where(and(eq(mailboxLabels.mailboxAccountId, other!.id)));
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0]!.sweeperVendor).toBe('unroll_me');
  });
});
