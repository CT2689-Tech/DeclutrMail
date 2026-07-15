import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  actionJobs,
  activityLog,
  automationRules,
  mailboxAccounts,
  mailMessages,
  outboxEvents,
  ruleMatchLog,
  schema,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { TOPICS } from '@declutrmail/events';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AutopilotActionWorker,
  isQuietStateActive,
  type AutopilotActionDeps,
} from './autopilot-action.worker.js';
import { seedAutopilotPresets } from './autopilot-preset-seeder.js';
import type {
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { deriveSenderKey } from './sender-key.js';
import type { UnsubExecutionJobData } from './unsub-execution.worker.js';
import type { WorkerContext } from './worker-context.js';

/**
 * AutopilotActionWorker integration tests (U14 — D99, D104, D226).
 *
 * PGlite + all migrations. Covers the full execution matrix:
 *   - approved Active-mode archive match → Gmail mutation + undo +
 *     activity(source='autopilot', rule_id) + mirror + outbox event +
 *     match flip
 *   - idempotent replay (no duplicate mutation / audit rows)
 *   - unsubscribe one_click → intent + execution enqueue; mailto →
 *     intent only (D230)
 *   - quiet-state deferral (U18 seam)
 *   - protect re-check at execution time → dismissed
 *   - per-rule daily cap → over-cap matches stay pending
 *   - paused rule → matches skipped
 *   - pending (unapproved) matches never execute
 *   - downgrade before execution leaves approved matches unapplied
 *   - 0-affected execution → audit row, no undo token
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-06-10T08:00:00Z');

type Db = Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
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

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'WS', tier: 'pro' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

async function setMailboxTier(db: Db, mailboxAccountId: string, tier: 'free' | 'plus') {
  const [mailbox] = await db
    .select({ workspaceId: mailboxAccounts.workspaceId })
    .from(mailboxAccounts)
    .where(eq(mailboxAccounts.id, mailboxAccountId))
    .limit(1);
  if (!mailbox) throw new Error(`mailbox ${mailboxAccountId} not found`);
  await db.update(workspaces).set({ tier }).where(eq(workspaces.id, mailbox.workspaceId));
}

async function seedSender(
  db: Db,
  mailboxAccountId: string,
  email: string,
  opts: {
    inboxMessages?: number;
    unsubscribeMethod?: 'one_click' | 'mailto' | 'none';
    unsubscribeUrl?: string | null;
  } = {},
): Promise<{ senderKey: string; senderId: string }> {
  const senderKey = await deriveSenderKey(email);
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      displayName: email,
      email,
      domain: email.split('@')[1] ?? '',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      lastSeenAt: NOW,
      unsubscribeMethod: opts.unsubscribeMethod ?? 'none',
      unsubscribeUrl: opts.unsubscribeUrl ?? null,
    })
    .returning({ id: senders.id });
  for (let i = 0; i < (opts.inboxMessages ?? 0); i += 1) {
    await db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 8)}-${i}`,
      providerThreadId: `t-${senderKey.slice(0, 8)}-${i}`,
      senderKey,
      internalDate: NOW,
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      isUnread: true,
    });
  }
  return { senderKey, senderId: s!.id };
}

/** Enable a preset and return its rule id. */
async function enablePreset(
  db: Db,
  mailboxAccountId: string,
  presetKey: string,
  mode: 'observe' | 'active' | 'paused' = 'active',
  enabled = true,
): Promise<string> {
  await db
    .update(automationRules)
    .set({ enabled, mode })
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxAccountId),
        eq(automationRules.presetKey, presetKey),
      ),
    );
  const [row] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxAccountId),
        eq(automationRules.presetKey, presetKey),
      ),
    );
  return row!.id;
}

/** Insert an approved-unapplied match row (what the apply worker writes for Active mode). */
async function seedApprovedMatch(
  db: Db,
  mailboxAccountId: string,
  ruleId: string,
  senderKey: string,
  resolution: 'approved' | 'pending' | 'dismissed' = 'approved',
): Promise<string> {
  const [row] = await db
    .insert(ruleMatchLog)
    .values({
      ruleId,
      mailboxAccountId,
      senderKey,
      matchedAt: NOW,
      modeAtMatch: resolution === 'pending' ? 'observe' : 'active',
      confidence: '0.90',
      reason: 'test match',
      intentApplied: false,
      resolution,
    })
    .returning({ id: ruleMatchLog.id });
  return row!.id;
}

