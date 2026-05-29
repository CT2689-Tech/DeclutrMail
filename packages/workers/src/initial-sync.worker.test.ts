import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailboxAccounts, mailMessages, schema, senders, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
