import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { mailMessages, mailboxAccounts, schema, senders, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  scheduledAtMinute as sendersScheduledAtMinute,
  SendersCounterReconciliationWorker,
} from './index.js';
import type { WorkerContext } from './worker-context.js';

/**
 * SendersCounterReconciliationWorker integration tests (ADR-0014).
 *
 * Runs the real worker against an in-process PGlite database with every
 * migration applied. Asserts that:
 *   - a clean mailbox produces zero corrections,
 *   - a deliberately-skewed counter is restored to the recount,
 *   - the metric reports corrected count + max absolute delta,
 *   - tenant isolation holds across mailboxes that share a sender_key
 *     (the MISTAKES.md 2026-05-23 regression class — same shape would
 *     leak a recount across tenants if the join were misformed),
 *   - the idempotency key follows D225's cron shape.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

/** D12 / ADR-0011 — `sha256("v1|" + lower(email))`, hex. */
function senderKeyFor(email: string): string {
  return createHash('sha256').update(`v1|${email.toLowerCase()}`).digest('hex');
}

async function seedMailbox(db: Db, label: string): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${label}` })
    .returning({
      id: workspaces.id,
    });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${label}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${label}@declutrmail.ai`,
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

async function seedSender(
  db: Db,
  args: { mailboxId: string; email: string; totalReceived?: number },
): Promise<{ id: string; senderKey: string }> {
  const senderKey = senderKeyFor(args.email);
  const now = new Date();
  const [row] = await db
    .insert(senders)
    .values({
      mailboxAccountId: args.mailboxId,
      senderKey,
      displayName: '',
      email: args.email,
      domain: args.email.split('@')[1] ?? '',
      gmailCategory: 'updates',
      firstSeenAt: now,
      lastSeenAt: now,
      ...(args.totalReceived !== undefined ? { totalReceived: args.totalReceived } : {}),
    })
    .returning({ id: senders.id });
  return { id: row!.id, senderKey };
}

async function seedMessage(
  db: Db,
  args: { mailboxId: string; senderKey: string; isOutbound?: boolean },
): Promise<void> {
  const pmid = `pmid-${randomUUID()}`;
  await db.insert(mailMessages).values({
    mailboxAccountId: args.mailboxId,
    providerMessageId: pmid,
    providerThreadId: `thr-${pmid}`,
    senderKey: args.senderKey,
    subject: '',
    snippet: '',
    internalDate: new Date(),
    isUnread: false,
    isOutbound: args.isOutbound ?? false,
  });
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'SendersCounterReconciliationWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  policy: 'cronPolicy',
};