/** Fake mutation client — records batchModify calls (mirrors label-action tests). */
class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[]; change: LabelChange }[] = [];
  labelIdsByName = new Map<string, string>();
  async modifyLabels(): Promise<void> {}
  async batchModify(messageIds: string[], change: LabelChange): Promise<void> {
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

function fakeAccess(client: GmailMutationClient): GmailMutationAccess {
  return { getClient: async () => client };
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'AutopilotActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('AutopilotActionWorker', () => {
  let db: Db;
  let mailboxId: string;
  let gmail: FakeMutationClient;
  let unsubJobs: UnsubExecutionJobData[];
  let worker: AutopilotActionWorker;

  function buildWorker(overrides: Partial<AutopilotActionDeps> = {}): AutopilotActionWorker {
    return new AutopilotActionWorker({
      db: db as never,
      gmailMutation: fakeAccess(gmail),
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
      enqueueUnsubExecution: async (data) => {
        unsubJobs.push(data);
      },
      now: () => NOW,
      ...overrides,
    });
  }

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mailboxId);
    gmail = new FakeMutationClient();
    unsubJobs = [];
    worker = buildWorker();
  });

  it('Pro executes an approved archive match end-to-end with autopilot attribution', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', {
      inboxMessages: 3,
    });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.labelActionsExecuted).toBe(1);
    expect(result.matchesConsidered).toBe(1);

    // Gmail mutation fired on the 3 inbox ids, removing INBOX.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toHaveLength(3);
    expect(gmail.calls[0]!.change.removeLabelIds).toContain('INBOX');

    // Undo journal row issued.
    const undoRows = await db.select().from(undoJournal);
    expect(undoRows).toHaveLength(1);
    expect(undoRows[0]!.actionKind).toBe('archive');

    // Activity row: source='autopilot', rule_id set, token joined.
    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]!.source).toBe('autopilot');
    expect(activity[0]!.ruleId).toBe(ruleId);
    expect(activity[0]!.action).toBe('archive');
    expect(activity[0]!.affectedCount).toBe(3);
    expect(activity[0]!.undoToken).toBe(undoRows[0]!.token);

    // Local mirror: INBOX stripped.
    const msgs = await db
      .select({ labelIds: mailMessages.labelIds })
      .from(mailMessages)
      .where(eq(mailMessages.senderKey, senderKey));
    for (const m of msgs) {
      expect(m.labelIds).not.toContain('INBOX');
    }

    // Match flipped with the undo token.
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(true);
    expect(match!.intentToken).toBe(undoRows[0]!.token);

    // action_jobs row done with the autopilot idempotency key.
    const [job] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `autopilot-${matchId}`));
    expect(job!.status).toBe('done');
    expect(job!.undoToken).toBe(undoRows[0]!.token);

    // Outbox event emitted.
    const events = await db.select().from(outboxEvents);
    const emitted = events.filter((e) => e.topic === TOPICS.AUTOPILOT_ACTION_INTENT_EMITTED);
    expect(emitted).toHaveLength(1);
    expect((emitted[0]!.payload as { matchId: string }).matchId).toBe(matchId);
  });

  it('captures the one-week wake time for an approved Later match (D245)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_screen_new_senders');
    const { senderKey } = await seedSender(db, mailboxId, 'new@shop.com', { inboxMessages: 1 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    await worker.processJob({ mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() }, CTX);

    const [job] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `autopilot-${matchId}`));
    expect(job!.verb).toBe('later');
    expect(job!.wakeAt?.toISOString()).toBe('2026-06-17T08:00:00.000Z');

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, TOPICS.ACTION_LABEL_APPLIED));
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { wakeAt: string }).wakeAt).toBe('2026-06-17T08:00:00.000Z');
  });

  it.each(['free', 'plus'] as const)(
    'does not execute an approved match after downgrade to %s',
    async (tier) => {
      const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
      const { senderKey } = await seedSender(db, mailboxId, `${tier}@shop.com`, {
        inboxMessages: 2,
      });
      const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

      await setMailboxTier(db, mailboxId, tier);
      const result = await worker.processJob(
        { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
        CTX,
      );

      expect(result.matchesConsidered).toBe(0);
      expect(result.labelActionsExecuted).toBe(0);
      expect(result.unsubscribeIntentsRecorded).toBe(0);
      expect(gmail.calls).toHaveLength(0);
      expect(await db.select().from(actionJobs)).toHaveLength(0);
      expect(await db.select().from(activityLog)).toHaveLength(0);
      expect(await db.select().from(undoJournal)).toHaveLength(0);
      expect(await db.select().from(outboxEvents)).toHaveLength(0);
      const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
      expect(match!.intentApplied).toBe(false);
      expect(match!.resolution).toBe('approved');
    },
  );

  it('is idempotent — a replayed sweep does not duplicate mutations or audit rows', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 2 });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    await worker.processJob({ mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() }, CTX);
    const replay = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() + 1 },
      CTX,
    );

    expect(replay.matchesConsidered).toBe(0);
    expect(gmail.calls).toHaveLength(1);
    expect(await db.select().from(activityLog)).toHaveLength(1);
    expect(await db.select().from(undoJournal)).toHaveLength(1);
  });

  it('records a 0-affected decision when the sender has no inbox mail', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'empty@shop.com', { inboxMessages: 0 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.labelActionsExecuted).toBe(1);
    expect(gmail.calls).toHaveLength(0);
    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]!.affectedCount).toBe(0);
    expect(activity[0]!.undoToken).toBeNull();
    expect(activity[0]!.ruleId).toBe(ruleId);
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(true);
    expect(match!.intentToken).toBeNull();
  });

  it('unsubscribe one_click: records intent + outbox event + enqueues execution', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_unsubscribe_noisy');
    const { senderKey } = await seedSender(db, mailboxId, 'list@news.com', {
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://news.com/unsub',
    });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.unsubscribeIntentsRecorded).toBe(1);
    expect(result.unsubscribeExecutionsEnqueued).toBe(1);
    expect(unsubJobs).toHaveLength(1);
    expect(unsubJobs[0]!.idempotencyKey).toBe(`autopilot-unsubexec-${matchId}`);
    expect(unsubJobs[0]!.source).toBe('autopilot');
    expect(unsubJobs[0]!.ruleId).toBe(ruleId);

    // Activity: unsubscribe decision, autopilot-attributed, no undo (D58).
    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]!.action).toBe('unsubscribe');
    expect(activity[0]!.source).toBe('autopilot');
    expect(activity[0]!.ruleId).toBe(ruleId);
    expect(activity[0]!.undoToken).toBeNull();

    // The senders-owned projection event was published with the method.
    const events = await db.select().from(outboxEvents);
    const intent = events.filter((e) => e.topic === TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED);
    expect(intent).toHaveLength(1);
    expect((intent[0]!.payload as { method: string }).method).toBe('one_click');

    // Execution action_jobs row queued for the UnsubExecutionWorker.
    const [exec] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.idempotencyKey, `autopilot-unsubexec-${matchId}`));
    expect(exec!.status).toBe('queued');
    expect(exec!.verb).toBe('unsubscribe');

    // Match flipped; no token for unsub.
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(true);
    expect(match!.intentToken).toBeNull();
  });

  it('unsubscribe mailto: records intent, never auto-sends (D230)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_unsubscribe_noisy');
    const { senderKey } = await seedSender(db, mailboxId, 'paper@mailer.com', {
      unsubscribeMethod: 'mailto',
      unsubscribeUrl: 'mailto:unsub@mailer.com',
    });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.unsubscribeIntentsRecorded).toBe(1);
    expect(result.unsubscribeExecutionsEnqueued).toBe(0);
    expect(unsubJobs).toHaveLength(0);
    // No execution action_jobs row at all for mailto.
    expect(await db.select().from(actionJobs)).toHaveLength(0);
    const events = await db.select().from(outboxEvents);
    const intent = events.filter((e) => e.topic === TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED);
    expect((intent[0]!.payload as { method: string }).method).toBe('mailto');
    const activities = await db.select().from(activityLog);
    expect(activities.map((a) => a.action)).toEqual(['unsubscribe', 'unsubscribe_action_required']);
    expect(activities.every((a) => a.source === 'autopilot' && a.ruleId === ruleId)).toBe(true);
  });

  it('unsubscribe enqueue failure records a canonical failed outcome', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_unsubscribe_noisy');
    const { senderKey } = await seedSender(db, mailboxId, 'failed@news.com', {
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://news.com/unsub',
    });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey);
    worker = buildWorker({
      enqueueUnsubExecution: async () => {
        throw new Error('redis unavailable');
      },
    });

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );
    expect(result.unsubscribeExecutionsEnqueued).toBe(0);
    const [job] = await db.select().from(actionJobs);
    expect(job!).toMatchObject({ status: 'failed', errorCode: 'ENQUEUE_FAILED' });
    const activities = await db.select().from(activityLog);
    expect(activities.map((a) => a.action)).toEqual(['unsubscribe', 'unsubscribe_failed']);
    const events = await db.select().from(outboxEvents);
    expect(events.map((e) => e.topic)).toEqual([
      TOPICS.ACTIONS_UNSUBSCRIBE_INTENT_RECORDED,
      TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED,
    ]);
  });

  it('defers the whole sweep while quiet state is active (U18 seam)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    await db
      .update(mailboxAccounts)
      .set({
        quietState: {
          enabled: true,
          started_at: NOW.toISOString(),
          until_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
          source: 'manual',
        },
      })
      .where(eq(mailboxAccounts.id, mailboxId));

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.deferredQuiet).toBe(true);
    expect(result.labelActionsExecuted).toBe(0);
    expect(gmail.calls).toHaveLength(0);
    // Match stays eligible for the post-quiet sweep.
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(false);
    expect(match!.resolution).toBe('approved');
  });

  it('defers when the recurring quiet-hours window covers now (U18 — D92/D93)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    // NOW = 2026-06-10T08:00:00Z = 13:30 IST → window 13:00–14:00 IST
    // covers it. Manual toggle stays OFF — only the window defers.
    await db
      .update(mailboxAccounts)
      .set({
        quietState: {
          quiet_hours: {
            enabled: true,
            start_local: '13:00',
            end_local: '14:00',
            timezone: 'Asia/Kolkata',
            updated_at: NOW.toISOString(),
          },
        },
      })
      .where(eq(mailboxAccounts.id, mailboxId));

    const deferred: Array<{ mailboxAccountId: string; resumeAfterMs: number | null }> = [];
    worker = buildWorker({
      onQuietDeferred: async (id, resumeAfterMs) => {
        deferred.push({ mailboxAccountId: id, resumeAfterMs });
      },
    });

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.deferredQuiet).toBe(true);
    expect(result.labelActionsExecuted).toBe(0);
    expect(gmail.calls).toHaveLength(0);
    // Re-schedule hook fired with the minutes-until-window-end hint
    // (13:30 → 14:00 IST = 30 min).
    expect(deferred).toEqual([{ mailboxAccountId: mailboxId, resumeAfterMs: 30 * 60_000 }]);
    // Match stays durable — deferral never drops an action.
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(false);
    expect(match!.resolution).toBe('approved');
  });

  it('executes normally when the quiet-hours window does NOT cover now', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    // NOW = 13:30 IST; window 22:00–06:00 IST does not cover it.
    await db
      .update(mailboxAccounts)
      .set({
        quietState: {
          quiet_hours: {
            enabled: true,
            start_local: '22:00',
            end_local: '06:00',
            timezone: 'Asia/Kolkata',
            updated_at: NOW.toISOString(),
          },
        },
      })
      .where(eq(mailboxAccounts.id, mailboxId));

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.deferredQuiet).toBe(false);
    expect(result.labelActionsExecuted).toBe(1);
    expect(gmail.calls).toHaveLength(1);
  });

  it('a failing onQuietDeferred hook is swallowed — the sweep still defers cleanly', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    await db
      .update(mailboxAccounts)
      .set({
        quietState: { enabled: true, source: 'manual' },
      })
      .where(eq(mailboxAccounts.id, mailboxId));

    worker = buildWorker({
      onQuietDeferred: async () => {
        throw new Error('redis down');
      },
    });

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.deferredQuiet).toBe(true);
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(false);
  });

  it('dismisses matches whose sender became Protected after matching', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'bank@bank.com', { inboxMessages: 2 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey,
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: NOW,
    });

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.skippedProtected).toBe(1);
    expect(result.labelActionsExecuted).toBe(0);
    expect(gmail.calls).toHaveLength(0);
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.resolution).toBe('dismissed');
    expect(match!.dismissReason).toBe('protected');
    expect(match!.intentApplied).toBe(false);
  });

  it('enforces the per-rule daily cap and leaves over-cap matches pending', async () => {
    // auto_unsubscribe_noisy has dailyActionCap=25 — fill the window.
    const ruleId = await enablePreset(db, mailboxId, 'auto_unsubscribe_noisy');
    const { senderKey } = await seedSender(db, mailboxId, 'list@news.com', {
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://news.com/unsub',
    });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);
    await db.insert(activityLog).values(
      Array.from({ length: 25 }, () => ({
        mailboxAccountId: mailboxId,
        senderKey,
        source: 'autopilot' as const,
        action: 'unsubscribe' as const,
        affectedCount: 0,
        ruleId,
        occurredAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      })),
    );

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.skippedCapped).toBe(1);
    expect(result.unsubscribeIntentsRecorded).toBe(0);
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(false);
    expect(match!.resolution).toBe('approved');
  });

  it('label-rule cap counts only rows that moved messages (0-affected rows are free)', async () => {
    // auto_archive_low_engagement has dailyActionCap=100. Fill the
    // window with 100 ZERO-affected decision rows (the re-sweep noise
    // case) — the budget must still be open for real work.
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 2 });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);
    await db.insert(activityLog).values(
      Array.from({ length: 100 }, () => ({
        mailboxAccountId: mailboxId,
        senderKey,
        source: 'autopilot' as const,
        action: 'archive' as const,
        affectedCount: 0,
        ruleId,
        occurredAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      })),
    );

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.skippedCapped).toBe(0);
    expect(result.labelActionsExecuted).toBe(1);
    expect(gmail.calls).toHaveLength(1);
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(true);
  });

  it('no-ops an unsub match for an already-unsubscribed sender (no duplicate intent)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_unsubscribe_noisy');
    const { senderKey } = await seedSender(db, mailboxId, 'list@news.com', {
      unsubscribeMethod: 'one_click',
      unsubscribeUrl: 'https://news.com/unsub',
    });
    // The senders-owned projection of a previously recorded intent.
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey,
      policyType: 'unsubscribe',
      unsubStatus: 'done',
    });
    const matchId = await seedApprovedMatch(db, mailboxId, ruleId, senderKey);

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.skippedAlreadyUnsubscribed).toBe(1);
    expect(result.unsubscribeIntentsRecorded).toBe(0);
    expect(unsubJobs).toHaveLength(0);
    // Terminal no-op: match applied with no token, no new audit row.
    const [match] = await db.select().from(ruleMatchLog).where(eq(ruleMatchLog.id, matchId));
    expect(match!.intentApplied).toBe(true);
    expect(match!.intentToken).toBeNull();
    expect(await db.select().from(activityLog)).toHaveLength(0);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });

  it('skips matches whose rule was paused after approval (D105)', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey);
    await db.update(automationRules).set({ mode: 'paused' }).where(eq(automationRules.id, ruleId));

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.skippedRuleInactive).toBe(1);
    expect(gmail.calls).toHaveLength(0);
  });

  it('never executes pending (unapproved) Observe-mode matches', async () => {
    const ruleId = await enablePreset(db, mailboxId, 'auto_archive_low_engagement', 'observe');
    const { senderKey } = await seedSender(db, mailboxId, 'noisy@shop.com', { inboxMessages: 1 });
    await seedApprovedMatch(db, mailboxId, ruleId, senderKey, 'pending');

    const result = await worker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      CTX,
    );

    expect(result.matchesConsidered).toBe(0);
    expect(gmail.calls).toHaveLength(0);
  });
});

