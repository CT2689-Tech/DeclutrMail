import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  cronRuns,
  mailMessages,
  mailboxAccounts,
  schema,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import type { SnoozeLabelMapStore } from './snooze-wake.queue.js';
import {
  snoozeScheduledAtMinute,
  snoozeSweepJobId,
  snoozeWakeNowJobId,
} from './snooze-wake.queue.js';
import { laterLabelName, SnoozeWakeWorker } from './snooze-wake.worker.js';
import type { WorkerContext } from './worker-context.js';

/**
 * SnoozeWakeWorker integration tests (D78–D80).
 *
 * Real worker against in-process PGlite with every migration applied —
 * exercises the wake restore (Gmail batch + local mirror + timer
 * clear), the sweep's due-scan + failure isolation + cron_runs claim,
 * and the Later-label-id mapping publication.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
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
  return drizzle(pg, { schema });
}

const SENDER_KEY_A = 'a'.repeat(64);
const SENDER_KEY_B = 'b'.repeat(64);

async function seedMailbox(db: Db, email = 'owner@declutrmail.ai'): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: email,
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function seedSender(db: Db, mailboxAccountId: string, senderKey: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      email: `${senderKey.slice(0, 6)}@shop.example`,
      domain: 'shop.example',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    })
    .returning({ id: senders.id });
  return s!.id;
}

async function seedMessage(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  providerMessageId: string,
  labelIds: string[],
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId,
    providerThreadId: `t-${providerMessageId}`,
    senderKey,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds,
  });
}

async function seedSnooze(
  db: Db,
  mailboxAccountId: string,
  senderKey: string,
  snoozedUntil: Date,
  reason: string | null = null,
): Promise<void> {
  await db.insert(senderPolicies).values({
    mailboxAccountId,
    senderKey,
    snoozedUntil,
    snoozedAt: new Date('2026-06-01T00:00:00Z'),
    snoozedReason: reason,
  });
}

class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[]; change: LabelChange }[] = [];
  shouldThrow: Error | null = null;
  labelIdsByName = new Map<string, string>([['DeclutrMail/Later', 'Label_7']]);
  async modifyLabels(): Promise<void> {}
  async batchModify(messageIds: string[], change: LabelChange): Promise<void> {
    if (this.shouldThrow) throw this.shouldThrow;
    this.calls.push({ ids: [...messageIds], change });
  }
  async ensureLabelId(name: string): Promise<string> {
    const existing = this.labelIdsByName.get(name);
    if (existing) return existing;
    const id = `Label_${this.labelIdsByName.size + 1}`;
    this.labelIdsByName.set(name, id);
    return id;
  }
}

class FakeLabelMap implements SnoozeLabelMapStore {
  store = new Map<string, string>();
  failSet = false;
  async get(mailboxAccountId: string): Promise<string | null> {
    return this.store.get(mailboxAccountId) ?? null;
  }
  async set(mailboxAccountId: string, labelId: string): Promise<void> {
    if (this.failSet) throw new Error('redis down');
    this.store.set(mailboxAccountId, labelId);
  }
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'SnoozeWakeWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

const NOW = new Date('2026-06-11T12:00:00Z');
const PAST = new Date('2026-06-11T11:00:00Z');
const FUTURE = new Date('2026-06-12T09:00:00Z');

function makeWorker(db: Db, gmail: GmailMutationAccess, labelMap: SnoozeLabelMapStore) {
  return new SnoozeWakeWorker({
    db: db as never,
    gmailMutation: gmail,
    labelMap,
    now: () => NOW,
    concurrency: 1,
  });
}

describe('laterLabelName', () => {
  it('reads the canonical Later label from the Action Registry', () => {
    expect(laterLabelName()).toBe('DeclutrMail/Later');
  });
});

describe('SnoozeWakeWorker — targeted wake', () => {
  let db: Db;
  let mailboxId: string;
  let gmail: FakeMutationClient;
  let labelMap: FakeLabelMap;
  let worker: SnoozeWakeWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    await seedSender(db, mailboxId, SENDER_KEY_A);
    gmail = new FakeMutationClient();
    labelMap = new FakeLabelMap();
    worker = makeWorker(db, { getClient: async () => gmail }, labelMap);
  });

  it('restores later-labelled mail, updates the mirror, clears the timer', async () => {
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm1', ['Label_7']);
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm2', ['Label_7', 'STARRED']);
    // Not in the Later label — must not be touched.
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm3', ['INBOX']);
    await seedSnooze(db, mailboxId, SENDER_KEY_A, FUTURE, 'after launch');

    const result = await worker.processJob(
      {
        kind: 'wake',
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        scheduledAtMinute: '2026-06-11T12:00',
      },
      CTX,
    );

    expect(result.restoredMessages).toBe(2);
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
    expect(gmail.calls[0]!.change).toEqual({
      addLabelIds: ['INBOX'],
      removeLabelIds: ['Label_7'],
    });

    // Local mirror: Later id gone, INBOX present, other labels kept.
    const rows = await db
      .select({ id: mailMessages.providerMessageId, labels: mailMessages.labelIds })
      .from(mailMessages)
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const byId = new Map(rows.map((r) => [r.id, r.labels]));
    expect(byId.get('m1')).toEqual(['INBOX']);
    expect(byId.get('m2')!.sort()).toEqual(['INBOX', 'STARRED']);
    expect(byId.get('m3')).toEqual(['INBOX']);

    // Timer cleared (D79 — "the sender_policies row clears").
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxId),
          eq(senderPolicies.senderKey, SENDER_KEY_A),
        ),
      );
    expect(policy!.snoozedUntil).toBeNull();
    expect(policy!.snoozedAt).toBeNull();
    expect(policy!.snoozedReason).toBeNull();

    // Mapping published for the API list read.
    expect(labelMap.store.get(mailboxId)).toBe('Label_7');
  });

  it('is idempotent — a second wake finds nothing and calls Gmail never', async () => {
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm1', ['Label_7']);
    await seedSnooze(db, mailboxId, SENDER_KEY_A, FUTURE);
    const job = {
      kind: 'wake' as const,
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY_A,
      scheduledAtMinute: '2026-06-11T12:00',
    };

    await worker.processJob(job, CTX);
    gmail.calls = [];
    const second = await worker.processJob(job, CTX);

    expect(second.restoredMessages).toBe(0);
    expect(gmail.calls).toHaveLength(0);
  });

  it('does not touch other senders or other mailboxes', async () => {
    const otherMailbox = await seedMailbox(db, 'other@declutrmail.ai');
    await seedSender(db, mailboxId, SENDER_KEY_B);
    await seedSender(db, otherMailbox, SENDER_KEY_A);
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'mine', ['Label_7']);
    await seedMessage(db, mailboxId, SENDER_KEY_B, 'other-sender', ['Label_7']);
    await seedMessage(db, otherMailbox, SENDER_KEY_A, 'other-mailbox', ['Label_7']);

    await worker.processJob(
      {
        kind: 'wake',
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        scheduledAtMinute: '2026-06-11T12:00',
      },
      CTX,
    );

    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['mine']);
    const untouched = await db
      .select({ labels: mailMessages.labelIds })
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'other-sender'));
    expect(untouched[0]!.labels).toEqual(['Label_7']);
  });

  it('a mapping-store outage does not block the restore', async () => {
    labelMap.failSet = true;
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm1', ['Label_7']);
    const result = await worker.processJob(
      {
        kind: 'wake',
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        scheduledAtMinute: '2026-06-11T12:00',
      },
      CTX,
    );
    expect(result.restoredMessages).toBe(1);
    expect(gmail.calls).toHaveLength(1);
  });
});

describe('SnoozeWakeWorker — sweep', () => {
  let db: Db;
  let mailboxId: string;
  let gmail: FakeMutationClient;
  let labelMap: FakeLabelMap;
  let worker: SnoozeWakeWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    await seedSender(db, mailboxId, SENDER_KEY_A);
    await seedSender(db, mailboxId, SENDER_KEY_B);
    gmail = new FakeMutationClient();
    labelMap = new FakeLabelMap();
    worker = makeWorker(db, { getClient: async () => gmail }, labelMap);
  });

  it('wakes due senders, leaves future timers untouched', async () => {
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'due-1', ['Label_7']);
    await seedMessage(db, mailboxId, SENDER_KEY_B, 'future-1', ['Label_7']);
    await seedSnooze(db, mailboxId, SENDER_KEY_A, PAST);
    await seedSnooze(db, mailboxId, SENDER_KEY_B, FUTURE);

    const result = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );

    expect(result.dueProcessed).toBe(1);
    expect(result.woken).toBe(1);
    expect(result.restoredMessages).toBe(1);
    expect(result.failed).toBe(0);
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['due-1']);

    const [futurePolicy] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxId),
          eq(senderPolicies.senderKey, SENDER_KEY_B),
        ),
      );
    expect(futurePolicy!.snoozedUntil).not.toBeNull();
  });

  it('claims the cron minute exactly once (replica dedup)', async () => {
    await seedSnooze(db, mailboxId, SENDER_KEY_A, PAST);
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm1', ['Label_7']);

    const first = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );
    const second = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );

    expect(first.skippedDuplicateRun).toBe(false);
    expect(second.skippedDuplicateRun).toBe(true);
    expect(gmail.calls).toHaveLength(1);

    const runs = await db.select().from(cronRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it('a failing wake is isolated; the timer stays due for the next sweep', async () => {
    await seedSnooze(db, mailboxId, SENDER_KEY_A, PAST);
    await seedMessage(db, mailboxId, SENDER_KEY_A, 'm1', ['Label_7']);
    gmail.shouldThrow = new Error('gmail 500');

    const result = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );

    expect(result.failed).toBe(1);
    expect(result.woken).toBe(0);
    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxId),
          eq(senderPolicies.senderKey, SENDER_KEY_A),
        ),
      );
    // Still due — the next sweep retries.
    expect(policy!.snoozedUntil).not.toBeNull();
    // The pass itself still succeeds (failure is isolated + counted).
    const runs = await db.select().from(cronRuns);
    expect(runs[0]!.status).toBe('succeeded');
  });

  it('publishes the label mapping for mailboxes missing it', async () => {
    // No due wakes at all — the refresh loop alone publishes.
    const result = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );
    expect(result.dueProcessed).toBe(0);
    expect(result.mappingsRefreshed).toBe(1);
    expect(labelMap.store.get(mailboxId)).toBe('Label_7');

    // Second sweep: mapping present — no re-resolve.
    const again = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:01' },
      CTX,
    );
    expect(again.mappingsRefreshed).toBe(0);
  });

  it('skips disconnected mailboxes in the mapping refresh', async () => {
    const disconnectedId = await seedMailbox(db, 'gone@declutrmail.ai');
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, disconnectedId));

    const result = await worker.processJob(
      { kind: 'sweep', scheduledAtMinute: '2026-06-11T12:00' },
      CTX,
    );

    // Only the active mailbox gets a mapping — no Gmail client is ever
    // requested for the disconnected one.
    expect(result.mappingsRefreshed).toBe(1);
    expect(labelMap.store.get(mailboxId)).toBe('Label_7');
    expect(labelMap.store.has(disconnectedId)).toBe(false);
  });
});

describe('snooze-wake queue helpers', () => {
  it('job ids never contain ":" (BullMQ reserved separator)', () => {
    const minute = snoozeScheduledAtMinute(new Date('2026-06-11T12:34:56Z'));
    expect(minute).toBe('2026-06-11T12:34');
    expect(snoozeSweepJobId(minute)).not.toContain(':');
    expect(snoozeWakeNowJobId('mb-1', SENDER_KEY_A, minute)).not.toContain(':');
  });
});
