import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  providerSyncState,
  schema,
  users,
  webhookDedup,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { GmailWebhookService } from '../gmail-webhook.service.js';

/**
 * GmailWebhookService integration tests (D8, D229 step 7 + 8).
 *
 * Runs against an in-process PGlite with every migration applied,
 * so the dedup PK + sync-state row lock + monotonic compare are
 * exercised against the real schema instead of a hand-rolled stub.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

async function freshDb(): Promise<DrizzleDb> {
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
  // PGlite + postgres-js share Drizzle's query builder; the cast lets
  // the service (typed for the postgres-js driver) run in-test.
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
}

async function seedMailbox(
  db: DrizzleDb,
  emailAddress: string,
  lastHistoryId: bigint | null = null,
): Promise<{ mailboxId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Test WS' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: emailAddress })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: emailAddress,
    })
    .returning({ id: mailboxAccounts.id });
  if (lastHistoryId !== null) {
    await db.insert(providerSyncState).values({
      mailboxAccountId: mailbox!.id,
      lastHistoryId,
      historyIdUpdatedAt: new Date(),
      readinessStatus: 'ready',
      currentStage: 'ready',
      progressPct: 100,
    });
  }
  return { mailboxId: mailbox!.id };
}

describe('GmailWebhookService.processVerifiedPush', () => {
  let db: DrizzleDb;
  let service: GmailWebhookService;

  beforeEach(async () => {
    db = await freshDb();
    service = new GmailWebhookService(db);
  });

  it('advances historyId, writes a dedup row, returns enqueued', async () => {
    const { mailboxId } = await seedMailbox(db, 'alice@example.com', 1000n);

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-001',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });

    expect(outcome.kind).toBe('enqueued');
    if (outcome.kind === 'enqueued') {
      expect(outcome.mailboxAccountId).toBe(mailboxId);
      expect(outcome.historyId).toBe(1500n);
      expect(outcome.previousHistoryId).toBe(1000n);
    }

    // Dedup row exists + carries mailbox_account_id back-fill.
    const dedupRows = await db
      .select()
      .from(webhookDedup)
      .where(eq(webhookDedup.messageId, 'msg-001'));
    expect(dedupRows.length).toBe(1);
    expect(dedupRows[0]!.mailboxAccountId).toBe(mailboxId);
    expect(dedupRows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // sync state advanced + history_id_updated_at set.
    const sync = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync[0]!.lastHistoryId).toBe(1500n);
    expect(sync[0]!.historyIdUpdatedAt).toBeInstanceOf(Date);
  });

  it('returns duplicate_message_id on a repeat messageId (step 7)', async () => {
    await seedMailbox(db, 'alice@example.com', 1000n);
    await service.processVerifiedPush({
      messageId: 'msg-dup',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    const second = await service.processVerifiedPush({
      messageId: 'msg-dup',
      payload: { emailAddress: 'alice@example.com', historyId: '1600' },
    });
    expect(second.kind).toBe('duplicate_message_id');
    if (second.kind === 'duplicate_message_id') {
      expect(second.messageId).toBe('msg-dup');
    }

    // The second push must NOT have advanced the cursor.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(1500n);
  });

  it('returns stale_history_id on equal or lower incoming historyId (step 8)', async () => {
    await seedMailbox(db, 'alice@example.com', 2000n);

    const equal = await service.processVerifiedPush({
      messageId: 'msg-equal',
      payload: { emailAddress: 'alice@example.com', historyId: '2000' },
    });
    expect(equal.kind).toBe('stale_history_id');
    if (equal.kind === 'stale_history_id') {
      expect(equal.lastHistoryId).toBe(2000n);
      expect(equal.incomingHistoryId).toBe(2000n);
    }

    const lower = await service.processVerifiedPush({
      messageId: 'msg-lower',
      payload: { emailAddress: 'alice@example.com', historyId: '1500' },
    });
    expect(lower.kind).toBe('stale_history_id');

    // Cursor untouched.
    const sync = await db.select().from(providerSyncState);
    expect(sync[0]!.lastHistoryId).toBe(2000n);
  });

  it('returns unknown_mailbox when the emailAddress does not resolve', async () => {
    const outcome = await service.processVerifiedPush({
      messageId: 'msg-orphan',
      payload: { emailAddress: 'unknown@example.com', historyId: '500' },
    });
    expect(outcome.kind).toBe('unknown_mailbox');

    // Dedup row was written before the lookup — defense in depth.
    const dedup = await db.select().from(webhookDedup);
    expect(dedup.length).toBe(1);
    expect(dedup[0]!.messageId).toBe('msg-orphan');
  });

  it('bootstraps provider_sync_state when the mailbox has no row yet', async () => {
    const { mailboxId } = await seedMailbox(db, 'bob@example.com', null);

    const outcome = await service.processVerifiedPush({
      messageId: 'msg-bootstrap',
      payload: { emailAddress: 'bob@example.com', historyId: '42' },
    });
    expect(outcome.kind).toBe('enqueued');

    const sync = await db
      .select()
      .from(providerSyncState)
      .where(eq(providerSyncState.mailboxAccountId, mailboxId));
    expect(sync.length).toBe(1);
    expect(sync[0]!.lastHistoryId).toBe(42n);
    expect(sync[0]!.readinessStatus).toBe('ready');
  });

  it('rejects an oversized messageId at the DB length cap (varchar 512)', async () => {
    // Pub/Sub messageIds are ~16 chars in practice. The schema caps
    // the column at varchar(512) so a pathological publisher (or a
    // hostile mirror) cannot inflate the PK index with multi-KB rows.
    await seedMailbox(db, 'alice@example.com', 1000n);
    const oversized = 'x'.repeat(513);

    await expect(
      service.processVerifiedPush({
        messageId: oversized,
        payload: { emailAddress: 'alice@example.com', historyId: '1500' },
      }),
    ).rejects.toThrow(/value too long|length|varying\(512\)/i);
  });
});
