import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { followupTracker, mailboxAccounts, schema, users, workspaces } from '../src';

/**
 * Followup tracker integration tests (D84, D85, D87, D88).
 *
 * Verifies the schema-level invariants the migration encodes:
 *
 *   1. UNIQUE `(mailbox_account_id, provider_thread_id)` — the
 *      `FollowupCheckWorker` upsert key. Inserting two rows with the
 *      same `(mailbox, thread)` raises a constraint error.
 *
 *   2. `ON DELETE CASCADE` from mailbox_accounts → followup_tracker —
 *      removing a mailbox cleans up its rows.
 *
 *   3. `ON DELETE CASCADE` from workspaces → followup_tracker — the
 *      denormalized workspace_id chain is intact.
 *
 *   4. Default values match D87 (status='awaiting', last_check_at=now()).
 *
 *   5. `citext` semantics on `recipient_email` — `boss@Example.com` and
 *      `boss@example.com` would collide on the unique index if they
 *      shared a thread, but the unique key is `(mailbox, thread_id)`
 *      not email — so this confirms identity-preservation across
 *      casing without affecting upsert.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(
  db: Awaited<ReturnType<typeof freshDb>>,
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

describe('followup_tracker integration', () => {
  it('UNIQUE blocks duplicate (mailbox, provider_thread_id)', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    const row = {
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-1',
      recipientEmail: 'boss@example.com',
      subject: 'Q4 plans',
      sentAt: new Date('2026-05-20T08:00:00Z'),
    };
    await db.insert(followupTracker).values(row);
    await expect(db.insert(followupTracker).values(row)).rejects.toThrow();
  });

  it('different threads in the same mailbox are independent', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(followupTracker).values([
      {
        workspaceId,
        mailboxAccountId,
        providerThreadId: 'thread-1',
        recipientEmail: 'a@example.com',
        subject: 'A',
        sentAt: new Date('2026-05-20T08:00:00Z'),
      },
      {
        workspaceId,
        mailboxAccountId,
        providerThreadId: 'thread-2',
        recipientEmail: 'b@example.com',
        subject: 'B',
        sentAt: new Date('2026-05-21T08:00:00Z'),
      },
    ]);
    const rows = await db
      .select({ id: followupTracker.id })
      .from(followupTracker)
      .where(eq(followupTracker.mailboxAccountId, mailboxAccountId));
    expect(rows).toHaveLength(2);
  });

  it('defaults match D87 (status=awaiting, last_check_at=now())', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    const before = Date.now();
    const [row] = await db
      .insert(followupTracker)
      .values({
        workspaceId,
        mailboxAccountId,
        providerThreadId: 'thread-1',
        recipientEmail: 'boss@example.com',
        subject: 'subj',
        sentAt: new Date('2026-05-20T08:00:00Z'),
      })
      .returning({
        status: followupTracker.status,
        lastCheckAt: followupTracker.lastCheckAt,
        dismissedAt: followupTracker.dismissedAt,
        recipientDisplayName: followupTracker.recipientDisplayName,
      });
    const after = Date.now();
    expect(row!.status).toBe('awaiting');
    expect(row!.dismissedAt).toBeNull();
    expect(row!.recipientDisplayName).toBe('');
    expect(row!.lastCheckAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(row!.lastCheckAt.getTime()).toBeLessThanOrEqual(after + 1_000);
  });

  it('cascades deletion from mailbox_accounts', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(followupTracker).values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-1',
      recipientEmail: 'boss@example.com',
      subject: 'subj',
      sentAt: new Date('2026-05-20T08:00:00Z'),
    });
    await db.delete(mailboxAccounts).where(eq(mailboxAccounts.id, mailboxAccountId));
    const remaining = await db
      .select({ id: followupTracker.id })
      .from(followupTracker)
      .where(eq(followupTracker.mailboxAccountId, mailboxAccountId));
    expect(remaining).toHaveLength(0);
  });

  it('cascades deletion from workspaces (denormalized workspace_id chain)', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(followupTracker).values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-1',
      recipientEmail: 'boss@example.com',
      subject: 'subj',
      sentAt: new Date('2026-05-20T08:00:00Z'),
    });
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    const remaining = await db
      .select({ id: followupTracker.id })
      .from(followupTracker)
      .where(eq(followupTracker.workspaceId, workspaceId));
    expect(remaining).toHaveLength(0);
  });

  it('recipient_email is citext — case variants are equal under citext comparison', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(followupTracker).values({
      workspaceId,
      mailboxAccountId,
      providerThreadId: 'thread-1',
      recipientEmail: 'Boss@Example.COM',
      subject: 'subj',
      sentAt: new Date('2026-05-20T08:00:00Z'),
    });
    // citext makes the lowercase form match the uppercase-stored form.
    const found = await db
      .select({ id: followupTracker.id })
      .from(followupTracker)
      .where(
        and(
          eq(followupTracker.mailboxAccountId, mailboxAccountId),
          eq(followupTracker.recipientEmail, 'boss@example.com'),
        ),
      );
    expect(found).toHaveLength(1);
  });
});
