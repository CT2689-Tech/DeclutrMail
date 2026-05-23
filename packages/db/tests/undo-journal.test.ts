import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { activityLog, mailboxAccounts, schema, undoJournal, users, workspaces } from '../src';

/**
 * Undo-journal × activity-log integration test (D35, D58, D232).
 *
 * Verifies the cross-table behaviors that the migration encodes:
 *
 *   1. `activity_log.undo_token` is a real FK — inserting an unknown
 *      token raises a constraint error.
 *   2. `ON DELETE SET NULL` — when the journal row is hard-deleted by
 *      the cleanup worker, the historical activity row outlives it
 *      with `undo_token` nulled. Activity is append-only audit; losing
 *      it would defeat D58.
 *   3. `ON DELETE CASCADE` from mailbox_accounts to undo_journal —
 *      removing a mailbox cleans up its outstanding undo journal rows.
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

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
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
  return mb!.id;
}

describe('undo_journal × activity_log integration', () => {
  it('rejects activity_log.undo_token referencing an unknown journal row', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    await expect(
      db.insert(activityLog).values({
        mailboxAccountId: mbId,
        source: 'triage',
        action: 'archive',
        affectedCount: 1,
        undoToken: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();
  });

  it('hard-deleting the journal row nulls the activity_log.undo_token (audit preserved)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const [token] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
      })
      .returning({ token: undoJournal.token });
    const [activity] = await db
      .insert(activityLog)
      .values({
        mailboxAccountId: mbId,
        source: 'triage',
        action: 'archive',
        affectedCount: 3,
        undoToken: token!.token,
      })
      .returning({ id: activityLog.id });

    // Worker cleanup hard-deletes the journal row.
    await db.delete(undoJournal).where(eq(undoJournal.token, token!.token));

    // Activity row still present, undo_token now null.
    const [afterRow] = await db
      .select({ id: activityLog.id, undoToken: activityLog.undoToken })
      .from(activityLog)
      .where(eq(activityLog.id, activity!.id));
    expect(afterRow).toBeDefined();
    expect(afterRow!.undoToken).toBeNull();
  });

  it('cascades undo_journal deletion when the mailbox row is removed', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    await db.insert(undoJournal).values({
      mailboxAccountId: mbId,
      actionKind: 'archive',
      payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
    });
    await db.insert(undoJournal).values({
      mailboxAccountId: mbId,
      actionKind: 'later',
      payload: { kind: 'later', messageIds: ['m2'], priorLabels: ['INBOX'] },
    });

    await db.delete(mailboxAccounts).where(eq(mailboxAccounts.id, mbId));

    const remaining = await db
      .select({ token: undoJournal.token })
      .from(undoJournal)
      .where(eq(undoJournal.mailboxAccountId, mbId));
    expect(remaining).toHaveLength(0);
  });

  it('default expires_at is roughly now + 7 days (D232 default window)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const before = Date.now();
    const [row] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
      })
      .returning({ expiresAt: undoJournal.expiresAt });
    const after = Date.now();

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiry = row!.expiresAt.getTime();
    expect(expiry - before).toBeGreaterThan(sevenDaysMs - 5_000);
    expect(expiry - after).toBeLessThan(sevenDaysMs + 5_000);
  });
});
