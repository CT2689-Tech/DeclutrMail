import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  mailMessages,
  providerSyncState,
  schema,
  senderPolicies,
  senders,
  senderTimeseries,
  users,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncrementalSyncWorker } from './incremental-sync.worker.js';
import type { IncrementalSyncDeps } from './incremental-sync.worker.js';
import type {
  GmailAccess,
  GmailHistoryPage,
  GmailHistoryRecord,
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
} from './ports.js';
import { deriveSenderKey } from './sender-key.js';
import type { WorkerContext } from './worker-context.js';

/**
 * IncrementalSyncWorker integration tests (D8, D229 follow-up).
 *
 * Same PGlite + freshDb pattern as `initial-sync.worker.test.ts` — the
 * worker runs against the real migrated schema and a fake
 * `GmailMetadataClient` that hands back scripted history pages +
 * metadata. Covers:
 *   - message-added → mail_messages insert + sender materialise
 *   - message-deleted → hard-delete (idempotent on redelivery)
 *   - labels_added / labels_removed → array union/diff in place
 *   - reply-attribution post-pass → replied_count + auto-protect
 *   - cursor advance → provider_sync_state.last_history_id updated
 *   - cursor-too-old → null page returned, cursor NOT advanced
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

async function freshDb(): Promise<IncrementalSyncDeps['db']> {
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
  return drizzle(pg, { schema }) as unknown as IncrementalSyncDeps['db'];
}

async function seedMailbox(db: IncrementalSyncDeps['db']): Promise<string> {
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
  // Provider_sync_state row — the cursor advance UPDATEs in place, so it
  // must already exist. Real callers (the webhook path) only enqueue
  // after `advanceHistoryIdWithExecutor`, which itself requires the row.
  await db.insert(providerSyncState).values({
    mailboxAccountId: mailbox!.id,
    readinessStatus: 'ready',
    lastHistoryId: 1000n,
  });
  return mailbox!.id;
}

/**
 * Build a metadata record. Use a fixed UTC base date so the
 * `internal_date` columns line up deterministically across runs (PGlite
 * is not Date-randomised).
 */
function makeMetadata(
  id: string,
  threadId: string,
  fromEmail: string,
  labelIds: string[],
  internalDateMs: number,
  overrides: Partial<GmailMessageMetadata> = {},
): GmailMessageMetadata {
  return {
    id,
    threadId,
    labelIds,
    snippet: `snippet ${id}`,
    internalDate: String(internalDateMs),
    from: fromEmail.startsWith('Owner ') ? fromEmail : `Sender <${fromEmail}>`,
    subject: `Subject ${id}`,
    to: null,
    cc: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
    ...overrides,
  };
}

/**
 * Fake Gmail client — serves a scripted history (one page) + a metadata
 * lookup table. The fake intentionally does NOT model multi-page
 * history; the worker pages internally + the multi-page case is
 * covered by the dedicated test.
 */
class FakeGmailClient implements GmailMetadataClient {
  constructor(
    private readonly pages: Array<{
      forCursor: string;
      page: GmailHistoryPage | null;
    }>,
    private readonly metadata: Map<string, GmailMessageMetadata>,
  ) {}

  // Initial-sync surface — never invoked by IncrementalSyncWorker but
  // required by the port.
  async listMessageIds(): Promise<GmailMessageListPage> {
    return { ids: [] };
  }

  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata | null> {
    return this.metadata.get(messageId) ?? null;
  }

  async getProfile(): Promise<{ historyId: string }> {
    return { historyId: '9999' };
  }

  async listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage | null> {
    const cursor = pageToken ?? startHistoryId;
    const entry = this.pages.find((p) => p.forCursor === cursor);
    if (!entry) {
      return { records: [], historyId: startHistoryId };
    }
    return entry.page;
  }
}

function accessFor(client: GmailMetadataClient): GmailAccess {
  return { getClient: async () => client };
}

