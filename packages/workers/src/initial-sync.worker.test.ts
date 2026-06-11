import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  mailMessages,
  outboxEvents,
  providerSyncState,
  schema,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { TOPICS } from '@declutrmail/events';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InitialSyncWorker } from './initial-sync.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
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

  // `listHistory` belongs to `GmailMetadataClient` (D8 incremental sync);
  // initial-sync never invokes it, so the stub returns `null` (the same
  // signal the real adapter emits on a 404 — "cursor too old").
  // IncrementalSyncWorker tests use their own fake.
  async listHistory(): Promise<null> {
    return null;
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

  it("first_seen_at / last_seen_at span every sender's actual MIN / MAX internal_date (regression: 2026-06-09 prod data integrity bug)", async () => {
    // Prod sync 2026-06-09 produced senders.last_seen_at = first_seen_at
    // for 99.94% of senders despite each sender having multiple unique
    // internal_dates in mail_messages. Root cause was not isolated; the
    // initial-sync rebuild now runs a SQL post-pass that recomputes
    // first/last from the canonical mail_messages aggregation. This
    // test guards the post-pass.
    //
    // Seed 3 senders × 5 messages each across 5 different days. After
    // the rebuild every sender's first_seen_at MUST equal the earliest
    // of its messages and last_seen_at MUST equal the latest.
    const senderCount = 3;
    const msgsPerSender = 5;
    const dayMs = 86_400_000;
    const baseUtc = Date.UTC(2026, 4, 1); // 2026-05-01 UTC
    const messages: GmailMessageMetadata[] = [];
    for (let i = 0; i < senderCount * msgsPerSender; i += 1) {
      const senderIdx = i % senderCount;
      const dayIdx = Math.floor(i / senderCount); // 0..4
      messages.push({
        id: `regress-${i}`,
        threadId: `regress-thread-${i}`,
        labelIds: ['INBOX'],
        snippet: `snippet ${i}`,
        internalDate: String(baseUtc + dayIdx * dayMs),
        from: `Sender ${senderIdx} <s${senderIdx}@regress.test>`,
        subject: `subj ${i}`,
        to: null,
        cc: null,
        listUnsubscribe: null,
        listUnsubscribePost: null,
      });
    }

    const client = new FakeGmailClient(messages);
    const worker = new InitialSyncWorker({ db, gmailAccess: accessFor(client) });
    await worker.processJob({ mailboxAccountId }, CTX);

    const rows = await db
      .select({
        email: senders.email,
        first: senders.firstSeenAt,
        last: senders.lastSeenAt,
        total: senders.totalReceived,
      })
      .from(senders);

    expect(rows.length).toBe(senderCount);
    const expectedFirst = new Date(baseUtc).getTime();
    const expectedLast = new Date(baseUtc + (msgsPerSender - 1) * dayMs).getTime();
    for (const row of rows) {
      // SQL post-pass guarantees: first = MIN(internal_date), last = MAX(internal_date).
      expect(row.first.getTime()).toBe(expectedFirst);
      expect(row.last.getTime()).toBe(expectedLast);
      expect(row.total).toBe(msgsPerSender);
      // The actual prod bug: last_seen_at silently collapsed to first_seen_at.
      // Pin the discriminator so a regression fails this assertion FIRST.
      expect(row.last.getTime()).not.toBe(row.first.getTime());
    }
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

  it('sync_complete trigger — fires onSenderIndexBuilt once with the mailbox id (D25)', async () => {
    const client = new FakeGmailClient(makeMessages(12, 3));
    const fired: string[] = [];
    const worker = new InitialSyncWorker({
      db,
      gmailAccess: accessFor(client),
      onSenderIndexBuilt: async (id) => {
        fired.push(id);
      },
    });

    const result = await worker.processJob({ mailboxAccountId }, CTX);

    expect(result.sendersIndexed).toBe(3);
    // The score sweep is triggered exactly once, after the index built.
    expect(fired).toEqual([mailboxAccountId]);
  });

  it('sync_complete trigger — a score-enqueue failure does NOT fail the sync (best-effort)', async () => {
    const client = new FakeGmailClient(makeMessages(12, 3));
    const worker = new InitialSyncWorker({
      db,
      gmailAccess: accessFor(client),
      onSenderIndexBuilt: async () => {
        throw new Error('redis down');
      },
    });

    const result = await worker.processJob({ mailboxAccountId }, CTX);
    expect(result.sendersIndexed).toBe(3);
    const [state] = await db
      .select()
      .from(schema.providerSyncState)
      .where(eq(schema.providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.readinessStatus).toBe('ready');
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

  it('total_received — Path A writes inbound count per sender + outbound excluded (ADR-0014)', async () => {
    // 30 inbound messages spread across 6 senders → 5 per sender.
    // 4 outbound messages must NOT contribute to any inbound counter
    // (they have no sender row, but the assertion guards against a
    // future bug where an outbound row is mis-attributed inbound).
    const inbound = makeMessages(30, 6);
    const outbound: GmailMessageMetadata[] = Array.from({ length: 4 }, (_, i) => ({
      id: `sent-${i}`,
      threadId: `thread-sent-${i}`,
      labelIds: ['SENT', 'INBOX'],
      snippet: `sent ${i}`,
      internalDate: String(Date.UTC(2026, 1, 1) + i * 86_400_000),
      from: 'Owner <owner@declutrmail.ai>',
      subject: `Sent ${i}`,
      to: `r${i}@example.com`,
      cc: null,
      listUnsubscribe: null,
      listUnsubscribePost: null,
    }));
    const client = new FakeGmailClient([...inbound, ...outbound]);

    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );

    const senderRows = await db.select().from(senders);
    expect(senderRows.length).toBe(6);
    expect(senderRows.every((s) => s.totalReceived === 5)).toBe(true);
  });

  it('total_received — rebuild restores authoritative count after a deliberately-skewed value', async () => {
    // ADR-0014 §"Reconciliation & drift": the full rebuild IS the
    // authoritative reconciliation — whatever drift Path B accumulated
    // between rebuilds is closed atomically by the delete+reinsert
    // transaction. Simulate that by manually skewing the counter, then
    // re-running the worker (which re-runs `buildSenderIndex` over the
    // same persisted `mail_messages`) and asserting the value is reset.
    const client = new FakeGmailClient(makeMessages(12, 3));
    const worker = new InitialSyncWorker({ db, gmailAccess: accessFor(client) });

    await worker.processJob({ mailboxAccountId }, CTX);

    const before = await db.select().from(senders);
    expect(before.length).toBe(3);
    expect(before.every((s) => s.totalReceived === 4)).toBe(true);

    // Skew every counter to a wildly wrong value. A real drift would
    // only be off by a few; the test uses a large delta so a stale
    // assertion can't pass by coincidence.
    await db
      .update(senders)
      .set({ totalReceived: 9999 })
      .where(eq(senders.mailboxAccountId, mailboxAccountId));

    // Re-run the worker. With every Gmail message already stored, the
    // fetch loop is a no-op; `buildSenderIndex` still re-aggregates
    // from the persisted `mail_messages` and the rebuild txn rewrites
    // every senders row.
    await worker.processJob({ mailboxAccountId }, CTX);

    const after = await db.select().from(senders);
    expect(after.length).toBe(3);
    expect(after.every((s) => s.totalReceived === 4)).toBe(true);
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

  it('D6 sync gate — writes D224 stage sequence + monotonic progress + final ready', async () => {
    // D6 strict gate consumers (useSyncStatus hook + action guards) read
    // (current_stage, readiness_status, progress_pct) from this row. This
    // pins the contract the gate depends on: stages emit in D224's
    // declared order, progress is monotonic non-decreasing, and the run
    // settles on (ready, ready, 100). Drift here = gate misreports.
    type StageWrite = { stage: string; readiness: string; progressPct: number };
    const writes: StageWrite[] = [];

    // Spy the two private writers — `upsertSyncState` (stages 1-4) and
    // `markReady` (terminal). Capture the originals first, then have the
    // spies record + delegate. The proto is typed as `Record<string,
    // unknown>` (not `any`) so eslint's no-explicit-any rule stays happy
    // while keeping the access to the private surface.
    const proto = InitialSyncWorker.prototype as unknown as Record<
      string,
      (this: InitialSyncWorker, ...args: unknown[]) => Promise<void>
    >;
    const originalUpsert = proto.upsertSyncState!;
    const originalMarkReady = proto.markReady!;

    const upsertSpy = vi.spyOn(proto, 'upsertSyncState').mockImplementation(async function (
      this: InitialSyncWorker,
      ...args: unknown[]
    ): Promise<void> {
      const [, stage, progressPct, readiness] = args as [string, string, number, string];
      writes.push({ stage, readiness, progressPct });
      return originalUpsert.apply(this, args);
    });

    const markReadySpy = vi.spyOn(proto, 'markReady').mockImplementation(async function (
      this: InitialSyncWorker,
      ...args: unknown[]
    ): Promise<void> {
      writes.push({ stage: 'ready', readiness: 'ready', progressPct: 100 });
      return originalMarkReady.apply(this, args);
    });

    try {
      const client = new FakeGmailClient(makeMessages(10, 3));
      await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
        { mailboxAccountId },
        CTX,
      );

      // 1. Exact D224 sequence, in order.
      expect(writes.map((w) => w.stage)).toEqual([
        'fetching_metadata',
        'building_sender_index',
        'computing_recommendations',
        'finalizing',
        'ready',
      ]);

      // 2. Readiness is `syncing` until the terminal `ready` write.
      expect(writes.slice(0, -1).every((w) => w.readiness === 'syncing')).toBe(true);
      expect(writes.at(-1)!.readiness).toBe('ready');

      // 3. Progress is monotonic non-decreasing and lands on 100.
      const pcts = writes.map((w) => w.progressPct);
      for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]!);
      expect(pcts.at(-1)).toBe(100);

      // 4. Persisted row matches the terminal write — the gate reads this row.
      const [state] = await db
        .select()
        .from(schema.providerSyncState)
        .where(eq(schema.providerSyncState.mailboxAccountId, mailboxAccountId));
      expect(state!.currentStage).toBe('ready');
      expect(state!.readinessStatus).toBe('ready');
      expect(state!.progressPct).toBe(100);
    } finally {
      upsertSpy.mockRestore();
      markReadySpy.mockRestore();
    }
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

  it('unsubscribe — plain HTTPS (no one-click, no mailto) is NOT classified as mailto (Codex iter 5)', async () => {
    // The iter 5 bug: a `List-Unsubscribe: <https://...>` header
    // without `List-Unsubscribe-Post: List-Unsubscribe=One-Click` was
    // previously persisted as `unsubscribe_method='mailto'` with an
    // `https://` URL — a scheme/method mismatch. Option B: surface no
    // actionable method until the product supports HTTPS-link
    // unsubscribe (D230 keeps mailto manual at launch; HTTPS-link
    // executor is its own PR).
    const m = makeMessages(2, 1);
    m[0]!.listUnsubscribe = '<https://example.com/unsub>';
    m[0]!.listUnsubscribePost = null;
    const client = new FakeGmailClient(m);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const [sender] = await db.select().from(senders);
    expect(sender!.unsubscribeMethod).toBe('none');
    expect(sender!.unsubscribeUrl).toBeNull();
    // The per-message HTTPS URL is still captured for the future
    // executor PR — no re-sync needed when it lands. Select msg-0
    // explicitly (storage order across rows isn't guaranteed).
    const msgRows = await db.select().from(mailMessages);
    const msg = msgRows.find((r) => r.providerMessageId === 'msg-0');
    expect(msg!.unsubscribeUrl).toBe('https://example.com/unsub');
    expect(msg!.unsubscribeMailtoUrl).toBeNull();
    expect(msg!.unsubscribeOneClick).toBe(false);
  });

  it('unsubscribe — HTTPS + mailto without one-click prefers mailto at sender level', async () => {
    // Both channels present but no RFC 8058 post header → sender's
    // actionable method is `mailto` (D230 — mailto unsubscribe at
    // launch). HTTPS still captured per message for the future
    // executor.
    const m = makeMessages(2, 1);
    m[0]!.listUnsubscribe = '<https://example.com/unsub>, <mailto:unsub@example.com>';
    m[0]!.listUnsubscribePost = null;
    const client = new FakeGmailClient(m);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const [sender] = await db.select().from(senders);
    expect(sender!.unsubscribeMethod).toBe('mailto');
    expect(sender!.unsubscribeUrl).toBe('mailto:unsub@example.com');
    const msgRows = await db.select().from(mailMessages);
    const msg = msgRows.find((r) => r.providerMessageId === 'msg-0');
    expect(msg!.unsubscribeUrl).toBe('https://example.com/unsub');
    expect(msg!.unsubscribeMailtoUrl).toBe('mailto:unsub@example.com');
  });

  it('reconciliation — stored messages no longer in Gmail are deleted', async () => {
    // First sync stores 10 messages from 5 senders.
    const first = new FakeGmailClient(makeMessages(10, 5));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(first) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    expect((await db.select().from(mailMessages)).length).toBe(10);

    // Second sync sees only 7 of the 10 (3 deleted from Gmail).
    const second = new FakeGmailClient(makeMessages(10, 5).slice(0, 7));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(second) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    // The 3 deleted-from-Gmail rows are reconciled out of mail_messages.
    const remaining = await db.select().from(mailMessages);
    expect(remaining.length).toBe(7);
    expect(remaining.every((m) => Number(m.providerMessageId.split('-')[1]) < 7)).toBe(true);
    // No re-fetches of the 7 survivors (resume cursor still works).
    expect(second.getCalls).toBe(0);
  });

  it('atomicity — a thrown error inside the rebuild transaction rolls back the delete', async () => {
    // Seed 3 senders by running a fresh sync.
    const client = new FakeGmailClient(makeMessages(3, 3));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    expect((await db.select().from(senders)).length).toBe(3);

    // `buildSenderIndex` wraps delete + upsert in one `db.transaction()`.
    // Verify the underlying guarantee: a throw inside the transaction
    // reverts the delete. This is exactly the failure path Codex
    // adversarial review 2026-05-22 asked us to cover.
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(senders).where(eq(senders.mailboxAccountId, mailboxAccountId));
        throw new Error('simulated rebuild failure');
      }),
    ).rejects.toThrow('simulated rebuild failure');
    expect((await db.select().from(senders)).length).toBe(3);
  });

  it('reconciliation — stale sender_timeseries months are removed for surviving senders', async () => {
    // Codex iter 3 regression: surviving sender loses a month's worth of
    // messages → that (senderKey, yearMonth) row must be deleted from
    // sender_timeseries. Previously the selective NOT-IN delete only
    // removed rows for non-surviving senders, leaving stale months for
    // survivors → permanently inflated historical volume/read counts.
    const month1 = (id: string, day: number): GmailMessageMetadata => ({
      id,
      threadId: `t-${id}`,
      labelIds: ['INBOX'],
      snippet: '',
      internalDate: String(Date.UTC(2026, 0, day)), // January 2026
      from: 'A <a@example.com>',
      subject: 's',
      to: null,
      cc: null,
      listUnsubscribe: null,
      listUnsubscribePost: null,
    });
    const month2 = (id: string, day: number): GmailMessageMetadata => ({
      id,
      threadId: `t-${id}`,
      labelIds: ['INBOX'],
      snippet: '',
      internalDate: String(Date.UTC(2026, 1, day)), // February 2026
      from: 'A <a@example.com>',
      subject: 's',
      to: null,
      cc: null,
      listUnsubscribe: null,
      listUnsubscribePost: null,
    });

    // First sync: 2 messages in Jan + 2 in Feb for the same sender.
    const first = new FakeGmailClient([
      month1('jan-1', 5),
      month1('jan-2', 10),
      month2('feb-1', 5),
      month2('feb-2', 10),
    ]);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(first) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const tsBefore = await db.select().from(schema.senderTimeseries);
    expect(tsBefore.length).toBe(2);
    expect(tsBefore.map((r) => r.yearMonth).sort()).toEqual(['2026-01-01', '2026-02-01']);

    // Second sync: only Jan survives. The sender survives but loses Feb.
    // The Feb row must be deleted; otherwise the sender's lifetime volume
    // would forever count messages Gmail no longer has.
    const second = new FakeGmailClient([month1('jan-1', 5), month1('jan-2', 10)]);
    await new InitialSyncWorker({ db, gmailAccess: accessFor(second) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const tsAfter = await db.select().from(schema.senderTimeseries);
    expect(tsAfter.length).toBe(1);
    expect(tsAfter[0]!.yearMonth).toBe('2026-01-01');
    expect(tsAfter[0]!.volume).toBe(2);
  });

  it('reconciliation — senders with no remaining inbound messages are pruned', async () => {
    // First sync: 6 messages across 6 distinct senders.
    const first = new FakeGmailClient(makeMessages(6, 6));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(first) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    expect((await db.select().from(senders)).length).toBe(6);

    // Second sync: only the first 4 messages survive in Gmail → senders
    // 4 and 5 lose their only message → their senders + sender_timeseries
    // rows must be pruned.
    const second = new FakeGmailClient(makeMessages(6, 6).slice(0, 4));
    await new InitialSyncWorker({ db, gmailAccess: accessFor(second) }).processJob(
      { mailboxAccountId },
      CTX,
    );
    const senderRows = await db.select().from(senders);
    expect(senderRows.length).toBe(4);
    const survivingEmails = new Set(senderRows.map((s) => s.email));
    expect(survivingEmails.has('sender4@example.com')).toBe(false);
    expect(survivingEmails.has('sender5@example.com')).toBe(false);

    const timeseriesRows = await db.select().from(schema.senderTimeseries);
    expect(timeseriesRows.every((t) => senderRows.some((s) => s.senderKey === t.senderKey))).toBe(
      true,
    );
  });

  // Senders V2 spec v1.3 §"Trust-canary CI fixture" L488-494 — the
  // auto-protect-on-replied-≥3 rule, encoded as worker integration:
  //   - 0 replies + N msgs + unsub-link → no engagement_based protect
  //     (the cascade will recommend Unsubscribe)
  //   - ≥3 replies → sender_policies.is_protected=true,
  //     protection_reason=engagement_based, regardless of unsub presence
  //   - boundary at exactly =2 stays unprotected (engagement threshold
  //     is GE 3, not GT 2; documented at L488)
  describe('trust-canary (spec v1.3 L488-494) — auto-protect on replied ≥ 3', () => {
    /**
     * Build a fixture where `senderIndex` has `replyCount` outbound
     * messages on threads they originated. The inbound seed message
     * shares its `threadId` with the user's outbound replies so the
     * thread-attribution self-join finds them.
     */
    function makeRepliedSender(
      senderIndex: number,
      replyCount: number,
      hasUnsub: boolean,
    ): GmailMessageMetadata[] {
      const base = Date.UTC(2026, 0, 1) + senderIndex * 86_400_000;
      const senderEmail = `sender${senderIndex}@example.com`;
      // Seed: 1 inbound from the sender.
      const inbound: GmailMessageMetadata = {
        id: `inbound-${senderIndex}`,
        threadId: `thread-${senderIndex}`,
        labelIds: ['INBOX'],
        snippet: `from sender ${senderIndex}`,
        internalDate: String(base),
        from: `Sender ${senderIndex} <${senderEmail}>`,
        subject: `Subject ${senderIndex}`,
        to: null,
        cc: null,
        listUnsubscribe: hasUnsub ? `<https://unsub.example/${senderIndex}>` : null,
        listUnsubscribePost: hasUnsub ? 'List-Unsubscribe=One-Click' : null,
      };
      // User's outbound replies on the same thread.
      const replies: GmailMessageMetadata[] = Array.from({ length: replyCount }, (_, i) => ({
        id: `reply-${senderIndex}-${i}`,
        threadId: `thread-${senderIndex}`,
        labelIds: ['SENT'],
        snippet: `reply ${i}`,
        internalDate: String(base + (i + 1) * 60_000),
        from: 'Owner <owner@declutrmail.ai>',
        subject: `Re: Subject ${senderIndex}`,
        to: senderEmail,
        cc: null,
        listUnsubscribe: null,
        listUnsubscribePost: null,
      }));
      return [inbound, ...replies];
    }

    it('replied ≥ 3 → senders.replied_count >= 3 + sender_policies engagement_based protected', async () => {
      // Sender 0 has 5 replies (above threshold), sender 1 has exactly 2
      // (at boundary — still below), sender 2 has 0 (no engagement).
      const fixture = [
        ...makeRepliedSender(0, 5, false),
        ...makeRepliedSender(1, 2, false),
        ...makeRepliedSender(2, 0, true), // 0 replies + unsub → spec L492 path
      ];
      const client = new FakeGmailClient(fixture);
      await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
        { mailboxAccountId },
        CTX,
      );

      const senderRows = await db
        .select({ senderKey: senders.senderKey, repliedCount: senders.repliedCount })
        .from(senders);
      const bySender = new Map(senderRows.map((r) => [r.senderKey, r.repliedCount]));
      expect(bySender.get(deriveSenderKey('sender0@example.com'))).toBe(5);
      expect(bySender.get(deriveSenderKey('sender1@example.com'))).toBe(2);
      expect(bySender.get(deriveSenderKey('sender2@example.com'))).toBe(0);

      const policies = await db
        .select({
          senderKey: schema.senderPolicies.senderKey,
          isProtected: schema.senderPolicies.isProtected,
          protectionReason: schema.senderPolicies.protectionReason,
        })
        .from(schema.senderPolicies);
      const protectedBySender = new Map(
        policies.map((p) => [
          p.senderKey,
          { isProtected: p.isProtected, reason: p.protectionReason },
        ]),
      );
      // Sender 0 (5 replies) is auto-protected with engagement_based.
      const s0 = protectedBySender.get(deriveSenderKey('sender0@example.com'));
      expect(s0?.isProtected).toBe(true);
      expect(s0?.reason).toBe('engagement_based');
      // Sender 1 (2 replies) stays below the threshold — no auto-protect row.
      expect(protectedBySender.has(deriveSenderKey('sender1@example.com'))).toBe(false);
      // Sender 2 (0 replies + unsub link) — same: not auto-protected (the
      // canary's "Unsubscribe primary CTA" outcome happens in cascade
      // evaluation downstream; the worker only refuses to mark them).
      expect(protectedBySender.has(deriveSenderKey('sender2@example.com'))).toBe(false);
    });

    it('user-agency-wins — manually demoted engagement_based row stays demoted on re-run (founder default 2026-06-05)', async () => {
      // flow-completeness-auditor 🔴-3 resolution: if the user manually
      // flips an engagement_based-protected row to `is_protected=false`,
      // subsequent worker passes MUST respect the demote — never
      // silently re-protect on the next sync.
      const fixture = makeRepliedSender(0, 5, false);
      const client = new FakeGmailClient(fixture);
      await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
        { mailboxAccountId },
        CTX,
      );
      const senderKey = deriveSenderKey('sender0@example.com');
      // Worker auto-protected on the first run.
      const [firstRun] = await db
        .select()
        .from(schema.senderPolicies)
        .where(eq(schema.senderPolicies.senderKey, senderKey));
      expect(firstRun?.isProtected).toBe(true);
      expect(firstRun?.protectionReason).toBe('engagement_based');

      // User manually demotes — leaves the row but flips the flag off.
      // (Production demote path may NULL the reason too; we test the
      // worst-case "demote-without-NULL" because that's the trap the
      // narrow guard protects against.)
      await db
        .update(schema.senderPolicies)
        .set({ isProtected: false })
        .where(eq(schema.senderPolicies.senderKey, senderKey));

      // Re-run the worker. Same fixture, same engagement signal — but
      // the WHERE guard (only `protection_reason IS NULL` rows may be
      // auto-protected) must refuse the re-protect.
      await new InitialSyncWorker({
        db,
        gmailAccess: accessFor(new FakeGmailClient(fixture)),
      }).processJob({ mailboxAccountId }, CTX);

      const [secondRun] = await db
        .select()
        .from(schema.senderPolicies)
        .where(eq(schema.senderPolicies.senderKey, senderKey));
      // STAYED demoted — user agency preserved.
      expect(secondRun?.isProtected).toBe(false);
      expect(secondRun?.protectionReason).toBe('engagement_based'); // reason retained as audit trail
    });

    it('user-agency-wins — manually demoted user_defined row stays demoted on re-run (D40/D42 unprotect)', async () => {
      // The D40/D42 PATCH endpoint's manual Unprotect demotes a
      // user_defined-protected row to `is_protected=false` while
      // PRESERVING `protection_reason='user_defined'` as the memory
      // pin (senders-policy.service.ts). With replied_count >= 3 the
      // engagement auto-protect MUST NOT silently re-protect the
      // sender — the guard auto-protects only `protection_reason IS
      // NULL` rows.
      const fixture = makeRepliedSender(0, 5, false);
      await new InitialSyncWorker({
        db,
        gmailAccess: accessFor(new FakeGmailClient(fixture)),
      }).processJob({ mailboxAccountId }, CTX);
      const senderKey = deriveSenderKey('sender0@example.com');

      // Simulate the endpoint's manual Protect → manual Unprotect:
      // protect overwrites the reason with `user_defined`; the demote
      // then clears the flag + `protection_set_at` but PINS the reason.
      await db
        .update(schema.senderPolicies)
        .set({ isProtected: false, protectionReason: 'user_defined', protectionSetAt: null })
        .where(eq(schema.senderPolicies.senderKey, senderKey));

      // Re-run — same fixture, same engagement signal (5 replies ≥ 3).
      await new InitialSyncWorker({
        db,
        gmailAccess: accessFor(new FakeGmailClient(fixture)),
      }).processJob({ mailboxAccountId }, CTX);

      const [row] = await db
        .select()
        .from(schema.senderPolicies)
        .where(eq(schema.senderPolicies.senderKey, senderKey));
      // STAYED demoted — the user's explicit Unprotect is honored.
      expect(row?.isProtected).toBe(false);
      expect(row?.protectionReason).toBe('user_defined'); // memory pin retained
      expect(row?.protectionSetAt).toBeNull();
    });

    it('idempotent — second run preserves engagement_based provenance + does not overwrite user_defined', async () => {
      // Run 1: sender 0 gets engagement_based protect (5 replies).
      const fixture = makeRepliedSender(0, 5, false);
      const client = new FakeGmailClient(fixture);
      await new InitialSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
        { mailboxAccountId },
        CTX,
      );
      const senderKey = deriveSenderKey('sender0@example.com');
      const [firstRun] = await db
        .select()
        .from(schema.senderPolicies)
        .where(eq(schema.senderPolicies.senderKey, senderKey));
      expect(firstRun?.protectionReason).toBe('engagement_based');
      const firstSetAt = firstRun!.protectionSetAt;

      // Manually elevate to user_defined (simulating a user later marking
      // the sender). Spec L488 sticky semantics — subsequent reruns must
      // PRESERVE the stronger provenance, not overwrite it.
      await db
        .update(schema.senderPolicies)
        .set({ protectionReason: 'user_defined' })
        .where(eq(schema.senderPolicies.senderKey, senderKey));

      // Run 2 (no new Gmail messages — same fixture). Worker rebuild
      // re-runs the auto-protect UPSERT; the WHERE guard should refuse
      // to overwrite the now-stronger user_defined reason.
      await new InitialSyncWorker({
        db,
        gmailAccess: accessFor(new FakeGmailClient(fixture)),
      }).processJob({ mailboxAccountId }, CTX);
      const [secondRun] = await db
        .select()
        .from(schema.senderPolicies)
        .where(eq(schema.senderPolicies.senderKey, senderKey));
      expect(secondRun?.protectionReason).toBe('user_defined');
      expect(secondRun?.isProtected).toBe(true);
      // `protection_set_at` from the original engagement-based grant is
      // preserved — the cascade audit copy reads when protection
      // started, not the most recent rerun.
      expect(secondRun?.protectionSetAt?.getTime()).toBe(firstSetAt?.getTime());
    });
  });
});

