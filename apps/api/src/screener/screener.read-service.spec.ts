import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  mailMessages,
  schema,
  screenerQuarantine,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { ScreenerReadService } from './screener.read-service.js';

/**
 * ScreenerReadService integration tests (D71–D74).
 *
 * Load-bearing behaviour: ONLY pending quarantine rows surface (a
 * decided row leaves both the queue and the badge count), the row
 * carries the joined sender identity + the engine recommendation +
 * the latest message's subject, and everything is mailbox-scoped.
 * Both sides of each join are seeded with ≥2 rows so a degenerate
 * correlation fails loudly (the Drizzle bare-column pitfall class).
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

/** Seed a sender + two messages (older + newest) + a pending queue row. */
async function seedQueuedSender(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  email: string,
  opts: { withDecision?: boolean; newestSubject?: string } = {},
): Promise<void> {
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    email,
    displayName: email.split('@')[0]!,
    domain: email.split('@')[1]!,
    gmailCategory: 'updates',
    firstSeenAt: new Date('2026-06-09T10:00:00Z'),
    lastSeenAt: new Date('2026-06-10T10:00:00Z'),
    totalReceived: 2,
  });
  await db.insert(mailMessages).values([
    {
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 6)}-old`,
      providerThreadId: 't1',
      senderKey,
      subject: 'Older subject',
      snippet: '',
      internalDate: new Date('2026-06-09T10:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: true,
    },
    {
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 6)}-new`,
      providerThreadId: 't2',
      senderKey,
      subject: opts.newestSubject ?? 'Newest subject',
      snippet: '',
      internalDate: new Date('2026-06-10T10:00:00Z'),
      labelIds: ['INBOX'],
      isUnread: true,
    },
  ]);
  if (opts.withDecision ?? true) {
    await db.insert(triageDecisions).values({
      mailboxAccountId,
      senderKey,
      verdict: 'later',
      confidence: '0.70',
      reasoning: 'Too new to judge.',
      generatedBy: 'template',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
  }
  await db.insert(screenerQuarantine).values({ mailboxAccountId, senderKey });
}

describe('ScreenerReadService (D71–D74)', () => {
  let db: Db;
  let mailboxId: string;
  let svc: ScreenerReadService;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db, 'one');
    await seedQueuedSender(db, mailboxId, SENDER_A, 'alpha@new.example', {
      newestSubject: 'Welcome to Alpha',
    });
    await seedQueuedSender(db, mailboxId, SENDER_B, 'beta@fresh.example', {
      withDecision: false,
      newestSubject: 'Beta receipt',
    });
    svc = new ScreenerReadService(db as never);
  });

  it('lists pending rows with sender identity, latest subject, and recommendation', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    expect(rows.map((r) => r.senderKey).sort()).toEqual([SENDER_A, SENDER_B]);

    const alpha = rows.find((r) => r.senderKey === SENDER_A)!;
    expect(alpha.senderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(alpha.senderEmail).toBe('alpha@new.example');
    expect(alpha.senderDomain).toBe('new.example');
    expect(alpha.messageCount).toBe(2);
    // Latest message wins the sample-subject slot (D71).
    expect(alpha.sampleSubject).toBe('Welcome to Alpha');
    expect(alpha.recommendation).toEqual({
      verdict: 'later',
      confidence: 0.7,
      reasoning: 'Too new to judge.',
    });

    // No decision row yet → recommendation is null, row still renders.
    const beta = rows.find((r) => r.senderKey === SENDER_B)!;
    expect(beta.recommendation).toBeNull();
    expect(beta.sampleSubject).toBe('Beta receipt');
  });

  it('excludes decided rows from the queue and the count', async () => {
    // Only sender A is decided.
    await db
      .update(screenerQuarantine)
      .set({ decidedAt: new Date() })
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, mailboxId),
          eq(screenerQuarantine.senderKey, SENDER_A),
        ),
      );
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 50 });
    expect(rows.map((r) => r.senderKey)).toEqual([SENDER_B]);
    const count = await svc.pendingCount(mailboxId);
    expect(count.pending).toBe(1);
  });

  it('is mailbox-scoped — another mailbox sees nothing', async () => {
    const otherMailbox = await seedMailbox(db, 'two');
    const rows = await svc.listQueue({ mailboxAccountId: otherMailbox, limit: 50 });
    expect(rows).toEqual([]);
    const count = await svc.pendingCount(otherMailbox);
    expect(count.pending).toBe(0);
  });

  it('counts every pending row for the badge (D74)', async () => {
    const count = await svc.pendingCount(mailboxId);
    expect(count.pending).toBe(2);
  });

  it('orders newest-queued first and honours the limit', async () => {
    const rows = await svc.listQueue({ mailboxAccountId: mailboxId, limit: 1 });
    expect(rows).toHaveLength(1);
    // SENDER_B was queued second → newest-first puts it on top.
    expect(rows[0]!.senderKey).toBe(SENDER_B);
  });
});