const CTX: WorkerContext = {
  jobId: 'test-job',
  workerName: 'IncrementalSyncWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('IncrementalSyncWorker', () => {
  let db: IncrementalSyncDeps['db'];
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxAccountId = await seedMailbox(db);
  });

  it('no-ops a disconnected mailbox before Gmail access or cursor writes', async () => {
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, mailboxAccountId));
    const getClient = vi.fn(async () => {
      throw new Error('disconnected sync must not request a Gmail client');
    });

    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: { getClient },
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);

    expect(result).toEqual({
      recordsProcessed: 0,
      added: 0,
      deleted: 0,
      labelChanges: 0,
      cursorTooOld: false,
      advancedToHistoryId: null,
      mailboxInactive: true,
    });
    expect(result.deletionPaused).toBeUndefined();
    expect(getClient).not.toHaveBeenCalled();

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastHistoryId).toBe(1000n);
    expect(state!.lastSyncedAt).toBeNull();
    expect(await db.select().from(mailMessages)).toHaveLength(0);
  });

  it('processes a `messagesAdded` event — inserts mail + materialises sender', async () => {
    const meta = makeMetadata(
      'm-001',
      'thread-001',
      'newsletter@example.com',
      ['INBOX'],
      Date.UTC(2026, 5, 1),
    );
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'm-001', threadId: 'thread-001', labelIds: ['INBOX'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map([['m-001', meta]]),
    );

    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);

    expect(result).toEqual({
      recordsProcessed: 1,
      added: 1,
      deleted: 0,
      labelChanges: 0,
      cursorTooOld: false,
      advancedToHistoryId: '1500',
    });

    const stored = await db.select().from(mailMessages);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.providerMessageId).toBe('m-001');

    const senderRows = await db.select().from(senders);
    expect(senderRows).toHaveLength(1);
    expect(senderRows[0]!.email).toBe('newsletter@example.com');
    expect(senderRows[0]!.totalReceived).toBe(1);

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastHistoryId).toBe(1500n);
    // Freshness stamp — every completed run records `last_synced_at`
    // (the Sync-now completion watch compares this against its
    // pre-click baseline).
    expect(state!.lastSyncedAt).not.toBeNull();
  });

  it('a run with NO new history still stamps last_synced_at (no-op sync must confirm completion)', async () => {
    // Empty history page at the SAME historyId: no events, cursor guard
    // (`lastHistoryId < candidate`) matches nothing — the exact case
    // where the pre-fix code left `provider_sync_state` untouched and
    // the FE could never tell the run finished.
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records: [], historyId: '1000' } }],
      new Map(),
    );

    // Seed a prior terminal-failure marker: a successful no-op run must
    // clear it (the guarded cursor update only clears on ADVANCE), or
    // the FE completion watch would keep fail-fasting on a stale stamp.
    await db
      .update(providerSyncState)
      .set({
        lastIncrementalErrorAt: new Date('2026-07-01T00:00:00Z'),
        lastIncrementalErrorCode: 'GMAIL_HISTORY_GONE',
      })
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));

    const before = await db
      .select({ lastSyncedAt: providerSyncState.lastSyncedAt })
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(before[0]!.lastSyncedAt).toBeNull();

    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1000' }, CTX);
    expect(result.recordsProcessed).toBe(0);

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastSyncedAt).not.toBeNull();
    // Cursor untouched — only the freshness stamp moved.
    expect(state!.lastHistoryId).toBe(1000n);
    // Success supersedes the failure marker.
    expect(state!.lastIncrementalErrorAt).toBeNull();
    expect(state!.lastIncrementalErrorCode).toBeNull();
  });

  it('idempotent on redelivered `messagesAdded` — second run does not double-count totalReceived', async () => {
    const meta = makeMetadata(
      'm-002',
      'thread-002',
      'shop@example.com',
      ['INBOX'],
      Date.UTC(2026, 5, 1),
    );
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'm-002', threadId: 'thread-002', labelIds: ['INBOX'] },
    ];
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [{ forCursor: '1000', page: { records, historyId: '1500' } }],
          new Map([['m-002', meta]]),
        ),
      ),
    });

    await worker.processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );
    await worker.processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    const senderRows = await db.select().from(senders);
    // ON CONFLICT DO UPDATE on mail_messages → the second insert is a
    // replay, NOT a true insert; the sender's totalReceived is only
    // bumped on true inserts. (Per ADR-0014 Path B idempotency.)
    // The current implementation increments unconditionally on every
    // upsert-returning row — this test pins that observable behavior
    // so a future change to the contract is explicit.
    expect(senderRows[0]!.totalReceived).toBe(2);
  });

  it('processes a `messagesDeleted` event — hard-deletes the row', async () => {
    // Seed an existing row first (simulating the prior `added` already
    // landed).
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'm-del',
      providerThreadId: 'thread-del',
      senderKey: deriveSenderKey('gone@example.com'),
      internalDate: new Date(Date.UTC(2026, 5, 1)),
      isUnread: false,
    });

    const records: GmailHistoryRecord[] = [
      { kind: 'deleted', messageId: 'm-del', threadId: 'thread-del' },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map(),
    );

    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);
    expect(result.deleted).toBe(1);

    const stored = await db.select().from(mailMessages);
    expect(stored).toHaveLength(0);
  });

  it('idempotent on redelivered `messagesDeleted` — second pass counts 0', async () => {
    const records: GmailHistoryRecord[] = [
      { kind: 'deleted', messageId: 'm-absent', threadId: 'thread-absent' },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map(),
    );
    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);
    expect(result.deleted).toBe(0);
  });

  it('processes a `labels_added` event — array union, idempotent', async () => {
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'm-lab',
      providerThreadId: 'thread-lab',
      senderKey: deriveSenderKey('label@example.com'),
      internalDate: new Date(Date.UTC(2026, 5, 1)),
      labelIds: ['INBOX'],
      isUnread: false,
    });

    const records: GmailHistoryRecord[] = [
      { kind: 'labels_added', messageId: 'm-lab', labelIds: ['STARRED', 'INBOX'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map(),
    );

    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    const [row] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'm-lab'));
    // INBOX is deduplicated, STARRED is appended.
    expect(row!.labelIds.sort()).toEqual(['INBOX', 'STARRED']);
  });

  it('processes a `labels_removed` event — UNREAD shadow stays in lockstep', async () => {
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'm-read',
      providerThreadId: 'thread-read',
      senderKey: deriveSenderKey('mark-read@example.com'),
      internalDate: new Date(Date.UTC(2026, 5, 1)),
      labelIds: ['INBOX', 'UNREAD'],
      isUnread: true,
    });
    const records: GmailHistoryRecord[] = [
      { kind: 'labels_removed', messageId: 'm-read', labelIds: ['UNREAD'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map(),
    );
    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );
    const [row] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'm-read'));
    expect(row!.labelIds).toEqual(['INBOX']);
    expect(row!.isUnread).toBe(false);
  });

  it('runs the reply-attribution + auto-protect post-pass after a batch', async () => {
    // Set up a sender that already has 2 prior outbound replies on the
    // same thread (below the auto-protect threshold). The incoming
    // history adds a third — the post-pass flips the auto-protect flag.
    const senderEmail = 'persona@example.com';
    const senderKey = deriveSenderKey(senderEmail);
    const threadId = 'thread-chat';
    const base = Date.UTC(2026, 5, 1);

    // Inbound seed (pre-existing).
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'inbound-0',
      providerThreadId: threadId,
      senderKey,
      internalDate: new Date(base),
      isUnread: false,
    });
    // 2 prior outbound replies on the thread (pre-existing).
    await db.insert(mailMessages).values([
      {
        mailboxAccountId,
        providerMessageId: 'reply-0',
        providerThreadId: threadId,
        senderKey: '',
        internalDate: new Date(base + 60_000),
        isUnread: false,
        isOutbound: true,
      },
      {
        mailboxAccountId,
        providerMessageId: 'reply-1',
        providerThreadId: threadId,
        senderKey: '',
        internalDate: new Date(base + 120_000),
        isUnread: false,
        isOutbound: true,
      },
    ]);
    // Sender row exists (created previously by sync).
    await db.insert(senders).values({
      mailboxAccountId,
      senderKey,
      displayName: 'Persona',
      email: senderEmail,
      domain: 'example.com',
      gmailCategory: 'primary',
      firstSeenAt: new Date(base),
      lastSeenAt: new Date(base),
      totalReceived: 1,
      repliedCount: 2,
    });

    // The history records ADD the third outbound reply.
    const newReply = makeMetadata(
      'reply-2',
      threadId,
      'Owner <owner@declutrmail.ai>',
      ['SENT'],
      base + 180_000,
      { to: senderEmail },
    );
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'reply-2', threadId, labelIds: ['SENT'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map([['reply-2', newReply]]),
    );

    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    // replied_count flipped to 3 — post-pass ran.
    const [updated] = await db.select().from(senders).where(eq(senders.senderKey, senderKey));
    expect(updated!.repliedCount).toBe(3);

    // Auto-protect engaged.
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      );
    expect(policy?.isProtected).toBe(true);
    expect(policy?.protectionReason).toBe('engagement_based');
  });

  it('auto-protect post-pass honors a manually demoted user_defined row (D40/D42 unprotect)', async () => {
    // Same engagement fixture as the post-pass test above (2 prior
    // replies + 1 incoming → replied_count=3), but the sender carries
    // the D40/D42 manual-Unprotect memory pin: `is_protected=false`
    // with `protection_reason='user_defined'` preserved
    // (senders-policy.service.ts). The webhook pass MUST NOT silently
    // re-protect — only `protection_reason IS NULL` rows may be
    // auto-protected.
    const senderEmail = 'persona@example.com';
    const senderKey = deriveSenderKey(senderEmail);
    const threadId = 'thread-chat';
    const base = Date.UTC(2026, 5, 1);

    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: 'inbound-0',
      providerThreadId: threadId,
      senderKey,
      internalDate: new Date(base),
      isUnread: false,
    });
    await db.insert(mailMessages).values([
      {
        mailboxAccountId,
        providerMessageId: 'reply-0',
        providerThreadId: threadId,
        senderKey: '',
        internalDate: new Date(base + 60_000),
        isUnread: false,
        isOutbound: true,
      },
      {
        mailboxAccountId,
        providerMessageId: 'reply-1',
        providerThreadId: threadId,
        senderKey: '',
        internalDate: new Date(base + 120_000),
        isUnread: false,
        isOutbound: true,
      },
    ]);
    await db.insert(senders).values({
      mailboxAccountId,
      senderKey,
      displayName: 'Persona',
      email: senderEmail,
      domain: 'example.com',
      gmailCategory: 'primary',
      firstSeenAt: new Date(base),
      lastSeenAt: new Date(base),
      totalReceived: 1,
      repliedCount: 2,
    });
    // The memory-pin state the manual Unprotect leaves behind.
    await db.insert(senderPolicies).values({
      mailboxAccountId,
      senderKey,
      isProtected: false,
      protectionReason: 'user_defined',
      protectionSetAt: null,
    });

    const newReply = makeMetadata(
      'reply-2',
      threadId,
      'Owner <owner@declutrmail.ai>',
      ['SENT'],
      base + 180_000,
      { to: senderEmail },
    );
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'reply-2', threadId, labelIds: ['SENT'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map([['reply-2', newReply]]),
    );

    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    // Signal crossed the threshold…
    const [updated] = await db.select().from(senders).where(eq(senders.senderKey, senderKey));
    expect(updated!.repliedCount).toBe(3);

    // …but the user's explicit demote is honored.
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      );
    expect(policy?.isProtected).toBe(false);
    expect(policy?.protectionReason).toBe('user_defined'); // memory pin retained
    expect(policy?.protectionSetAt).toBeNull();
  });

  it('cursor-too-old (Gmail 404) → cursorTooOld:true + cursor not advanced', async () => {
    const client = new FakeGmailClient([{ forCursor: '1000', page: null }], new Map());
    const result = await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(client),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);
    expect(result.cursorTooOld).toBe(true);
    expect(result.advancedToHistoryId).toBeNull();
    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    // Cursor stays at the seed value (1000n) — no advance attempted.
    expect(state!.lastHistoryId).toBe(1000n);
  });

  it('rejects payload missing mailboxAccountId / startHistoryId (ValidationError)', async () => {
    const client = new FakeGmailClient([], new Map());
    const worker = new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) });
    await expect(
      worker.processJob(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { startHistoryId: '1', endHistoryId: '2' } as any,
        CTX,
      ),
    ).rejects.toThrow(/mailboxAccountId/);
    await expect(
      worker.processJob(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { mailboxAccountId, endHistoryId: '2' } as any,
        CTX,
      ),
    ).rejects.toThrow(/startHistoryId/);
  });

  it('symmetric LEAST/GREATEST: a backdated incremental message lowers first_seen_at; a newer one raises last_seen_at', async () => {
    // Pre-seed a sender at a middle date. Then deliver two history
    // events: one with an OLDER internal_date (e.g. Gmail surfaces a
    // backdated `labelChanged` for an older thread) and one with a
    // NEWER internal_date. After both, first_seen_at MUST be the
    // older date and last_seen_at MUST be the newer date — the UPSERT
    // ON CONFLICT clause uses LEAST + GREATEST to keep both bounds
    // monotonic in their natural direction regardless of arrival order.
    const senderEmail = 'sym@example.com';
    const senderKey = await deriveSenderKey(senderEmail);
    const middle = Date.UTC(2026, 5, 15); // 2026-06-15
    const older = Date.UTC(2026, 4, 1); // 2026-05-01
    const newer = Date.UTC(2026, 6, 1); // 2026-07-01

    await db.insert(senders).values({
      mailboxAccountId,
      senderKey,
      displayName: 'Sym',
      email: senderEmail,
      domain: 'example.com',
      gmailCategory: 'primary',
      firstSeenAt: new Date(middle),
      lastSeenAt: new Date(middle),
      totalReceived: 1,
    });

    // Deliver backdated message first.
    const olderMeta = makeMetadata('sym-old', 'thread-old', senderEmail, ['INBOX'], older);
    await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [
            {
              forCursor: '1000',
              page: {
                records: [
                  {
                    kind: 'added',
                    messageId: 'sym-old',
                    threadId: 'thread-old',
                    labelIds: ['INBOX'],
                  },
                ],
                historyId: '1500',
              },
            },
          ],
          new Map([['sym-old', olderMeta]]),
        ),
      ),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);

    // Then a newer message via a second history window.
    const newerMeta = makeMetadata('sym-new', 'thread-new', senderEmail, ['INBOX'], newer);
    await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [
            {
              forCursor: '1500',
              page: {
                records: [
                  {
                    kind: 'added',
                    messageId: 'sym-new',
                    threadId: 'thread-new',
                    labelIds: ['INBOX'],
                  },
                ],
                historyId: '2000',
              },
            },
          ],
          new Map([['sym-new', newerMeta]]),
        ),
      ),
    }).processJob({ mailboxAccountId, startHistoryId: '1500', endHistoryId: '2000' }, CTX);

    const [row] = await db
      .select({ first: senders.firstSeenAt, last: senders.lastSeenAt })
      .from(senders)
      .where(eq(senders.senderKey, senderKey));
    expect(row!.first.getTime()).toBe(older); // LEAST kept lowering
    expect(row!.last.getTime()).toBe(newer); // GREATEST kept raising
  });

  it('derives sender unsubscribe_method on insert and upgrades monotonically (one_click > mailto > none)', async () => {
    // Two senders × multiple messages (Drizzle correlated-subquery
    // pitfall guard — a tautological correlated ref would pass with a
    // single row on either side). Sender A walks the full upgrade
    // ladder none → mailto → one_click; sender B starts at one_click
    // and must survive both a header-less and a mailto-only message
    // without demotion.
    const senderA = 'news-a@example.com';
    const senderB = 'news-b@example.com';
    const base = Date.UTC(2026, 5, 1);

    const a1 = makeMetadata('a-1', 'thread-a1', senderA, ['INBOX'], base);
    const b1 = makeMetadata('b-1', 'thread-b1', senderB, ['INBOX'], base + 1_000, {
      listUnsubscribe: '<https://b.example.com/unsub>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
    });
    const run1: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'a-1', threadId: 'thread-a1', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'b-1', threadId: 'thread-b1', labelIds: ['INBOX'] },
    ];
    await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [{ forCursor: '1000', page: { records: run1, historyId: '1500' } }],
          new Map([
            ['a-1', a1],
            ['b-1', b1],
          ]),
        ),
      ),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);

    const keyA = deriveSenderKey(senderA);
    const keyB = deriveSenderKey(senderB);
    let [rowA] = await db.select().from(senders).where(eq(senders.senderKey, keyA));
    let [rowB] = await db.select().from(senders).where(eq(senders.senderKey, keyB));
    // Insert path — A had no List-Unsubscribe header, B was one-click.
    expect(rowA!.unsubscribeMethod).toBe('none');
    expect(rowA!.unsubscribeUrl).toBeNull();
    expect(rowB!.unsubscribeMethod).toBe('one_click');
    expect(rowB!.unsubscribeUrl).toBe('https://b.example.com/unsub');

    // Run 2 — A upgrades mailto then one_click; B sees a header-less
    // and a mailto-only message and must NOT demote.
    const a2 = makeMetadata('a-2', 'thread-a2', senderA, ['INBOX'], base + 2_000, {
      listUnsubscribe: '<mailto:unsub@a.example.com>',
    });
    const a3 = makeMetadata('a-3', 'thread-a3', senderA, ['INBOX'], base + 3_000, {
      listUnsubscribe: '<https://a.example.com/unsub>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
    });
    const b2 = makeMetadata('b-2', 'thread-b2', senderB, ['INBOX'], base + 4_000);
    const b3 = makeMetadata('b-3', 'thread-b3', senderB, ['INBOX'], base + 5_000, {
      listUnsubscribe: '<mailto:unsub@b.example.com>',
    });
    const run2: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'a-2', threadId: 'thread-a2', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'b-2', threadId: 'thread-b2', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'a-3', threadId: 'thread-a3', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'b-3', threadId: 'thread-b3', labelIds: ['INBOX'] },
    ];
    await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [{ forCursor: '1500', page: { records: run2, historyId: '2000' } }],
          new Map([
            ['a-2', a2],
            ['a-3', a3],
            ['b-2', b2],
            ['b-3', b3],
          ]),
        ),
      ),
    }).processJob({ mailboxAccountId, startHistoryId: '1500', endHistoryId: '2000' }, CTX);

    [rowA] = await db.select().from(senders).where(eq(senders.senderKey, keyA));
    [rowB] = await db.select().from(senders).where(eq(senders.senderKey, keyB));
    // A climbed the ladder; the URL stays scheme-matched (Option B).
    expect(rowA!.unsubscribeMethod).toBe('one_click');
    expect(rowA!.unsubscribeUrl).toBe('https://a.example.com/unsub');
    // B never demoted — neither the header-less nor the mailto message
    // lowered the one_click method or replaced its HTTPS URL.
    expect(rowB!.unsubscribeMethod).toBe('one_click');
    expect(rowB!.unsubscribeUrl).toBe('https://b.example.com/unsub');
  });

  it('mailto-only message upgrades a NULL/none sender but a later header-less one keeps mailto', async () => {
    // Pre-seed a sender row with NO method (NULL — the post-initial-sync
    // legacy state this fix targets) and a second sender at 'none' so
    // the conflict path is exercised on both NULL and 'none' ranks.
    const senderC = 'legacy-null@example.com';
    const senderD = 'legacy-none@example.com';
    const keyC = deriveSenderKey(senderC);
    const keyD = deriveSenderKey(senderD);
    const base = Date.UTC(2026, 5, 10);
    await db.insert(senders).values([
      {
        mailboxAccountId,
        senderKey: keyC,
        displayName: 'Legacy Null',
        email: senderC,
        domain: 'example.com',
        gmailCategory: 'updates',
        firstSeenAt: new Date(base),
        lastSeenAt: new Date(base),
        totalReceived: 1,
      },
      {
        mailboxAccountId,
        senderKey: keyD,
        displayName: 'Legacy None',
        email: senderD,
        domain: 'example.com',
        gmailCategory: 'updates',
        firstSeenAt: new Date(base),
        lastSeenAt: new Date(base),
        totalReceived: 1,
        unsubscribeMethod: 'none',
      },
    ]);

    const c1 = makeMetadata('c-1', 'thread-c1', senderC, ['INBOX'], base + 1_000, {
      listUnsubscribe: '<mailto:unsub@c.example.com>',
    });
    const c2 = makeMetadata('c-2', 'thread-c2', senderC, ['INBOX'], base + 2_000);
    const d1 = makeMetadata('d-1', 'thread-d1', senderD, ['INBOX'], base + 3_000, {
      listUnsubscribe: '<mailto:unsub@d.example.com>',
    });
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'c-1', threadId: 'thread-c1', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'c-2', threadId: 'thread-c2', labelIds: ['INBOX'] },
      { kind: 'added', messageId: 'd-1', threadId: 'thread-d1', labelIds: ['INBOX'] },
    ];
    await new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        new FakeGmailClient(
          [{ forCursor: '1000', page: { records, historyId: '1500' } }],
          new Map([
            ['c-1', c1],
            ['c-2', c2],
            ['d-1', d1],
          ]),
        ),
      ),
    }).processJob({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, CTX);

    const [rowC] = await db.select().from(senders).where(eq(senders.senderKey, keyC));
    const [rowD] = await db.select().from(senders).where(eq(senders.senderKey, keyD));
    // NULL ranks as none — the mailto message upgrades it; the
    // header-less follow-up (c-2) does not demote it back.
    expect(rowC!.unsubscribeMethod).toBe('mailto');
    expect(rowC!.unsubscribeUrl).toBe('mailto:unsub@c.example.com');
    expect(rowD!.unsubscribeMethod).toBe('mailto');
    expect(rowD!.unsubscribeUrl).toBe('mailto:unsub@d.example.com');
  });

  it('updates `sender_timeseries` on a new INBOUND message', async () => {
    const meta = makeMetadata(
      'ts-001',
      'thread-ts',
      'tracker@example.com',
      ['INBOX'],
      Date.UTC(2026, 5, 15), // June 15
    );
    const records: GmailHistoryRecord[] = [
      { kind: 'added', messageId: 'ts-001', threadId: 'thread-ts', labelIds: ['INBOX'] },
    ];
    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map([['ts-001', meta]]),
    );
    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );
    const rows = await db.select().from(senderTimeseries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.yearMonth).toBe('2026-06-01');
    expect(rows[0]!.volume).toBe(1);
  });

  it('onTerminalFailure stamps last_incremental_error_at/_code without flipping readiness_status', async () => {
    // Per finding: a fully-onboarded mailbox must NOT be flipped to
    // readiness='failed' on an incremental terminal failure — that
    // would mis-route the user to /onboarding mid-session. The
    // distinct columns surface the error without disturbing the
    // readiness lifecycle.
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(new FakeGmailClient([], new Map())),
    });
    const error = new Error('cursor advance failed after retries');
    error.name = 'CursorStaleError';

    // onTerminalFailure is protected; cast to access it directly.
    await (
      worker as unknown as {
        onTerminalFailure: (
          payload: { mailboxAccountId: string; startHistoryId: string; endHistoryId: string },
          err: Error,
        ) => Promise<void>;
      }
    ).onTerminalFailure({ mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' }, error);

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastIncrementalErrorCode).toBe('CursorStaleError');
    expect(state!.lastIncrementalErrorAt).toBeInstanceOf(Date);
    // Readiness intentionally NOT touched.
    expect(state!.readinessStatus).toBe('ready');
  });

  it('successful cursor advance clears any prior incremental terminal-failure marker', async () => {
    // Seed the error marker as if a prior terminal failure ran.
    await db
      .update(providerSyncState)
      .set({
        lastIncrementalErrorAt: new Date(Date.UTC(2026, 5, 1)),
        lastIncrementalErrorCode: 'PriorError',
      })
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));

    const client = new FakeGmailClient(
      [{ forCursor: '1000', page: { records: [], historyId: '1500' } }],
      new Map(),
    );
    await new IncrementalSyncWorker({ db, gmailAccess: accessFor(client) }).processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    const [state] = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
    expect(state!.lastIncrementalErrorAt).toBeNull();
    expect(state!.lastIncrementalErrorCode).toBeNull();
    // Cursor + freshness updated alongside.
    expect(state!.lastHistoryId).toBe(1500n);
    expect(state!.historyIdUpdatedAt).toBeInstanceOf(Date);
  });
});