describe('SendersCounterReconciliationWorker', () => {
  it('reports zero corrections when every counter matches the recount', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db, 'a');
    const { senderKey } = await seedSender(db, {
      mailboxId: mbId,
      email: 'noisy@x.com',
      totalReceived: 4,
    });
    for (let i = 0; i < 4; i++) {
      await seedMessage(db, { mailboxId: mbId, senderKey });
    }

    const worker = new SendersCounterReconciliationWorker({ db: db as never });
    const result = await worker.processJob(
      { scheduledAtMinute: sendersScheduledAtMinute() },
      FAKE_CTX,
    );

    expect(result.corrected).toBe(0);
    expect(result.maxAbsDelta).toBe(0);
    expect(result.totalSenders).toBe(1);
  });

  it('restores a deliberately-skewed counter and surfaces the delta in the metric', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db, 'a');
    // Three senders, three different drifts to keep the maxAbsDelta
    // assertion non-trivial.
    const { id: aId, senderKey: aKey } = await seedSender(db, {
      mailboxId: mbId,
      email: 'small-drift@x.com',
      totalReceived: 6, // truth = 5; delta = 1
    });
    const { id: bId, senderKey: bKey } = await seedSender(db, {
      mailboxId: mbId,
      email: 'big-drift@x.com',
      totalReceived: 99, // truth = 2; delta = 97
    });
    const { id: cId, senderKey: cKey } = await seedSender(db, {
      mailboxId: mbId,
      email: 'pruned@x.com',
      totalReceived: 3, // truth = 0 (zero remaining inbound messages); delta = 3
    });
    for (let i = 0; i < 5; i++) await seedMessage(db, { mailboxId: mbId, senderKey: aKey });
    for (let i = 0; i < 2; i++) await seedMessage(db, { mailboxId: mbId, senderKey: bKey });
    // c: no inbound messages — the retention-prune / fully-deleted case.
    void cKey;

    const worker = new SendersCounterReconciliationWorker({ db: db as never });
    const result = await worker.processJob(
      { scheduledAtMinute: sendersScheduledAtMinute() },
      FAKE_CTX,
    );

    expect(result.corrected).toBe(3);
    expect(result.maxAbsDelta).toBe(97);
    expect(result.totalSenders).toBe(3);

    const [aAfter] = await db.select().from(senders).where(eq(senders.id, aId));
    const [bAfter] = await db.select().from(senders).where(eq(senders.id, bId));
    const [cAfter] = await db.select().from(senders).where(eq(senders.id, cId));
    expect(aAfter!.totalReceived).toBe(5);
    expect(bAfter!.totalReceived).toBe(2);
    expect(cAfter!.totalReceived).toBe(0);
  });

  it('does not correct a counter across mailboxes that share a sender_key', async () => {
    // Tenant-boundary regression (MISTAKES.md 2026-05-23). A bug in
    // the CTE join would aggregate `mail_messages` rows from mailbox A
    // into mailbox B's recount when both carry the same `sender_key`.
    const db = await freshDb();
    const aMb = await seedMailbox(db, 'a');
    const bMb = await seedMailbox(db, 'b');

    // Same email → identical sender_key, distinct senders rows.
    const { id: aSenderId, senderKey: sharedKey } = await seedSender(db, {
      mailboxId: aMb,
      email: 'shared@x.com',
      totalReceived: 999, // skewed; truth = 3
    });
    const { id: bSenderId } = await seedSender(db, {
      mailboxId: bMb,
      email: 'shared@x.com',
      totalReceived: 1, // already correct; truth = 1
    });

    for (let i = 0; i < 3; i++) await seedMessage(db, { mailboxId: aMb, senderKey: sharedKey });
    await seedMessage(db, { mailboxId: bMb, senderKey: sharedKey });

    const worker = new SendersCounterReconciliationWorker({ db: db as never });
    const result = await worker.processJob(
      { scheduledAtMinute: sendersScheduledAtMinute() },
      FAKE_CTX,
    );

    expect(result.corrected).toBe(1);
    expect(result.totalSenders).toBe(2);

    const [aAfter] = await db.select().from(senders).where(eq(senders.id, aSenderId));
    const [bAfter] = await db.select().from(senders).where(eq(senders.id, bSenderId));
    // Mailbox A's counter is recounted to 3 (its own 3 messages only).
    // Mailbox B's counter stays at 1 — a leaked aggregate would have
    // pushed it to 4.
    expect(aAfter!.totalReceived).toBe(3);
    expect(bAfter!.totalReceived).toBe(1);
  });

  it('idempotency key combines worker name and scheduling minute (D225)', () => {
    const worker = new SendersCounterReconciliationWorker({ db: {} as never });
    type WithProtectedKey = SendersCounterReconciliationWorker & {
      getIdempotencyKey?: (payload: { scheduledAtMinute: string }) => string;
    };
    const key = (worker as WithProtectedKey).getIdempotencyKey?.({
      scheduledAtMinute: '2026-05-29T03:00',
    });
    expect(key).toBe('SendersCounterReconciliationWorker:2026-05-29T03:00');
  });

  it('scheduledAtMinute rounds down to the minute boundary', () => {
    const at = new Date('2026-05-29T03:00:42.123Z');
    expect(sendersScheduledAtMinute(at)).toBe('2026-05-29T03:00');
  });
});