describe('isQuietStateActive', () => {
  const now = new Date('2026-06-10T08:00:00Z');

  it('is false for the empty default jsonb', () => {
    expect(isQuietStateActive({}, now)).toBe(false);
  });

  it('is false when enabled is not exactly true', () => {
    expect(isQuietStateActive({ enabled: false }, now)).toBe(false);
    expect(isQuietStateActive({ enabled: 'yes' }, now)).toBe(false);
    expect(isQuietStateActive(null, now)).toBe(false);
    expect(isQuietStateActive('quiet', now)).toBe(false);
  });

  it('is true when enabled with no until_at (manual indefinite quiet)', () => {
    expect(isQuietStateActive({ enabled: true }, now)).toBe(true);
    expect(isQuietStateActive({ enabled: true, until_at: null }, now)).toBe(true);
  });

  it('respects a future vs past until_at', () => {
    expect(isQuietStateActive({ enabled: true, until_at: '2026-06-10T09:00:00Z' }, now)).toBe(true);
    expect(isQuietStateActive({ enabled: true, until_at: '2026-06-10T07:00:00Z' }, now)).toBe(
      false,
    );
  });

  it('treats an unparseable until_at as active (defer on ambiguity)', () => {
    expect(isQuietStateActive({ enabled: true, until_at: 'garbage' }, now)).toBe(true);
    expect(isQuietStateActive({ enabled: true, until_at: 42 }, now)).toBe(true);
  });
});