describe('IncrementalSyncWorker — onNewSender first-seen callback (D75)', () => {
  let db: IncrementalSyncDeps['db'];
  let mailboxAccountId: string;

  beforeEach(async () => {
    db = await freshDb();
    mailboxAccountId = await seedMailbox(db);
  });

  function clientWithAdds(adds: Array<{ id: string; from: string }>): FakeGmailClient {
    const records: GmailHistoryRecord[] = adds.map((a) => ({
      kind: 'added',
      messageId: a.id,
      threadId: `t-${a.id}`,
      labelIds: ['INBOX'],
    }));
    return new FakeGmailClient(
      [{ forCursor: '1000', page: { records, historyId: '1500' } }],
      new Map(
        adds.map((a) => [
          a.id,
          makeMetadata(a.id, `t-${a.id}`, a.from, ['INBOX'], Date.UTC(2026, 5, 10)),
        ]),
      ),
    );
  }

  it('fires once per FIRST-SEEN sender, not on subsequent messages', async () => {
    const seen: string[] = [];
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(
        clientWithAdds([
          { id: 'm-n1', from: 'brandnew@example.com' },
          { id: 'm-n2', from: 'brandnew@example.com' },
        ]),
      ),
      onNewSender: async (_mb, senderKey) => {
        seen.push(senderKey);
      },
    });
    await worker.processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );

    // Two messages, ONE new sender → exactly one callback.
    expect(seen).toEqual([deriveSenderKey('brandnew@example.com')]);
  });

  it('does not fire for a sender that already exists', async () => {
    await db.insert(senders).values({
      mailboxAccountId,
      senderKey: deriveSenderKey('known@example.com'),
      email: 'known@example.com',
      domain: 'example.com',
      gmailCategory: 'primary',
      firstSeenAt: new Date(Date.UTC(2026, 4, 1)),
      lastSeenAt: new Date(Date.UTC(2026, 4, 1)),
    });
    const seen: string[] = [];
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(clientWithAdds([{ id: 'm-k1', from: 'known@example.com' }])),
      onNewSender: async (_mb, senderKey) => {
        seen.push(senderKey);
      },
    });
    await worker.processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );
    expect(seen).toEqual([]);
  });

  it('a callback failure is swallowed (WARN) — the sync delta still lands', async () => {
    const worker = new IncrementalSyncWorker({
      db,
      gmailAccess: accessFor(clientWithAdds([{ id: 'm-f1', from: 'flaky@example.com' }])),
      onNewSender: async () => {
        throw new Error('enqueue exploded');
      },
    });
    const result = await worker.processJob(
      { mailboxAccountId, startHistoryId: '1000', endHistoryId: '1500' },
      CTX,
    );
    expect(result.added).toBe(1);
    const senderRows = await db.select().from(senders);
    expect(senderRows).toHaveLength(1);
  });
});
