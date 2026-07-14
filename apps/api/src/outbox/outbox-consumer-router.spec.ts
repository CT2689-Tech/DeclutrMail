import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import {
  automationRules,
  mailboxAccounts,
  schema,
  screenerQuarantine,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { TOPICS } from '@declutrmail/events';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOutboxConsumer } from './outbox-consumer-router.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * OutboxConsumerRouter spec (D204).
 *
 * Exercises the senders projection handler for the
 * `actions.unsubscribe_intent_recorded` topic against a real PGlite
 * database, mirroring the actions.service.spec pattern.
 */

const MIG_DIR = join(__dirname, '../../../../packages/db/migrations');

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const db = drizzle(pg, { schema }) as unknown as PgliteDatabase<typeof schema>;
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pg.exec(readFileSync(join(MIG_DIR, file), 'utf8'));
  }
  return db as unknown as DrizzleDb;
}

const SENDER_KEY_A = 'a'.repeat(64);
const SENDER_KEY_B = 'b'.repeat(64);

describe('OutboxConsumerRouter — D204 senders projection', () => {
  let db: DrizzleDb;
  let mailboxId: string;
  let consume: ReturnType<typeof buildOutboxConsumer>;

  beforeEach(async () => {
    db = await freshDb();
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [u] = await db
      .insert(users)
      .values({ workspaceId: w!.id, email: 'u@x.com' })
      .returning({ id: users.id });
    const [m] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: w!.id,
        userId: u!.id,
        provider: 'gmail',
        providerAccountId: 'u@x',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxId = m!.id;
    await db.insert(senders).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY_A,
      email: 'spam@x.com',
      domain: 'x.com',
      gmailCategory: 'updates',
      firstSeenAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-05-01'),
    });
    consume = buildOutboxConsumer(db);
  });

  it('projects actions.unsubscribe_intent_recorded into sender_policies', async () => {
    await consume({
      id: 'evt-1',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000001',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000001',
        recordedAt: new Date().toISOString(),
        method: 'one_click',
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policyType).toBe('unsubscribe');
    expect(rows[0]!.senderKey).toBe(SENDER_KEY_A);
    expect(rows[0]!.unsubStatus).toBe('requested');
  });

  it('projects explicit mailto/none initial states', async () => {
    for (const [method, expected] of [
      ['mailto', 'action_required'],
      ['none', 'unavailable'],
    ] as const) {
      await consume({
        id: `evt-${method}`,
        topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
        aggregateId:
          method === 'mailto'
            ? '00000000-0000-4000-8000-000000000011'
            : '00000000-0000-4000-8000-000000000012',
        payload: {
          mailboxAccountId: mailboxId,
          senderKey: method === 'mailto' ? SENDER_KEY_A : SENDER_KEY_B,
          activityLogId:
            method === 'mailto'
              ? '00000000-0000-4000-8000-000000000011'
              : '00000000-0000-4000-8000-000000000012',
          recordedAt: new Date().toISOString(),
          method,
        },
        attempts: 1,
        createdAt: new Date(),
      });
      const [row] = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.senderKey, method === 'mailto' ? SENDER_KEY_A : SENDER_KEY_B));
      expect(row!.unsubStatus).toBe(expected);
    }
  });

  it('projects canonical terminal unsubscribe outcomes', async () => {
    await consume({
      id: 'evt-unsub-failed',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED,
      aggregateId: '00000000-0000-4000-8000-000000000013',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        actionId: '00000000-0000-4000-8000-000000000013',
        outcome: 'unconfirmed',
        httpStatus: 302,
        executedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const [row] = await db.select().from(senderPolicies);
    expect(row!.unsubStatus).toBe('unconfirmed');
  });

  it('is idempotent on redelivery — same event twice → ONE row', async () => {
    const event = {
      id: 'evt-2',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000002',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000002',
        recordedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    } as const;
    await consume(event);
    await consume(event);
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
  });

  it('preserves existing is_protected / is_vip / protection_reason', async () => {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY_A,
      isProtected: true,
      isVip: true,
      protectionReason: 'user_defined',
    });
    await consume({
      id: 'evt-3',
      topic: TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      aggregateId: '00000000-0000-4000-8000-000000000003',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        activityLogId: '00000000-0000-4000-8000-000000000003',
        recordedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policyType).toBe('unsubscribe');
    expect(rows[0]!.isProtected).toBe(true);
    expect(rows[0]!.isVip).toBe(true);
    expect(rows[0]!.protectionReason).toBe('user_defined');
  });

  it('logs + no-ops on an unknown topic (does not throw)', async () => {
    await expect(
      consume({
        id: 'evt-unknown',
        topic: 'unknown.future_topic' as never,
        aggregateId: '00000000-0000-4000-8000-000000000004',
        payload: { foo: 'bar' },
        attempts: 1,
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(0);
  });

  it('projects triage.verdict_applied (keep) into sender_policies.policy_type=keep (D40)', async () => {
    await consume({
      id: 'evt-keep-1',
      topic: TOPICS.TRIAGE_VERDICT_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000005',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        verdict: 'keep',
        source: 'manual',
        undoToken: null,
        affectedCount: 0,
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policyType).toBe('keep');
    // Keep ≠ Protect (manifest keep docstring) — modifiers untouched.
    expect(rows[0]!.isProtected).toBe(false);
    expect(rows[0]!.isVip).toBe(false);
  });

  it('a non-keep verdict event is valid but projects nothing', async () => {
    await consume({
      id: 'evt-keep-2',
      topic: TOPICS.TRIAGE_VERDICT_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000006',
      payload: {
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY_A,
        verdict: 'archive',
        source: 'manual',
        undoToken: null,
        affectedCount: 4,
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const rows = await db.select().from(senderPolicies);
    expect(rows).toHaveLength(0);
  });

  it('resolves a pending screener quarantine row on actions.label_action_applied (D72)', async () => {
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mailboxId, senderKey: SENDER_KEY_A });
    await consume({
      id: 'evt-label-1',
      topic: TOPICS.ACTION_LABEL_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000007',
      payload: {
        mailboxAccountId: mailboxId,
        actionId: '00000000-0000-4000-8000-000000000007',
        verb: 'archive',
        senderKey: SENDER_KEY_A,
        undoToken: '00000000-0000-4000-8000-0000000000a7',
        affectedCount: 3,
        compositeId: null,
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const [row] = await db
      .select()
      .from(screenerQuarantine)
      .where(eq(screenerQuarantine.mailboxAccountId, mailboxId));
    expect(row!.decidedAt).not.toBeNull();
  });

  it('projects a successful Later wake time only after the applied event (D245)', async () => {
    const appliedAt = '2026-07-14T18:00:00.000Z';
    const wakeAt = '2026-07-21T09:00:00.000Z';
    await consume({
      id: 'evt-label-later-1',
      topic: TOPICS.ACTION_LABEL_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000079',
      payload: {
        mailboxAccountId: mailboxId,
        actionId: '00000000-0000-4000-8000-000000000079',
        verb: 'later',
        senderKey: SENDER_KEY_A,
        undoToken: '00000000-0000-4000-8000-0000000000a9',
        affectedCount: 3,
        compositeId: null,
        wakeAt,
        appliedAt,
      },
      attempts: 1,
      createdAt: new Date(appliedAt),
    });

    const [policy] = await db
      .select()
      .from(senderPolicies)
      .where(eq(senderPolicies.mailboxAccountId, mailboxId));
    expect(policy!.snoozedUntil?.toISOString()).toBe(wakeAt);
    expect(policy!.snoozedAt?.toISOString()).toBe(appliedAt);
  });

  it('does not schedule a zero-message Later decision', async () => {
    await consume({
      id: 'evt-label-later-empty',
      topic: TOPICS.ACTION_LABEL_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000078',
      payload: {
        mailboxAccountId: mailboxId,
        actionId: '00000000-0000-4000-8000-000000000078',
        verb: 'later',
        senderKey: SENDER_KEY_A,
        undoToken: null,
        affectedCount: 0,
        compositeId: null,
        wakeAt: null,
        appliedAt: '2026-07-14T18:00:00.000Z',
      },
      attempts: 1,
      createdAt: new Date('2026-07-14T18:00:00.000Z'),
    });
    expect(await db.select().from(senderPolicies)).toHaveLength(0);
  });

  it('label_action_applied with a null senderKey (message selector) resolves nothing', async () => {
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mailboxId, senderKey: SENDER_KEY_A });
    await consume({
      id: 'evt-label-2',
      topic: TOPICS.ACTION_LABEL_APPLIED,
      aggregateId: '00000000-0000-4000-8000-000000000008',
      payload: {
        mailboxAccountId: mailboxId,
        actionId: '00000000-0000-4000-8000-000000000008',
        verb: 'archive',
        senderKey: null,
        undoToken: '00000000-0000-4000-8000-0000000000a8',
        affectedCount: 2,
        compositeId: null,
      },
      attempts: 1,
      createdAt: new Date(),
    });
    const [row] = await db
      .select()
      .from(screenerQuarantine)
      .where(eq(screenerQuarantine.mailboxAccountId, mailboxId));
    expect(row!.decidedAt).toBeNull();
  });
});

describe('OutboxConsumerRouter — U14 autopilot trigger cases', () => {
  let db: DrizzleDb;
  let mailboxId: string;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    workspaceId = w!.id;
    const [u] = await db
      .insert(users)
      .values({ workspaceId, email: 'u@x.com' })
      .returning({ id: users.id });
    const [m] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId,
        userId: u!.id,
        provider: 'gmail',
        providerAccountId: 'u@x',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxId = m!.id;
  });

  it('mailbox.sync_ready seeds the 5 presets and enqueues an apply sweep', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const consume = buildOutboxConsumer(db, { autopilotApplyQueue: { add } as never });

    const readyAt = '2026-06-10T08:00:00.000Z';
    await consume({
      id: 'evt-ready-1',
      topic: TOPICS.MAILBOX_SYNC_READY,
      aggregateId: mailboxId,
      payload: { mailboxAccountId: mailboxId, workspaceId, readyAt, messageCount: 42 },
      attempts: 1,
      createdAt: new Date(),
    });

    const rules = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mailboxId));
    expect(rules).toHaveLength(5);

    expect(add).toHaveBeenCalledTimes(1);
    const [, jobData, opts] = add.mock.calls[0]!;
    expect(jobData).toEqual({
      mailboxAccountId: mailboxId,
      triggeredAtMs: Date.parse(readyAt),
    });
    expect((opts as { jobId: string }).jobId).toBe(`${mailboxId}-${Date.parse(readyAt)}`);

    // Redelivery: seeder is a no-op, enqueue dedups at BullMQ (same jobId).
    await consume({
      id: 'evt-ready-1',
      topic: TOPICS.MAILBOX_SYNC_READY,
      aggregateId: mailboxId,
      payload: { mailboxAccountId: mailboxId, workspaceId, readyAt, messageCount: 42 },
      attempts: 2,
      createdAt: new Date(),
    });
    const rulesAfter = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mailboxId));
    expect(rulesAfter).toHaveLength(5);
  });

  it('triage.score_run_completed enqueues an apply sweep keyed on producedAtMs', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const consume = buildOutboxConsumer(db, { autopilotApplyQueue: { add } as never });

    await consume({
      id: 'evt-score-1',
      topic: TOPICS.TRIAGE_SCORE_RUN_COMPLETED,
      aggregateId: mailboxId,
      payload: {
        mailboxAccountId: mailboxId,
        trigger: 'sync_complete',
        producedAtMs: 777,
        decisionsWritten: 12,
      },
      attempts: 1,
      createdAt: new Date(),
    });

    expect(add).toHaveBeenCalledTimes(1);
    const [, jobData, opts] = add.mock.calls[0]!;
    expect(jobData).toEqual({ mailboxAccountId: mailboxId, triggeredAtMs: 777 });
    expect((opts as { jobId: string }).jobId).toBe(`${mailboxId}-777`);
  });

  it('without a wired queue the event ACKs and warns instead of throwing', async () => {
    const consume = buildOutboxConsumer(db);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await consume({
        id: 'evt-score-2',
        topic: TOPICS.TRIAGE_SCORE_RUN_COMPLETED,
        aggregateId: mailboxId,
        payload: {
          mailboxAccountId: mailboxId,
          trigger: 'cron_sweep',
          producedAtMs: 1,
          decisionsWritten: 0,
        },
        attempts: 1,
        createdAt: new Date(),
      });
      const kinds = warnSpy.mock.calls.map(
        (c) => (JSON.parse(c[0] as string) as { kind: string }).kind,
      );
      expect(kinds).toContain('outbox.consumer.autopilot_queue_unwired');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('OutboxConsumerRouter — D6/D162 mailbox.sync_ready email trigger', () => {
  let db: DrizzleDb;
  let mailboxId: string;

  beforeEach(async () => {
    db = await freshDb();
    const [w] = await db.insert(workspaces).values({ name: 'W' }).returning({ id: workspaces.id });
    const [u] = await db
      .insert(users)
      .values({ workspaceId: w!.id, email: 'u@x.com' })
      .returning({ id: users.id });
    const [m] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: w!.id,
        userId: u!.id,
        provider: 'gmail',
        providerAccountId: 'u@x',
      })
      .returning({ id: mailboxAccounts.id });
    mailboxId = m!.id;
  });

  function syncReadyEvent(workspaceId: string) {
    return {
      id: 'evt-ready-1',
      topic: TOPICS.MAILBOX_SYNC_READY,
      aggregateId: mailboxId,
      payload: {
        mailboxAccountId: mailboxId,
        workspaceId,
        readyAt: '2026-06-11T08:00:00.000Z',
        messageCount: 100,
      },
      attempts: 1,
      createdAt: new Date(),
    };
  }

  it('routes mailbox.sync_ready to the injected email handler with the event id', async () => {
    const calls: Array<{ payload: unknown; eventId: string }> = [];
    const consumeWithHandler = buildOutboxConsumer(db, {
      onMailboxSyncReady: async (payload, eventId) => {
        calls.push({ payload, eventId });
      },
    });
    const [w] = await db.select().from(workspaces);
    await consumeWithHandler(syncReadyEvent(w!.id));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventId).toBe('evt-ready-1');
    expect(calls[0]!.payload).toMatchObject({ mailboxAccountId: mailboxId, messageCount: 100 });
  });

  it('ACKs (no throw) when the email handler is not wired', async () => {
    const consumeUnwired = buildOutboxConsumer(db);
    const [w] = await db.select().from(workspaces);
    // Must not throw — the dispatcher would otherwise wedge on the row.
    await expect(consumeUnwired(syncReadyEvent(w!.id))).resolves.toBeUndefined();
  });

  it('rejects a malformed sync_ready payload (Zod re-parse)', async () => {
    const consumeWithHandler = buildOutboxConsumer(db, {
      onMailboxSyncReady: async () => {},
    });
    await expect(
      consumeWithHandler({
        id: 'evt-bad',
        topic: TOPICS.MAILBOX_SYNC_READY,
        aggregateId: mailboxId,
        payload: { mailboxAccountId: mailboxId },
        attempts: 1,
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
