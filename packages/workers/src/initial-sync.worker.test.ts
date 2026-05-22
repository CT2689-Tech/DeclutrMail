import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, mailMessages, schema, senders, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { InitialSyncWorker } from './initial-sync.worker.js';
import type { InitialSyncDeps } from './initial-sync.worker.js';
import type { GmailAccess, GmailMessageListPage, GmailMessageMetadata } from './ports.js';
import { deriveSenderKey } from './sender-key.js';
import type { WorkerContext } from './worker-context.js';

/**
 * InitialSyncWorker integration tests (D5, D157, D224, D9, ADR-0004).
 *
 * Runs the real worker against an in-process PGlite database (the schema
 * applied from `packages/db/migrations`) and a fake Gmail client. Covers
 * resume + aggregation (the sync-hardening PR) AND outbound exclusion +
 * unsubscribe capture + historyId snapshot (the data-capture PR per
 * ADR-0004) — the logic whose earlier absence is recorded in
 * MISTAKES.md 2026-05-22.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

/** A fresh PGlite database with every migration applied. */
async function freshDb(): Promise<InitialSyncDeps['db']> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  // PGlite + postgres-js share drizzle's query builder; the cast lets the
  // worker (typed for the postgres-js driver) run against PGlite in-test.
  return drizzle(pg, { schema }) as unknown as InitialSyncDeps['db'];
}

/** Seed a workspace + user + mailbox account; return the mailbox id. */
async function seedMailbox(db: InitialSyncDeps['db']): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'Test WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@declutrmail.ai' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@declutrmail.ai',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

/** Synthetic Gmail metadata — `count` messages across `senderCount` senders. */
function makeMessages(count: number, senderCount: number): GmailMessageMetadata[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    threadId: `thread-${i}`,
    labelIds: i % 3 === 0 ? ['INBOX', 'UNREAD'] : ['INBOX', 'CATEGORY_PROMOTIONS'],
    snippet: `snippet ${i}`,
    internalDate: String(base + i * 86_400_000),
    from: `Sender ${i % senderCount} <sender${i % senderCount}@example.com>`,
    subject: `Subject ${i}`,
    to: null,
    cc: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
  }));
}

/** Fake Gmail client — pages a fixed message set and counts every call. */
class FakeGmailClient {
  listCalls = 0;
  getCalls = 0;
  profileCalls = 0;
  private readonly pageSize = 25;

  constructor(
    private readonly messages: GmailMessageMetadata[],
    private readonly historyId = '987654',
  ) {}

  async listMessageIds(pageToken?: string): Promise<GmailMessageListPage> {
    this.listCalls += 1;
    const start = pageToken ? Number(pageToken) : 0;
    const ids = this.messages.slice(start, start + this.pageSize).map((m) => m.id);
    const next = start + this.pageSize;
    return next < this.messages.length ? { ids, nextPageToken: String(next) } : { ids };
  }

  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata | null> {
    this.getCalls += 1;
    return this.messages.find((m) => m.id === messageId) ?? null;
  }

  async getProfile(): Promise<{ historyId: string }> {
    this.profileCalls += 1;
    return { historyId: this.historyId };
  }
}

/** A `GmailAccess` that always hands back the given fake client. */
function accessFor(client: FakeGmailClient): GmailAccess {
  return { getClient: async () => client };
}

