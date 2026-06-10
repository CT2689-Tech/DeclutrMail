import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  activityLog,
  mailboxAccounts,
  schema,
  senders,
  triageDecisions,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { TriageReadService } from './triage.read-service.js';

/**
 * TriageReadService.listQueue integration tests (D29, D30, D226).
 *
 * The load-bearing behaviour: a sender the user has DECIDED on (a
 * K/A/U/L/D activity_log row within the D30 7-day window, whose undo
 * has not been reverted) leaves the queue — and ONLY then. That
 * exclusion is what makes "row leaves the queue on server
 * confirmation" true end-to-end: the FE refetches after the worker /
 * intent endpoint commits, and the refetch drops the row.
 *
 * Both sides of the correlated NOT EXISTS are seeded with ≥2 rows
 * (two senders, two decisions, activity rows across mailboxes) so a
 * silently-degenerate correlation (the Drizzle bare-column pitfall)
 * fails these assertions instead of passing vacuously.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_A = 'a'.repeat(64);
const SENDER_B = 'b'.repeat(64);

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Db, tag: string): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${tag}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${tag}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${tag}@x`,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSenderWithDecision(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    email,
    domain: email.split('@')[1]!,
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-06-01'),
  });
  await db.insert(triageDecisions).values({
    mailboxAccountId,
    senderKey,
    verdict: 'archive',
    confidence: '0.90',
    reasoning: 'High volume, never read.',
    generatedBy: 'template',
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
}

/** A Date N days before now. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe('TriageReadService.listQueue — decided-sender exclusion (D30/D226)', () => {
  let db: Db;
  let mailboxId: string;
  let svc: TriageReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'one');
    await seedSenderWithDecision(db, mailboxId, SENDER_A, 'a@shop.example');
    await seedSenderWithDecision(db, mailboxId, SENDER_B, 'b@news.example');
    svc = new TriageReadService(db as never);
  });

  it('returns every engine decision (with senderId) when nothing is decided', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
    // senderId is the senders.id uuid — the POST /api/actions selector.
    for (const row of rows) {
      expect(row.senderId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('excludes a sender with a fresh Keep decision row (intent endpoints)', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_B]);
  });

  it('excludes a sender with a fresh worker-confirmed Archive row (undo not reverted)', async () => {
    const [journal] = await db
      .insert(undoJournal)
      .values({ mailboxAccountId: mailboxId, actionKind: 'archive', payload: { messageIds: [] } })
      .returning({ token: undoJournal.token });
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_B,
      source: 'manual',
      action: 'archive',
      affectedCount: 3,
      undoToken: journal!.token,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_A]);
  });

  it('returns the sender to the queue once its undo is reverted (changed mind)', async () => {
    const [journal] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { messageIds: [] },
        revertedAt: new Date(),
      })
      .returning({ token: undoJournal.token });
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_B,
      source: 'manual',
      action: 'archive',
      affectedCount: 3,
      undoToken: journal!.token,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it('a decision older than the 7-day window no longer excludes (D30 re-surface)', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
      occurredAt: daysAgo(8),
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it("another mailbox's decisions never leak into this queue's exclusion", async () => {
    const otherMailbox = await seedMailbox(db, 'two');
    await seedSenderWithDecision(db, otherMailbox, SENDER_A, 'a@shop.example');
    // The OTHER mailbox decided on the same sender_key.
    await db.insert(activityLog).values({
      mailboxAccountId: otherMailbox,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'keep',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });

  it('a non-K/A/U/L/D bookkeeping action (followup-dismiss) does not exclude', async () => {
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_A,
      source: 'manual',
      action: 'followup-dismiss',
      affectedCount: 0,
      undoToken: null,
    });
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 12 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);
  });
});
