import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import {
  accountDeletionRequests,
  activityLog,
  briefRuns,
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
  type WeeklyValueReceiptFacts,
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

    const prepared: Array<{ userId: string; facts: WeeklyValueReceiptFacts }> = [];
    const enqueued: EmailSendJobData[] = [];
    const worker = new WeeklyValueReceiptWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async (input): Promise<PreparedWeeklyValueReceipt> => {
        prepared.push(input);
        return {
          subject: 'Your week with DeclutrMail',
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
    expect(prepared.map((p) => p.userId).sort()).toEqual([plus, pro].sort());
    expect(prepared.map((p) => p.facts.pendingScreener).sort()).toEqual([1, 2]);
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

/**
 * D189's receipt reports RECORDED OUTCOMES. These pin the aggregation,
 * because the failure this codebase keeps shipping is a surface stating
 * a number nothing behind it measured.
 */
describe('WeeklyValueReceiptWorker facts', () => {
  const DAY_MS = 24 * 60 * 60 * 1_000;

  async function factsFor(
    db: Db,
    seed: (mailboxId: string) => Promise<void>,
    pending = 0,
  ): Promise<WeeklyValueReceiptFacts | null> {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'facts', tier: 'pro' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({
        workspaceId: workspace!.id,
        email: 'facts@example.com',
        timezone: 'Asia/Kolkata',
        preferences: { emailPrefs: { weeklyReceipt: true } },
      })
      .returning({ id: users.id });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'facts@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    if (pending > 0) {
      await db.insert(screenerQuarantine).values(
        Array.from({ length: pending }, (_, index) => ({
          mailboxAccountId: mailbox!.id,
          senderKey: `pending-${index}`,
        })),
      );
    }
    await seed(mailbox!.id);

    let captured: WeeklyValueReceiptFacts | null = null;
    const worker = new WeeklyValueReceiptWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async (input): Promise<PreparedWeeklyValueReceipt> => {
        captured = input.facts;
        return { subject: 's', text: 't', headers: {} };
      },
      enqueueEmail: async () => 'added',
    });
    await worker.processJob({ scheduledAtMinute: '2026-08-02T12:30' }, CTX);
    return captured;
  }

  it('separates automation from the decisions the user made, and nets out reversals', async () => {
    const db = await freshDb();
    const facts = await factsFor(
      db,
      async (mailboxId) => {
        await db.insert(activityLog).values([
          // Automation moved mail: SUM(affected_count) = 40.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'a',
            source: 'autopilot',
            action: 'archive',
            affectedCount: 30,
            occurredAt: new Date(NOW.getTime() - 2 * DAY_MS),
          },
          {
            mailboxAccountId: mailboxId,
            senderKey: 'b',
            source: 'screener',
            action: 'later',
            affectedCount: 10,
            occurredAt: new Date(NOW.getTime() - 3 * DAY_MS),
          },
          // Reverted — the user took it back, so it is not something
          // DeclutrMail did FOR them. Counted as `undone` instead.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'c',
            source: 'autopilot',
            action: 'archive',
            affectedCount: 999,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
            revertedAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          // The user's own decisions: counted as decisions, not messages.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'd',
            source: 'triage',
            action: 'unsubscribe',
            affectedCount: 5,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          {
            mailboxAccountId: mailboxId,
            senderKey: 'e',
            source: 'manual',
            action: 'keep',
            affectedCount: 0,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          // Outcome bookkeeping, NOT a decision (D245) — must not inflate
          // the count of things the user chose.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'd',
            source: 'triage',
            action: 'unsubscribe_endpoint_accepted',
            affectedCount: 0,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          // Older than the window.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'f',
            source: 'autopilot',
            action: 'archive',
            affectedCount: 500,
            occurredAt: new Date(NOW.getTime() - 20 * DAY_MS),
          },
        ]);
      },
      3,
    );

    expect(facts).toMatchObject({
      automatedMessages: 40,
      ownDecisions: 2,
      undone: 1,
      pendingScreener: 3,
    });
  });

  it('counts DISTINCT senders, never rows, and ignores sender-less bulk actions', async () => {
    const db = await freshDb();
    const facts = await factsFor(
      db,
      async (mailboxId) => {
        await db.insert(activityLog).values([
          // SAME sender decided twice in the week. COUNT(*) would render
          // this as "2 senders you decided on yourself".
          {
            mailboxAccountId: mailboxId,
            senderKey: 'same',
            source: 'triage',
            action: 'later',
            affectedCount: 1,
            occurredAt: new Date(NOW.getTime() - 3 * DAY_MS),
          },
          {
            mailboxAccountId: mailboxId,
            senderKey: 'same',
            source: 'triage',
            action: 'archive',
            affectedCount: 4,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          // A different sender — the real second one.
          {
            mailboxAccountId: mailboxId,
            senderKey: 'other',
            source: 'manual',
            action: 'keep',
            affectedCount: 0,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
          // sender_key NULL: a bulk action over a message selection, not
          // a sender decision. COUNT(*) would have read this as a sender.
          {
            mailboxAccountId: mailboxId,
            senderKey: null,
            source: 'manual',
            action: 'archive',
            affectedCount: 12,
            occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
          },
        ]);
      },
      1,
    );

    expect(facts?.ownDecisions).toBe(2);
  });

  it('counts only ACTIVE mailboxes in the "right now" Screener backlog', async () => {
    const db = await freshDb();
    const facts = await factsFor(
      db,
      async (mailboxId) => {
        await db
          .update(mailboxAccounts)
          .set({ status: 'disconnected' })
          .where(eq(mailboxAccounts.id, mailboxId));
        await db.insert(activityLog).values({
          mailboxAccountId: mailboxId,
          senderKey: 'a',
          source: 'triage',
          action: 'archive',
          affectedCount: 1,
          occurredAt: new Date(NOW.getTime() - 1 * DAY_MS),
        });
      },
      5,
    );

    // The copy says "waiting in Screener right now" — a disconnected
    // mailbox's queue is not something the user can act on.
    expect(facts?.pendingScreener).toBe(0);
  });

  /**
   * The unknown-vs-zero line. A week with no Brief run is not a week
   * where the Brief surfaced nobody — the template omits the line rather
   * than printing a 0 it did not measure.
   */
  it('reports briefSurfaced as null when the Brief never ran, and a count when it did', async () => {
    const noBrief = await factsFor(await freshDb(), async () => {}, 2);
    expect(noBrief?.briefSurfaced).toBeNull();

    const db = await freshDb();
    const withBrief = await factsFor(
      db,
      async (mailboxId) => {
        const [workspaceRow] = await db
          .select({ id: mailboxAccounts.workspaceId })
          .from(mailboxAccounts)
          .where(eq(mailboxAccounts.id, mailboxId));
        await db.insert(briefRuns).values([
          {
            workspaceId: workspaceRow!.id,
            mailboxAccountId: mailboxId,
            runDateLocal: '2026-07-30',
            generatedBy: 'template',
            generatedAt: new Date(NOW.getTime() - 3 * DAY_MS),
            briefPayload: {
              reply: [
                {
                  senderKey: 's1',
                  senderName: 'One',
                  senderEmail: 'o@e.com',
                  subject: 'x',
                  messageIds: ['m1'],
                },
              ],
              fyi: [
                {
                  senderKey: 's2',
                  senderName: 'Two',
                  senderEmail: 't@e.com',
                  subject: 'y',
                  messageIds: ['m2'],
                },
              ],
              noise: [],
              narrative: '',
            },
          },
          {
            workspaceId: workspaceRow!.id,
            mailboxAccountId: mailboxId,
            runDateLocal: '2026-07-31',
            generatedBy: 'template',
            generatedAt: new Date(NOW.getTime() - 2 * DAY_MS),
            briefPayload: {
              // Same sender again — distinct senders, not row count.
              reply: [
                {
                  senderKey: 's1',
                  senderName: 'One',
                  senderEmail: 'o@e.com',
                  subject: 'z',
                  messageIds: ['m3'],
                },
              ],
              fyi: [],
              noise: [],
              narrative: '',
            },
          },
        ]);
      },
      1,
    );

    expect(withBrief?.briefSurfaced).toBe(2);
  });

  it('suppresses the receipt entirely when nothing happened (D189 empty state)', async () => {
    const facts = await factsFor(await freshDb(), async () => {}, 0);
    // prepareEmail never ran, so nothing was rendered or queued.
    expect(facts).toBeNull();
  });

  /** D232 — the receipt is commercial too; never mail someone mid-erasure. */
  it('never mails a user with an in-flight deletion request', async () => {
    const db = await freshDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'deleting', tier: 'pro' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({
        workspaceId: workspace!.id,
        email: 'deleting@example.com',
        timezone: 'Asia/Kolkata',
        preferences: { emailPrefs: { weeklyReceipt: true } },
      })
      .returning({ id: users.id });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'deleting@example.com',
      })
      .returning({ id: mailboxAccounts.id });
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mailbox!.id, senderKey: 'waiting' });
    await db.insert(accountDeletionRequests).values({
      userId: user!.id,
      effectiveAt: new Date(NOW.getTime() + 7 * DAY_MS),
      basis: 'flat-grace',
      status: 'pending',
    });

    let rendered = 0;
    const worker = new WeeklyValueReceiptWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async (): Promise<PreparedWeeklyValueReceipt> => {
        rendered += 1;
        return { subject: 's', text: 't', headers: {} };
      },
      enqueueEmail: async () => 'added',
    });

    const result = await worker.processJob({ scheduledAtMinute: '2026-08-02T12:30' }, CTX);

    expect(result).toMatchObject({ deletionSkips: 1, receiptsQueued: 0 });
    expect(rendered).toBe(0);
  });
});
