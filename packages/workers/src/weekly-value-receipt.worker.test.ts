import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import {
  mailboxAccounts,
  schema,
  screenerQuarantine,
  users,
  workspaces,
  type Workspace,
} from '@declutrmail/db';
import { describe, expect, it } from 'vitest';

import {
  WeeklyValueReceiptWorker,
  type PreparedWeeklyValueReceipt,
} from './weekly-value-receipt.worker.js';
import type { EmailSendJobData } from './email-send.worker.js';
import type { WorkerContext } from './worker-context.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-08-02T12:30:00.000Z'); // Sunday 18:00 in Asia/Kolkata.

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.query(statement.trim());
    }
  }
  return drizzle(pg, { schema });
}

async function seedUser(
  db: Db,
  input: {
    email: string;
    tier: Workspace['tier'];
    weeklyReceipt: boolean;
    timezone: string;
    pending: number;
  },
): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: input.email, tier: input.tier })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: workspace!.id,
      email: input.email,
      timezone: input.timezone,
      preferences: { emailPrefs: { weeklyReceipt: input.weeklyReceipt } },
    })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: input.email,
    })
    .returning({ id: mailboxAccounts.id });
  if (input.pending > 0) {
    await db.insert(screenerQuarantine).values(
      Array.from({ length: input.pending }, (_, index) => ({
        mailboxAccountId: mailbox!.id,
        senderKey: `${input.email}-${index}`,
      })),
    );
  }
  return user!.id;
}

const CTX: WorkerContext = {
  jobId: 'weekly-test',
  workerName: 'WeeklyValueReceiptWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: NOW,
  policy: 'cronPolicy',
};

describe('WeeklyValueReceiptWorker', () => {
  it('queues only opted-in Plus/Pro users with a nonempty Screener at local Sunday 18:00', async () => {
    const db = await freshDb();
    const plus = await seedUser(db, {
      email: 'plus@example.com',
      tier: 'plus',
      weeklyReceipt: true,
      timezone: 'Asia/Kolkata',
      pending: 2,
    });
    const pro = await seedUser(db, {
      email: 'pro@example.com',
      tier: 'pro',
      weeklyReceipt: true,
      timezone: 'Asia/Kolkata',
      pending: 1,
    });
    await seedUser(db, {
      email: 'free@example.com',
      tier: 'free',
      weeklyReceipt: true,
      timezone: 'Asia/Kolkata',
      pending: 4,
    });
    await seedUser(db, {
      email: 'default-off@example.com',
      tier: 'plus',
      weeklyReceipt: false,
      timezone: 'Asia/Kolkata',
      pending: 3,
    });
    await seedUser(db, {
      email: 'empty@example.com',
      tier: 'plus',
      weeklyReceipt: true,
      timezone: 'Asia/Kolkata',
      pending: 0,
    });
    await seedUser(db, {
      email: 'wrong-hour@example.com',
      tier: 'plus',
      weeklyReceipt: true,
      timezone: 'UTC',
      pending: 5,
    });

    const prepared: Array<{ userId: string; pendingCount: number }> = [];
    const enqueued: EmailSendJobData[] = [];
    const worker = new WeeklyValueReceiptWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async (input): Promise<PreparedWeeklyValueReceipt> => {
        prepared.push(input);
        return {
          subject: `${input.pendingCount} new senders are ready for review`,
          text: 'body',
          headers: { 'List-Unsubscribe': '<signed>' },
        };
      },
      enqueueEmail: async (job) => {
        enqueued.push(job);
        return 'added';
      },
    });

    const result = await worker.processJob({ scheduledAtMinute: '2026-08-02T12:30' }, CTX);

    expect(result).toMatchObject({
      paidUsersChecked: 5,
      receiptsQueued: 2,
      scheduleSkips: 1,
      preferenceSkips: 1,
      emptyQueueSkips: 1,
    });
    expect(prepared.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual(
      [
        { userId: plus, pendingCount: 2 },
        { userId: pro, pendingCount: 1 },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
    expect(enqueued.map((job) => job.userId).sort()).toEqual([plus, pro].sort());
    expect(enqueued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'weekly-value-receipt',
          userId: plus,
          idempotencyKey: `email__weekly-value-receipt__${plus}__2026-08-02`,
          headers: { 'List-Unsubscribe': '<signed>' },
        }),
      ]),
    );
  });
});
