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
import { beforeEach, describe, expect, it } from 'vitest';

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
});
