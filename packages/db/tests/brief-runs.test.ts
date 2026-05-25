import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { briefRuns, type BriefPayload, mailboxAccounts, schema, users, workspaces } from '../src';

/**
 * Brief runs integration tests (D61, D62, D63, D67, D69).
 *
 * Verifies the schema-level invariants the migration encodes:
 *
 *   1. UNIQUE `(mailbox_account_id, run_date_local)` — D69 "one Brief
 *      per mailbox per local-date". Inserting a duplicate raises a
 *      constraint error.
 *
 *   2. ON DELETE CASCADE from `mailbox_accounts` → `brief_runs`.
 *   3. ON DELETE CASCADE from `workspaces` → `brief_runs`
 *      (denormalized workspace_id chain).
 *
 *   4. `brief_payload` round-trips as typed jsonb — the Drizzle
 *      `$type<BriefPayload>` decoration preserves nested array shapes
 *      (reply / fyi / noise) on insert + select.
 *
 *   5. Default payload is the empty-section template (`reply=[],
 *      fyi=[], noise=[], narrative=''`) — D70 empty-state safe.
 *
 *   6. `opened_at` and `email_sent_at` default NULL — set only by
 *      their respective consumer flows.
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
  email = 'owner@example.com',
): Promise<{ workspaceId: string; mailboxAccountId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${email}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxAccountId: mb!.id };
}

const SAMPLE_PAYLOAD: BriefPayload = {
  reply: [
    {
      senderKey: 'a'.repeat(64),
      senderName: 'Boss',
      senderEmail: 'boss@example.com',
      subject: 'Q4 plans',
      isVip: true,
      messageIds: ['gmail-1', 'gmail-2'],
    },
  ],
  fyi: [
    {
      senderKey: 'b'.repeat(64),
      senderName: 'Bank',
      senderEmail: 'noreply@bank.com',
      subject: 'Statement available',
      isVip: false,
      messageIds: ['gmail-3'],
    },
  ],
  noise: [
    {
      senderKey: 'c'.repeat(64),
      senderName: 'Promo',
      messageCount: 4,
      messageIds: ['gmail-4', 'gmail-5', 'gmail-6', 'gmail-7'],
    },
  ],
  narrative: 'Three emails need replies. Two FYIs. Seven you can archive.',
};

describe('brief_runs integration', () => {
  it('UNIQUE blocks duplicate (mailbox, run_date_local) per D69', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    const row = {
      workspaceId,
      mailboxAccountId,
      runDateLocal: '2026-05-25',
      generatedBy: 'template' as const,
      briefPayload: SAMPLE_PAYLOAD,
    };
    await db.insert(briefRuns).values(row);
    await expect(db.insert(briefRuns).values(row)).rejects.toThrow();
  });

  it('two different local-dates for the same mailbox coexist', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(briefRuns).values([
      {
        workspaceId,
        mailboxAccountId,
        runDateLocal: '2026-05-24',
        generatedBy: 'template',
        briefPayload: SAMPLE_PAYLOAD,
      },
      {
        workspaceId,
        mailboxAccountId,
        runDateLocal: '2026-05-25',
        generatedBy: 'llm_haiku',
        briefPayload: SAMPLE_PAYLOAD,
      },
    ]);
    const rows = await db
      .select({ runDateLocal: briefRuns.runDateLocal })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(rows).toHaveLength(2);
  });

  it('jsonb payload round-trips with typed shape', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(briefRuns).values({
      workspaceId,
      mailboxAccountId,
      runDateLocal: '2026-05-25',
      generatedBy: 'llm_haiku',
      briefPayload: SAMPLE_PAYLOAD,
    });
    const [row] = await db
      .select({ briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          eq(briefRuns.runDateLocal, '2026-05-25'),
        ),
      );
    expect(row!.briefPayload).toEqual(SAMPLE_PAYLOAD);
    // Drizzle preserves the typed shape on select.
    expect(row!.briefPayload.reply[0]!.isVip).toBe(true);
    expect(row!.briefPayload.noise[0]!.messageCount).toBe(4);
  });

  it('default payload is the empty-section template (D70 empty-state safe)', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    const [row] = await db
      .insert(briefRuns)
      .values({
        workspaceId,
        mailboxAccountId,
        runDateLocal: '2026-05-25',
        generatedBy: 'template',
      })
      .returning({ briefPayload: briefRuns.briefPayload });
    expect(row!.briefPayload).toEqual({
      reply: [],
      fyi: [],
      noise: [],
      narrative: '',
    });
  });

  it('opened_at and email_sent_at default NULL', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    const [row] = await db
      .insert(briefRuns)
      .values({
        workspaceId,
        mailboxAccountId,
        runDateLocal: '2026-05-25',
        generatedBy: 'template',
        briefPayload: SAMPLE_PAYLOAD,
      })
      .returning({ openedAt: briefRuns.openedAt, emailSentAt: briefRuns.emailSentAt });
    expect(row!.openedAt).toBeNull();
    expect(row!.emailSentAt).toBeNull();
  });

  it('cascades deletion from mailbox_accounts', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(briefRuns).values({
      workspaceId,
      mailboxAccountId,
      runDateLocal: '2026-05-25',
      generatedBy: 'template',
      briefPayload: SAMPLE_PAYLOAD,
    });
    await db.delete(mailboxAccounts).where(eq(mailboxAccounts.id, mailboxAccountId));
    const remaining = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(eq(briefRuns.mailboxAccountId, mailboxAccountId));
    expect(remaining).toHaveLength(0);
  });

  it('cascades deletion from workspaces (denormalized workspace_id chain)', async () => {
    const db = await freshDb();
    const { workspaceId, mailboxAccountId } = await seedMailbox(db);
    await db.insert(briefRuns).values({
      workspaceId,
      mailboxAccountId,
      runDateLocal: '2026-05-25',
      generatedBy: 'template',
      briefPayload: SAMPLE_PAYLOAD,
    });
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    const remaining = await db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(eq(briefRuns.workspaceId, workspaceId));
    expect(remaining).toHaveLength(0);
  });
});