const CTX: WorkerContext = {
  jobId: 'test-job',
  workerName: 'InitialSyncWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('InitialSyncWorker', () => {
  let db: InitialSyncDeps['db'];
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxAccountId = await seedMailbox(db);
  });

  it('fresh sync — mirrors every message and materializes senders', async () => {
    const client = new FakeGmailClient(makeMessages(30, 6));
    const worker = new InitialSyncWorker({ db, gmailAccess: accessFor(client) });

    const result = await worker.processJob({ mailboxAccountId }, CTX);

    expect(result.messagesSynced).toBe(30);
    expect(result.sendersIndexed).toBe(6);
    expect((await db.select().from(mailMessages)).length).toBe(30);
    expect((await db.select().from(senders)).length).toBe(6);
    expect(client.getCalls).toBe(30); // every message fetched once

    const [state] = await db
      .select()
      .from(schema.providerSyncState)
      .where(eq(schema.providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.readinessStatus).toBe('ready');
    expect(state!.progressPct).toBe(100);
  });

  it('resume — a second run re-fetches only the messages not already stored', async () => {
    const first = new FakeGmailClient(makeMessages(30, 6));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(first) }).processJob(
      { mailboxAccountId },
      CTX,
    );

    const second = new FakeGmailClient(makeMessages(45, 6));
    const result = await new InitialSyncWorker({
      db,
      gmailAccess: accessFor(second),
    }).processJob({ mailboxAccountId }, CTX);

    expect(result.messagesSynced).toBe(45);
    expect(second.getCalls).toBe(15); // only the 15 new — 30 skipped on resume
    expect((await db.select().from(mailMessages)).length).toBe(45);
  });

  it('orphan heal — a stored message lacking sender identity is re-fetched, not dropped', async () => {
    const orphanMsg = makeMessages(1, 1)[0]!;
    orphanMsg.id = 'orphan-msg';
    orphanMsg.from = 'Orphan <orphan@example.com>';
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: orphanMsg.id,
      providerThreadId: orphanMsg.threadId,
      senderKey: deriveSenderKey('orphan@example.com'),
      internalDate: new Date(Number(orphanMsg.internalDate)),
      isUnread: false,
    });

    const fresh = makeMessages(10, 3);
    const client = new FakeGmailClient([orphanMsg, ...fresh]);
    const result = await new InitialSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId }, CTX);

    expect(client.getCalls).toBe(11);
    const senderRows = await db.select().from(senders);
    expect(senderRows.some((s) => s.senderKey === deriveSenderKey('orphan@example.com'))).toBe(
      true,
    );
    const messageRows = await db.select().from(mailMessages);
    const senderKeys = new Set(senderRows.map((s) => s.senderKey));
    expect(messageRows.every((m) => senderKeys.has(m.senderKey))).toBe(true);
    expect(result.messagesSynced).toBe(11);
  });

  it('outbound exclusion — SENT messages land in mail_messages but never index a sender', async () => {
    // 5 inbound messages (3 distinct senders) + 4 outbound (user → 4 recipients).
    const inbound = makeMessages(5, 3);
    const outbound: GmailMessageMetadata[] = Array.from({ length: 4 }, (_, i) => ({
      id: `sent-${i}`,
      threadId: `thread-sent-${i}`,
      labelIds: ['SENT', 'INBOX'], // INBOX too — Gmail allows multi-label
      snippet: `sent snippet ${i}`,
      internalDate: String(Date.UTC(2026, 1, 1) + i * 86_400_000),
      from: 'Owner <owner@declutrmail.ai>',
      subject: `Sent subject ${i}`,
      to: `Recipient ${i} <recipient${i}@example.com>`,
      cc: i === 0 ? '"Carbon Copy" <cc@example.com>' : null,
      listUnsubscribe: null,
      listUnsubscribePost: null,
    }));
    const client = new FakeGmailClient([...inbound, ...outbound]);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );

    // All 9 messages stored.
    const allMessages = await db.select().from(mailMessages);
    expect(allMessages.length).toBe(9);

    // Only inbound creates senders (3 inbound senders; the user's own
    // address is NOT in senders).
    const senderRows = await db.select().from(senders);
    expect(senderRows.length).toBe(3);
    expect(senderRows.some((s) => s.email === 'owner@declutrmail.ai')).toBe(false);

    // Outbound rows tagged + carry recipients.
    const outboundRows = allMessages.filter((m) => m.isOutbound);
    expect(outboundRows.length).toBe(4);
    expect(outboundRows.every((m) => m.recipientEmails && m.recipientEmails.length > 0)).toBe(true);
    const ccRow = outboundRows.find((m) => m.providerMessageId === 'sent-0');
    expect(ccRow!.recipientEmails).toEqual(
      expect.arrayContaining(['recipient0@example.com', 'cc@example.com']),
    );
  });

  it('historyId — snapshot is persisted to provider_sync_state.last_history_id', async () => {
    const client = new FakeGmailClient(makeMessages(5, 2), '424242');
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    expect(client.profileCalls).toBe(1);
    const [state] = await db
      .select()
      .from(schema.providerSyncState)
      .where(eq(schema.providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastHistoryId).toBe(424242n);
  });

  it('unsubscribe — RFC 8058 one-click sets senders.unsubscribe_method = one_click', async () => {
    const m = makeMessages(2, 1);
    m[0]!.listUnsubscribe = '<https://example.com/unsub>, <mailto:unsub@example.com>';
    m[0]!.listUnsubscribePost = 'List-Unsubscribe=One-Click';
    const client = new FakeGmailClient(m);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const [sender] = await db.select().from(senders);
    expect(sender!.unsubscribeMethod).toBe('one_click');
    expect(sender!.unsubscribeUrl).toBe('https://example.com/unsub');
  });

  it('unsubscribe — mailto-only header sets unsubscribe_method = mailto', async () => {
    const m = makeMessages(2, 1);
    m[0]!.listUnsubscribe = '<mailto:unsub@example.com>';
    // No List-Unsubscribe-Post → not one-click capable.
    const client = new FakeGmailClient(m);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const [sender] = await db.select().from(senders);
    expect(sender!.unsubscribeMethod).toBe('mailto');
    expect(sender!.unsubscribeUrl).toBe('mailto:unsub@example.com');
  });

  it('unsubscribe — no header at all sets unsubscribe_method = none', async () => {
    const client = new FakeGmailClient(makeMessages(3, 1));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const [sender] = await db.select().from(senders);
    expect(sender!.unsubscribeMethod).toBe('none');
    expect(sender!.unsubscribeUrl).toBeNull();
  });
});