describe('InitialSyncWorker — mailbox.sync_ready outbox publish (U14)', () => {
  let db: InitialSyncDeps['db'];
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxAccountId = await seedMailbox(db);
  });

  it('publishes mailbox.sync_ready in the ready transition with workspace + count', async () => {
    const client = new FakeGmailClient(makeMessages(6, 2));
    const worker = new InitialSyncWorker({
      db,
      gmailAccess: accessFor(client),
      outbox: new OutboxPublisher(),
    });
    const result = await worker.processJob({ mailboxAccountId }, CTX);

    const events = await db.select().from(outboxEvents);
    const ready = events.filter((e) => e.topic === TOPICS.MAILBOX_SYNC_READY);
    expect(ready).toHaveLength(1);
    const payload = ready[0]!.payload as {
      mailboxAccountId: string;
      workspaceId: string;
      readyAt: string;
      messageCount: number;
    };
    expect(payload.mailboxAccountId).toBe(mailboxAccountId);
    expect(payload.messageCount).toBe(result.messagesSynced);
    expect(Date.parse(payload.readyAt)).not.toBeNaN();
    const [mb] = await db
      .select({ workspaceId: mailboxAccounts.workspaceId })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId));
    expect(payload.workspaceId).toBe(mb!.workspaceId);
  });

  it('without an outbox dep the sync still reaches ready and publishes nothing', async () => {
    const client = new FakeGmailClient(makeMessages(4, 2));
    const worker = new InitialSyncWorker({ db, gmailAccess: accessFor(client) });
    await worker.processJob({ mailboxAccountId }, CTX);

    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    const [state] = await db.select().from(providerSyncState);
    expect(state?.readinessStatus).toBe('ready');
  });
});
