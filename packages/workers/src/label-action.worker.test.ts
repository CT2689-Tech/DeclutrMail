import type { schema } from '@declutrmail/db';
import {
  actionJobs,
  activityLog,
  mailMessages,
  mailboxAccounts,
  outboxEvents,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { undoWindowDaysFor } from '@declutrmail/shared/entitlements';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionVerb } from '@declutrmail/shared/actions';

import type {
  BatchModifyOptions,
  GmailMutationAccess,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import {
  LABEL_SENDER_PROTECTED_ERROR_CODE,
  LabelActionWorker,
  labelChangeForVerb,
  PASSTHROUGH_MAILBOX_LOCK,
  RECOVERY_SENDER_PROTECTED_ERROR_CODE,
} from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import {
  InvalidGrantError,
  PermanentError,
  RateLimitError,
  TransientError,
  ValidationError,
} from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/**
 * LabelActionWorker integration tests (D226).
 *
 * Real worker against in-process PGlite with every migration applied —
 * exercises the durable-set + idempotent-mutation + undo/activity/event
 * terminal-tx invariants from the Codex review, plus the score.worker
 * regression (the manual-archive `activity_log` row it reads).
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

const SENDER_KEY = 'a'.repeat(64);

async function seedMailbox(db: Db): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
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

async function seedSender(db: Db, mailboxAccountId: string): Promise<string> {
  const [s] = await db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey: SENDER_KEY,
      email: 'news@shop.example',
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
  providerMessageId: string,
  labelIds: string[],
  isOutbound = false,
): Promise<void> {
  await db.insert(mailMessages).values({
    mailboxAccountId,
    providerMessageId,
    providerThreadId: `t-${providerMessageId}`,
    senderKey: SENDER_KEY,
    internalDate: new Date('2026-05-01'),
    isUnread: false,
    labelIds,
    isOutbound,
  });
}

/**
 * Fake mutation client that records every batchModify call, in production's
 * order: the quota wait and token refresh (`throwBeforeSend`) can fail
 * before `beforeFirstRequest` runs; Gmail's answer (`shouldThrow`) comes
 * after it.
 */
class FakeMutationClient implements GmailMutationClient {
  calls: { ids: string[]; change: LabelChange }[] = [];
  shouldThrow: Error | null = null;
  throwBeforeSend: Error | null = null;
  /** Runs where the quota wait sits — after "starting", before the hook. */
  duringQuotaWait: (() => Promise<void>) | null = null;
  /** Runs at the moment the request would leave. */
  onSend: (() => Promise<void>) | null = null;
  /** `shouldThrow` fires only once this many calls have gone through. */
  failAfterCalls = 0;
  /** A client that drops the option — what a careless wrapper would do. */
  ignoreHook = false;
  /** User labels known to the fake "Gmail" (name → id). */
  labelIdsByName = new Map<string, string>();
  ensureLabelIdCalls: string[] = [];
  async modifyLabels(): Promise<void> {}
  async batchModify(
    messageIds: string[],
    change: LabelChange,
    opts: BatchModifyOptions = {},
  ): Promise<void> {
    if (this.duringQuotaWait) await this.duringQuotaWait();
    if (this.throwBeforeSend) throw this.throwBeforeSend;
    if (!this.ignoreHook) await opts.beforeFirstRequest?.();
    if (this.onSend) await this.onSend();
    if (this.shouldThrow && this.calls.length >= this.failAfterCalls) throw this.shouldThrow;
    this.calls.push({ ids: [...messageIds], change });
  }
  async ensureLabelId(name: string): Promise<string> {
    this.ensureLabelIdCalls.push(name);
    const existing = this.labelIdsByName.get(name);
    if (existing) {
      return existing;
    }
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
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

describe('LabelActionWorker', () => {
  let db: Db;
  let mailboxId: string;
  let gmail: FakeMutationClient;
  let worker: LabelActionWorker;

  beforeEach(async () => {
    db = await freshDb();
    mailboxId = await seedMailbox(db);
    await seedSender(db, mailboxId);
    gmail = new FakeMutationClient();
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: fakeAccess(gmail),
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
  });

  describe('forward archive — sender selector', () => {
    beforeEach(async () => {
      await seedMessage(db, mailboxId, 'm1', ['INBOX', 'CATEGORY_PROMOTIONS']);
      await seedMessage(db, mailboxId, 'm2', ['INBOX']);
      await seedMessage(db, mailboxId, 'm3', ['CATEGORY_PROMOTIONS']); // not in inbox
    });

    it('excludes outbound self-sent mail from the resolved set (finding 5.5)', async () => {
      // Self-CC mail carries SENT + INBOX and is_outbound=true. The
      // composite preview never counts it, so the worker must never
      // move it — preview and execution resolve ONE predicate (D226).
      await seedMessage(db, mailboxId, 'self-cc', ['SENT', 'INBOX'], true);

      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-outbound',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-outbound' },
        CTX,
      );

      expect(gmail.calls).toHaveLength(1);
      expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
      expect(result.affectedCount).toBe(2);
    });

    it('resolves inbox-only, mutates, and writes the full terminal tx', async () => {
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-1',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-1' },
        CTX,
      );

      // Only the two INBOX messages, INBOX removed.
      expect(gmail.calls).toHaveLength(1);
      expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
      expect(gmail.calls[0]!.change).toEqual({ removeLabelIds: ['INBOX'] });
      expect(result.affectedCount).toBe(2);
      expect(result.undoToken).not.toBeNull();

      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
      expect(row!.status).toBe('done');
      expect(row!.affectedCount).toBe(2);
      expect(row!.undoToken).toBe(result.undoToken);
      expect(row!.resolvedMessageIds.sort()).toEqual(['m1', 'm2']);

      // Undo journal issued with ids-only payload.
      const [undo] = await db
        .select()
        .from(undoJournal)
        .where(eq(undoJournal.token, result.undoToken!));
      expect(undo!.actionKind).toBe('archive');
      expect((undo!.payload as { messageIds: string[] }).messageIds.sort()).toEqual(['m1', 'm2']);

      // Activity row (the one score.worker reads).
      const [act] = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.mailboxAccountId, mailboxId));
      expect(act!.source).toBe('manual');
      expect(act!.action).toBe('archive');
      expect(act!.affectedCount).toBe(2);
      expect(act!.senderKey).toBe(SENDER_KEY);
      expect(act!.undoToken).toBe(result.undoToken);

      // Outbox event published.
      const [evt] = await db.select().from(outboxEvents);
      expect(evt!.topic).toBe('actions.label_action_applied');

      // Local label mirror updated — INBOX gone from m1/m2, m3 untouched.
      const msgs = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailboxId));
      const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
      expect(byId['m1']).not.toContain('INBOX');
      expect(byId['m2']).not.toContain('INBOX');
      expect(byId['m3']).toContain('CATEGORY_PROMOTIONS');
    });

    // COVERAGE NOTE. The windows are DERIVED now, not the literals
    // 7 and 30 this test used to carry. Since 2026-08-23 every tier
    // shares a 30-day window, so the "resolves from the TIER" half of
    // this test no longer discriminates — a snapshot that ignored the
    // tier entirely would pass it. What still holds, and is what the
    // assertions below actually pin: the window is stamped at action
    // time from the manifest, and an already-issued token is never
    // rewritten by a later tier change. If the ladder ever splits the
    // window again, this test regains its teeth with no edit.
    it('undo window is stamped from the tier AT ACTION TIME and never rewritten', async () => {
      const DAY = 24 * 60 * 60 * 1000;
      const freeDays = undoWindowDaysFor('free');
      const proDays = undoWindowDaysFor('pro');
      // Seeded workspace defaults to tier='free', snapshotted
      // explicitly onto undo_journal.expires_at.
      const [freeJob] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-tier-free',
        })
        .returning();
      const freeResult = await worker.processJob(
        { actionId: freeJob!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-tier-free' },
        CTX,
      );
      const [freeUndo] = await db
        .select()
        .from(undoJournal)
        .where(eq(undoJournal.token, freeResult.undoToken!));
      expect(freeUndo!.expiresAt.getTime()).toBeGreaterThan(Date.now() + (freeDays - 1) * DAY);
      expect(freeUndo!.expiresAt.getTime()).toBeLessThan(Date.now() + (freeDays + 1) * DAY);

      // Flip the workspace to pro — the NEXT action snapshots 30d (the
      // already-issued 7d token above is untouched: downgrade/upgrade
      // semantics resolve at action time, never retroactively).
      await db.update(workspaces).set({ tier: 'pro' });
      await seedMessage(db, mailboxId, 'm4', ['INBOX']);
      const [proJob] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-tier-pro',
        })
        .returning();
      const proResult = await worker.processJob(
        { actionId: proJob!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-tier-pro' },
        CTX,
      );
      const [proUndo] = await db
        .select()
        .from(undoJournal)
        .where(eq(undoJournal.token, proResult.undoToken!));
      expect(proUndo!.expiresAt.getTime()).toBeGreaterThan(Date.now() + (proDays - 1) * DAY);
      expect(proUndo!.expiresAt.getTime()).toBeLessThan(Date.now() + (proDays + 1) * DAY);
      // The earlier token still carries the window it was issued with.
      expect(freeUndo!.expiresAt.getTime()).toBeLessThan(Date.now() + (freeDays + 1) * DAY);
    });

    it('is idempotent on a done row (no second mutation)', async () => {
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'archive',
          direction: 'forward',
          status: 'done',
          affectedCount: 2,
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-done',
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-done' },
        CTX,
      );
      expect(result.alreadyDone).toBe(true);
      expect(gmail.calls).toHaveLength(0);
    });
  });

  it('forward archive — empty resolve writes 0-affected activity_log row but issues no undo token', async () => {
    // Sender has no INBOX messages.
    await seedMessage(db, mailboxId, 'm9', ['CATEGORY_PROMOTIONS']);
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        idempotencyKey: 'idem-empty',
      })
      .returning();
    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-empty' },
      CTX,
    );
    expect(result.affectedCount).toBe(0);
    expect(result.undoToken).toBeNull();
    expect(gmail.calls).toHaveLength(0);
    const undos = await db.select().from(undoJournal);
    expect(undos).toHaveLength(0);
    // 2026-06-05 — audit-trail consistency: the user MADE a decision
    // (Archive on this sender). Even when nothing matched, the
    // activity_log row exists so /activity surfaces the intent —
    // matches the Keep precedent (0-message decisions logged).
    const acts = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.action).toBe('archive');
    expect(acts[0]!.affectedCount).toBe(0);
    expect(acts[0]!.senderKey).toBe(SENDER_KEY);
    expect(acts[0]!.undoToken).toBeNull();
    expect(acts[0]!.actionJobId).toBe(job!.id);
    // Terminal-success event still fires (undoToken null) so the
    // Screener quarantine resolver learns the decision completed even
    // when nothing matched (the ghost-pending TOCTOU fix).
    const evts = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, 'actions.label_action_applied'));
    expect(evts).toHaveLength(1);
    expect((evts[0]!.payload as { undoToken: string | null }).undoToken).toBeNull();
    expect((evts[0]!.payload as { affectedCount: number }).affectedCount).toBe(0);
  });

  it('refuses a fresh forward message-list job — no sender to check Protected against (D245)', async () => {
    // No product surface enqueues this shape any more; a frozen id list
    // can span senders, so the Protected re-check has nothing to key on.
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        requestedCount: 1,
        idempotencyKey: 'idem-msgs',
      })
      .returning();

    await expect(
      worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-msgs' },
        CTX,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(gmail.calls).toHaveLength(0);
  });

  it('a recovery attempt of a legacy message-list action still applies its frozen set', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    await seedMessage(db, mailboxId, 'm2', ['INBOX']);
    const [root] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1', 'm2'],
        status: 'failed',
        idempotencyKey: 'idem-msgs-root',
      })
      .returning();
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1', 'm2'],
        requestedCount: 2,
        idempotencyKey: 'idem-msgs-recovery',
        rootActionId: root!.id,
        retryOfActionId: root!.id,
        recoveryAttempt: 1,
        selectionFrozenAt: new Date(),
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-msgs-recovery' },
      CTX,
    );
    expect(gmail.calls[0]!.ids.sort()).toEqual(['m1', 'm2']);
    const [act] = await db.select().from(activityLog);
    expect(act!.senderKey).toBeNull(); // messages selector → account-scoped
    expect(result.affectedCount).toBe(2);
  });

  // A legacy message-list retry has no single sender; its review asks
  // whether ANY of its senders is Protected, and so does its execution.
  it('stops a message-list retry when any of its senders turned Protected after review', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    const [root] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        status: 'failed',
        idempotencyKey: 'idem-msgs-root-p',
      })
      .returning();
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        requestedCount: 1,
        idempotencyKey: 'idem-msgs-recovery-p',
        rootActionId: root!.id,
        retryOfActionId: root!.id,
        recoveryAttempt: 1,
        selectionFrozenAt: new Date(),
      })
      .returning();
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY,
      isProtected: true,
      protectionReason: 'starred',
      protectionSetAt: new Date(),
    });

    await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-msgs-recovery-p' },
      CTX,
    );

    expect(gmail.calls).toHaveLength(0);
    const [after] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
    expect(after).toMatchObject({
      status: 'failed',
      errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
    });
  });

  it('reverse (undo) re-adds INBOX and flips reverted_at', async () => {
    await seedMessage(db, mailboxId, 'm1', ['CATEGORY_PROMOTIONS']); // archived (no INBOX)
    const [undo] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'archive',
        payload: { kind: 'archive', messageIds: ['m1'], priorLabels: ['INBOX'] },
      })
      .returning();
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'reverse',
        selector: { type: 'messages' },
        resolvedMessageIds: ['m1'],
        undoToken: undo!.token,
        idempotencyKey: `revert:${undo!.token}`,
      })
      .returning();
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      source: 'manual',
      action: 'archive',
      affectedCount: 1,
      undoToken: undo!.token,
    });

    await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: `revert:${undo!.token}` },
      CTX,
    );

    expect(gmail.calls[0]!.change).toEqual({ addLabelIds: ['INBOX'] });
    const [m] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerMessageId, 'm1'));
    expect(m!.labelIds).toContain('INBOX');
    const [u] = await db.select().from(undoJournal).where(eq(undoJournal.token, undo!.token));
    expect(u!.revertedAt).not.toBeNull();
    const [activity] = await db.select().from(activityLog);
    expect(activity!.revertedAt).not.toBeNull();
    const [j] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
    expect(j!.status).toBe('done');
  });

  describe('later — label name→id resolution (live-smoke fix 2026-06-09)', () => {
    // The registry's buildLabelChange emits the symbolic NAME
    // `DeclutrMail/Later`; Gmail's batchModify accepts only IDS (live
    // result: `Gmail returned 400: Invalid label: DeclutrMail/Later`).
    // The worker resolves the name via ensureLabelId at the mutation
    // seam, and the RESOLVED id feeds the local mirror so it matches
    // what sync stores.
    it('forward resolves DeclutrMail/Later to an id — batchModify + mirror carry only ids', async () => {
      await seedMessage(db, mailboxId, 'l1', ['INBOX', 'CATEGORY_PROMOTIONS']);
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        snoozedUntil: new Date('2098-07-21T09:00:00Z'),
        snoozedAt: new Date('2026-07-14T17:00:00Z'),
        snoozeWakeLastAttemptAt: new Date('2026-07-14T17:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-07-14T17:01:00Z'),
        snoozeWakeFailureCount: 1,
        snoozeWakeFailureKind: 'temporary',
      });
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-later-1',
          wakeAt: new Date('2099-07-21T09:00:00Z'),
        })
        .returning();

      const result = await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-later-1' },
        CTX,
      );

      // Only the user label resolves; INBOX is a system id and must NOT
      // pass through ensureLabelId.
      expect(gmail.ensureLabelIdCalls).toEqual(['DeclutrMail/Later']);
      expect(gmail.calls).toHaveLength(1);
      expect(gmail.calls[0]!.change).toEqual({
        removeLabelIds: ['INBOX'],
        addLabelIds: ['Label_1'],
      });
      expect(result.affectedCount).toBe(1);

      // The local mirror stores the RESOLVED id — the same raw Gmail
      // label id sync stores — never the name.
      const [m] = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.providerMessageId, 'l1'));
      expect(m!.labelIds).toContain('Label_1');
      expect(m!.labelIds).not.toContain('DeclutrMail/Later');
      expect(m!.labelIds).not.toContain('INBOX');
      expect(m!.labelIds).toContain('CATEGORY_PROMOTIONS');
      const [policy] = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policy!.senderKey).toBe(SENDER_KEY);
      expect(policy!.snoozedUntil?.toISOString()).toBe('2099-07-21T09:00:00.000Z');
      expect(policy!.snoozedAt).not.toBeNull();
      expect(policy!.snoozeWakeLastAttemptAt).toBeNull();
      expect(policy!.snoozeWakeLastFailedAt).toBeNull();
      expect(policy!.snoozeWakeFailureCount).toBe(0);
      const [evt] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, job!.id));
      expect((evt!.payload as { wakeAt: string }).wakeAt).toBe('2099-07-21T09:00:00.000Z');
    });

    it('reverse (undo later) removes the resolved id from Gmail and the mirror', async () => {
      // Forward already ran: the label exists in "Gmail" and the message
      // mirror carries the resolved id (as sync would have stored it).
      gmail.labelIdsByName.set('DeclutrMail/Later', 'Label_77');
      await seedMessage(db, mailboxId, 'l1', ['Label_77', 'CATEGORY_PROMOTIONS']);
      const [undo] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'later',
          payload: { kind: 'later', messageIds: ['l1'], priorLabels: ['INBOX'] },
        })
        .returning();
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'reverse',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          resolvedMessageIds: ['l1'],
          undoToken: undo!.token,
          idempotencyKey: `revert:${undo!.token}`,
          wakeAt: new Date('2099-07-21T09:00:00Z'),
        })
        .returning();
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        snoozedUntil: new Date('2099-07-21T09:00:00Z'),
        snoozedAt: new Date('2026-07-14T18:00:00Z'),
        snoozeWakeLastAttemptAt: new Date('2026-07-14T18:01:00Z'),
        snoozeWakeLastFailedAt: new Date('2026-07-14T18:01:00Z'),
        snoozeWakeFailureCount: 1,
        snoozeWakeFailureKind: 'temporary',
      });

      await worker.processJob(
        { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: `revert:${undo!.token}` },
        CTX,
      );

      // The reverse resolves to the EXISTING id — the same one the
      // forward path added — so the revert removes the right label.
      expect(gmail.ensureLabelIdCalls).toEqual(['DeclutrMail/Later']);
      expect(gmail.calls[0]!.change).toEqual({
        addLabelIds: ['INBOX'],
        removeLabelIds: ['Label_77'],
      });
      const [m] = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.providerMessageId, 'l1'));
      expect(m!.labelIds).toContain('INBOX');
      expect(m!.labelIds).not.toContain('Label_77');
      const [u] = await db.select().from(undoJournal).where(eq(undoJournal.token, undo!.token));
      expect(u!.revertedAt).not.toBeNull();
      const [policy] = await db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.mailboxAccountId, mailboxId));
      expect(policy!.snoozedUntil).toBeNull();
      expect(policy!.snoozeWakeLastFailedAt).toBeNull();
      expect(policy!.snoozeWakeFailureCount).toBe(0);
    });

    it('fails permanently on attempt 1 for a Gmail 400 (no retry storm)', async () => {
      await seedMessage(db, mailboxId, 'l1', ['INBOX']);
      gmail.shouldThrow = new PermanentError(
        'Gmail returned 400: Invalid label: DeclutrMail/Later',
      );
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'later',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          resolvedMessageIds: ['l1'],
          idempotencyKey: 'idem-400',
          wakeAt: new Date('2099-07-21T09:00:00Z'),
        })
        .returning();

      // attemptsMade=0 → attempt 1 of 5. A deterministic 4xx is terminal
      // HERE: isNonRetryable(PermanentError) short-circuits the attempt
      // cap and onTerminalFailure records status=failed immediately.
      await expect(
        worker.run({
          id: 'job-400',
          data: { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-400' },
          attemptsMade: 0,
        } as never),
      ).rejects.toThrow('Invalid label');

      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
      expect(row!.status).toBe('failed');
      expect(row!.errorCode).toBe('PermanentError');
    });
  });

  it('forward delete — applies TRASH + drops INBOX from local mirror', async () => {
    // Spec v1.2 Decision 1 — delete = batchModify add TRASH + remove INBOX.
    // Two messages currently in INBOX, plus one not in inbox (skipped).
    await seedMessage(db, mailboxId, 'd1', ['INBOX', 'CATEGORY_PROMOTIONS']);
    await seedMessage(db, mailboxId, 'd2', ['INBOX']);
    await seedMessage(db, mailboxId, 'd3', ['CATEGORY_PROMOTIONS']);

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        idempotencyKey: 'idem-del-1',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-1' },
      CTX,
    );

    // Only the two INBOX messages, with the composite TRASH-add + INBOX-remove change.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids.sort()).toEqual(['d1', 'd2']);
    expect(gmail.calls[0]!.change).toEqual({
      addLabelIds: ['TRASH'],
      removeLabelIds: ['INBOX'],
    });
    expect(result.affectedCount).toBe(2);
    expect(result.undoToken).not.toBeNull();

    // Activity log + undo journal kind both record `delete`.
    const [act] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.mailboxAccountId, mailboxId));
    expect(act!.action).toBe('delete');
    const [undo] = await db
      .select()
      .from(undoJournal)
      .where(eq(undoJournal.token, result.undoToken!));
    expect(undo!.actionKind).toBe('delete');
    // Delete undo payload omits priorLabels — reverse `LabelChange` is the
    // restoration step. The partition is measured for EVERY delete (an
    // inbox-only delete's partition is simply the whole set), and the
    // all-mail marker is absent on an inbox-only row.
    const payload = undo!.payload as {
      kind: string;
      messageIds: string[];
      inboxMessageIds: string[];
    };
    expect(payload).toEqual({
      kind: 'delete',
      messageIds: expect.arrayContaining(['d1', 'd2']),
      inboxMessageIds: expect.arrayContaining(['d1', 'd2']),
    });
    expect(payload.inboxMessageIds).toHaveLength(2);
    expect('reach' in payload).toBe(false);
    // Activity Undo follows the seeded workspace's plan window, derived
    // — this asserted a literal 7 days and went stale when the window
    // went uniform at 30. Gmail Trash's separate recovery period
    // remains available in Gmail after that.
    const undoDays = undoWindowDaysFor('free');
    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(undo!.expiresAt.getTime()).toBeGreaterThan(Date.now() + (undoDays - 1) * DAY_MS);
    expect(undo!.expiresAt.getTime()).toBeLessThan(Date.now() + (undoDays + 1) * DAY_MS);

    // Local label mirror: INBOX gone from d1/d2; TRASH added; d3 untouched.
    const msgs = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
    expect(byId['d1']).toContain('TRASH');
    expect(byId['d1']).not.toContain('INBOX');
    expect(byId['d1']).toContain('CATEGORY_PROMOTIONS'); // unrelated labels preserved
    expect(byId['d2']).toContain('TRASH');
    expect(byId['d2']).not.toContain('INBOX');
    expect(byId['d3']).toEqual(['CATEGORY_PROMOTIONS']);
  });

  it('forward delete — olderThanDays narrows the sender resolution', async () => {
    // The worker reads `older_than_days` and applies it to the sender
    // resolver via `internal_date <= now() - interval 'N days'`.
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    await seedMessage(db, mailboxId, 'd-recent', ['INBOX']);
    // Manually backdate one message so the resolver picks ONLY it.
    await db
      .update(mailMessages)
      .set({ internalDate: new Date(now - 200 * oneDay) })
      .where(eq(mailMessages.providerMessageId, 'd-recent'));
    const [oldMsg] = await db
      .insert(mailMessages)
      .values({
        mailboxAccountId: mailboxId,
        providerMessageId: 'd-old',
        providerThreadId: 't-old',
        senderKey: SENDER_KEY,
        internalDate: new Date(now - 400 * oneDay),
        isUnread: false,
        labelIds: ['INBOX'],
      })
      .returning();
    expect(oldMsg).toBeTruthy();

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        olderThanDays: 365,
        idempotencyKey: 'idem-del-365',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-365' },
      CTX,
    );

    // 200-day-old message is NOT picked up; 400-day-old IS.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['d-old']);
    expect(result.affectedCount).toBe(1);
  });

  it('forward delete at all_mail reach — trashes archived mail too, undo restores each side where it was (ADR-0028)', async () => {
    // The full zoo: one inbox message, one archived, plus every excluded
    // class (TRASH / SPAM / DRAFT / CHAT) and an outbound self-send. Only
    // the first two are legal targets at all_mail reach.
    await seedMessage(db, mailboxId, 'a-in', ['INBOX', 'CATEGORY_PROMOTIONS']);
    await seedMessage(db, mailboxId, 'a-arch', ['CATEGORY_PROMOTIONS']);
    await seedMessage(db, mailboxId, 'a-trash', ['TRASH']);
    await seedMessage(db, mailboxId, 'a-spam', ['SPAM']);
    await seedMessage(db, mailboxId, 'a-draft', ['DRAFT']);
    await seedMessage(db, mailboxId, 'a-chat', ['CHAT']);
    await seedMessage(db, mailboxId, 'a-out', ['SENT', 'INBOX'], true);

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        idempotencyKey: 'idem-del-allmail',
        reach: 'all_mail',
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-allmail' },
      CTX,
    );

    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids.sort()).toEqual(['a-arch', 'a-in']);
    expect(gmail.calls[0]!.change).toEqual({ addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
    expect(result.affectedCount).toBe(2);

    // The journal payload records WHICH ids carried INBOX — the undo
    // partition. Without it the revert would re-inbox archived mail.
    const [undo] = await db
      .select()
      .from(undoJournal)
      .where(eq(undoJournal.token, result.undoToken!));
    const payload = undo!.payload as {
      kind: string;
      messageIds: string[];
      inboxMessageIds: string[];
      reach: string;
    };
    expect(payload.kind).toBe('delete');
    expect(payload.messageIds.sort()).toEqual(['a-arch', 'a-in']);
    expect(payload.inboxMessageIds).toEqual(['a-in']);
    // Self-describing (Codex stop-review 2026-07-28): undo semantics
    // must survive the reach COLUMN being reset by a migration
    // rollback + re-apply, so the payload names its own reach.
    expect(payload.reach).toBe('all_mail');

    // Reverse — same shape `enqueueCompositeRevert` persists (frozen
    // ids). The row's reach is deliberately 'inbox_only' here: this is
    // the post-rollback-re-apply corruption, where the column default
    // stamped over history. The PAYLOAD must still drive the split.
    const [reverse] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'reverse',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['a-in', 'a-arch'],
        requestedCount: 2,
        undoToken: result.undoToken!,
        idempotencyKey: `revert-${result.undoToken!}`,
        reach: 'inbox_only',
      })
      .returning();

    await worker.processJob(
      {
        actionId: reverse!.id,
        mailboxAccountId: mailboxId,
        idempotencyKey: `revert-${result.undoToken!}`,
      },
      CTX,
    );

    // Two mutation groups: the inbox subset gets the full registry
    // reverse; the archived subset ONLY drops TRASH (no INBOX re-add).
    expect(gmail.calls).toHaveLength(3);
    expect(gmail.calls[1]!.ids).toEqual(['a-in']);
    expect(gmail.calls[1]!.change).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] });
    expect(gmail.calls[2]!.ids).toEqual(['a-arch']);
    expect(gmail.calls[2]!.change).toEqual({ removeLabelIds: ['TRASH'] });

    // Mirror: both restored to exactly where they were.
    const msgs = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
    expect(byId['a-in']).toContain('INBOX');
    expect(byId['a-in']).not.toContain('TRASH');
    expect(byId['a-arch']).not.toContain('INBOX');
    expect(byId['a-arch']).not.toContain('TRASH');
    expect(byId['a-arch']).toContain('CATEGORY_PROMOTIONS');
    // The excluded classes were never touched.
    expect(byId['a-trash']).toEqual(['TRASH']);
    expect(byId['a-spam']).toEqual(['SPAM']);
    expect(byId['a-draft']).toEqual(['DRAFT']);
    expect(byId['a-chat']).toEqual(['CHAT']);
    expect(byId['a-out']).toEqual(['SENT', 'INBOX']);
  });

  it('reverse delete degrades to archive-only when an all-mail payload lost its partition — never the inbox flood', async () => {
    // Damaged path: the payload says all_mail but its split is gone.
    // The ONLY safe direction is -TRASH for everything: inbox mail
    // resurfacing archived is degraded-but-findable, while a uniform
    // +INBOX would dump the whole archived set into the inbox.
    await seedMessage(db, mailboxId, 'f-1', ['TRASH']);
    const [journal] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'delete',
        payload: { kind: 'delete', messageIds: ['f-1'], reach: 'all_mail' },
      })
      .returning();

    const [reverse] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'reverse',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['f-1'],
        requestedCount: 1,
        undoToken: journal!.token,
        idempotencyKey: `revert-${journal!.token}`,
        // Column also corrupted to the default — either signal alone
        // must be enough, so make the payload carry it.
        reach: 'inbox_only',
      })
      .returning();

    await worker.processJob(
      {
        actionId: reverse!.id,
        mailboxAccountId: mailboxId,
        idempotencyKey: `revert-${journal!.token}`,
      },
      CTX,
    );

    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['f-1']);
    expect(gmail.calls[0]!.change).toEqual({ removeLabelIds: ['TRASH'] });
  });

  it('reverse delete keeps the uniform +INBOX reverse for legacy inbox-only payloads', async () => {
    // A pre-ADR-0028 payload carries no reach and no partition; there
    // +INBOX for every id is exactly correct and must not change.
    await seedMessage(db, mailboxId, 'g-1', ['TRASH']);
    const [journal] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mailboxId,
        actionKind: 'delete',
        payload: { kind: 'delete', messageIds: ['g-1'] },
      })
      .returning();

    const [reverse] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'reverse',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['g-1'],
        requestedCount: 1,
        undoToken: journal!.token,
        idempotencyKey: `revert-${journal!.token}`,
      })
      .returning();

    await worker.processJob(
      {
        actionId: reverse!.id,
        mailboxAccountId: mailboxId,
        idempotencyKey: `revert-${journal!.token}`,
      },
      CTX,
    );

    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids).toEqual(['g-1']);
    expect(gmail.calls[0]!.change).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] });
  });

  it('in-flight all-mail delete retried after a rollback + re-apply still journals the measured partition', async () => {
    // Codex stop-review round 2: the job froze its WIDE all-mail id set,
    // crashed before the terminal transaction, and a migration rollback
    // + re-apply reset its reach column to 'inbox_only'. The retry
    // executes the frozen set — so the journal MUST measure the
    // partition from those ids, not from the (now lying) column, or the
    // payload looks legacy and its undo floods the inbox.
    await seedMessage(db, mailboxId, 'a-in', ['INBOX', 'CATEGORY_PROMOTIONS']);
    await seedMessage(db, mailboxId, 'a-arch', ['CATEGORY_PROMOTIONS']);

    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['a-in', 'a-arch'], // frozen pre-crash
        requestedCount: 2,
        idempotencyKey: 'idem-del-inflight',
        reach: 'inbox_only', // rollback + re-apply stamped the default
      })
      .returning();

    const result = await worker.processJob(
      { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-del-inflight' },
      CTX,
    );

    // The frozen wide set executes verbatim.
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]!.ids.sort()).toEqual(['a-arch', 'a-in']);
    expect(result.affectedCount).toBe(2);

    // Journal partition is MEASURED, despite the column claiming
    // inbox-only. (The best-effort reach marker follows the column and
    // is absent — the partition alone is sufficient for a correct undo.)
    const [undo] = await db
      .select()
      .from(undoJournal)
      .where(eq(undoJournal.token, result.undoToken!));
    const payload = undo!.payload as { inboxMessageIds: string[] };
    expect(payload.inboxMessageIds).toEqual(['a-in']);

    // And the undo splits correctly end to end.
    const [reverse] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'delete',
        direction: 'reverse',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['a-in', 'a-arch'],
        requestedCount: 2,
        undoToken: result.undoToken!,
        idempotencyKey: `revert-${result.undoToken!}`,
        reach: 'inbox_only',
      })
      .returning();
    await worker.processJob(
      {
        actionId: reverse!.id,
        mailboxAccountId: mailboxId,
        idempotencyKey: `revert-${result.undoToken!}`,
      },
      CTX,
    );

    expect(gmail.calls).toHaveLength(3);
    expect(gmail.calls[1]!.ids).toEqual(['a-in']);
    expect(gmail.calls[1]!.change).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] });
    expect(gmail.calls[2]!.ids).toEqual(['a-arch']);
    expect(gmail.calls[2]!.change).toEqual({ removeLabelIds: ['TRASH'] });

    const msgs = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.mailboxAccountId, mailboxId));
    const byId = Object.fromEntries(msgs.map((m) => [m.providerMessageId, m.labelIds]));
    expect(byId['a-in']).toContain('INBOX');
    expect(byId['a-in']).not.toContain('TRASH');
    expect(byId['a-arch']).not.toContain('INBOX');
    expect(byId['a-arch']).not.toContain('TRASH');
  });

  it('records status=failed on a terminal (non-retryable) error', async () => {
    await seedMessage(db, mailboxId, 'm1', ['INBOX']);
    gmail.shouldThrow = new InvalidGrantError('grant gone');
    const [job] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
        resolvedMessageIds: ['m1'],
        idempotencyKey: 'idem-fail',
      })
      .returning();

    // run() wraps processJob → classifies InvalidGrantError as terminal →
    // fires onTerminalFailure (status=failed) → rethrows.
    await expect(
      worker.run({
        id: 'job-fail',
        data: { actionId: job!.id, mailboxAccountId: mailboxId, idempotencyKey: 'idem-fail' },
        attemptsMade: 0,
      } as never),
    ).rejects.toThrow('grant gone');

    const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, job!.id));
    expect(row!.status).toBe('failed');
    expect(row!.errorCode).toBe('InvalidGrantError');
  });

  /**
   * D245 — Protected senders are excluded from BULK actions, and the
   * exclusion is re-read here, inside the mailbox lock, because the job
   * can wait tens of seconds for that lock after the click. A job that may
   * already have reached Gmail always finishes, so no moved mail is left
   * without its Activity row and Undo.
   */
  describe('execution-time Protected re-check', () => {
    async function protect(): Promise<void> {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        isProtected: true,
        protectionReason: 'starred',
        protectionSetAt: new Date(),
      });
    }

    async function forwardJob(
      values: Partial<typeof actionJobs.$inferInsert> = {},
    ): Promise<typeof actionJobs.$inferSelect> {
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'delete',
          direction: 'forward',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          idempotencyKey: 'idem-protected',
          ...values,
        })
        .returning();
      return job!;
    }

    function run(
      job: typeof actionJobs.$inferSelect,
      extra: { protectedConfirmed?: boolean } = {},
    ) {
      return worker.processJob(
        {
          actionId: job.id,
          mailboxAccountId: mailboxId,
          idempotencyKey: job.idempotencyKey,
          ...extra,
        },
        CTX,
      );
    }

    async function statusOf(jobId: string) {
      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, jobId));
      return row!;
    }

    beforeEach(async () => {
      await seedMessage(db, mailboxId, 'p1', ['INBOX']);
      await seedMessage(db, mailboxId, 'p2', ['INBOX']);
    });

    it('skips a job whose sender became Protected: nothing changed, recorded, or announced', async () => {
      const job = await forwardJob();
      await protect();

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let warned: unknown[][] = [];
      const result = await run(job).finally(() => {
        warned = [...warn.mock.calls];
        warn.mockRestore();
      });

      // D7: the one trace is ids and a closed verb — pinned key for key, so
      // an address or message ids cannot join it without this failing.
      const lines = structuredLines(warned, 'label_action.sender_protected');
      expect(lines).toHaveLength(1);
      expect(Object.keys(lines[0]!).sort()).toEqual([
        'actionId',
        'kind',
        'level',
        'mailboxAccountId',
        'message',
        'senderKey',
        'severity',
        'verb',
      ]);

      expect(gmail.calls).toHaveLength(0);
      expect(result).toEqual({
        affectedCount: 0,
        undoToken: null,
        alreadyDone: false,
        skippedProtected: true,
      });
      expect(await statusOf(job.id)).toMatchObject({
        status: 'done',
        affectedCount: 0,
        undoToken: null,
        errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
        resolvedMessageIds: [],
      });
      expect(await db.select().from(activityLog)).toEqual([]);
      expect(await db.select().from(outboxEvents)).toEqual([]);
      expect(await db.select().from(undoJournal)).toEqual([]);
    });

    it('a skipped Later never schedules a wake time', async () => {
      const job = await forwardJob({ verb: 'later', wakeAt: new Date(Date.now() + 86_400_000) });
      await protect();

      await run(job);

      expect(gmail.calls).toHaveLength(0);
      const [policy] = await db.select().from(senderPolicies);
      expect(policy!.snoozedUntil).toBeNull();
    });

    it('a job the user confirmed on a Protected sender still runs', async () => {
      const job = await forwardJob();
      await protect();

      const result = await run(job, { protectedConfirmed: true });

      expect(gmail.calls[0]!.ids.sort()).toEqual(['p1', 'p2']);
      expect(result.affectedCount).toBe(2);
    });

    /** A reviewed retry of a failed action, with its verified set frozen. */
    async function recoveryJob(): Promise<typeof actionJobs.$inferSelect> {
      const root = await forwardJob({ status: 'failed', idempotencyKey: 'idem-protected-root' });
      return forwardJob({
        idempotencyKey: 'idem-protected-recovery',
        resolvedMessageIds: ['p1', 'p2'],
        rootActionId: root.id,
        retryOfActionId: root.id,
        recoveryAttempt: 1,
        selectionFrozenAt: new Date(),
      });
    }

    // Founder decision 2026-09-26: a retry whose sender turned Protected
    // after its review said "not Protected" does not touch Gmail. It FAILS,
    // so Activity keeps it reviewable, and the next review offers
    // "<Verb> anyway" — the only consent a Protected sender's mail has.
    it('stops a retry whose sender turned Protected after its review, and keeps it retryable', async () => {
      const job = await recoveryJob();
      await protect();
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await run(job);
      const logged = [...warned.mock.calls];
      warned.mockRestore();

      // Ids only (D7) — pinned, so an address added later fails here.
      const [line] = structuredLines(logged, 'label_action.recovery_sender_protected');
      expect(Object.keys(line!).sort()).toEqual(
        ['actionId', 'kind', 'level', 'mailboxAccountId', 'message', 'severity', 'verb'].sort(),
      );
      expect(gmail.calls).toHaveLength(0);
      expect(await statusOf(job.id)).toMatchObject({
        status: 'failed',
        affectedCount: 0,
        errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
      });
      expect(await db.select().from(activityLog)).toEqual([]);
      expect(await db.select().from(outboxEvents)).toEqual([]);
      expect(await db.select().from(undoJournal)).toEqual([]);
    });

    // BullMQ can deliver the same job twice (a stall, or a crash before it
    // records completion). The stopped attempt stays stopped: only a new
    // review creates the next attempt.
    it('keeps a stopped retry stopped when the same job is delivered again', async () => {
      const job = await recoveryJob();
      await protect();

      await run(job);
      const again = await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect(again).toMatchObject({ affectedCount: 0, undoToken: null, stoppedProtected: true });
      expect(await statusOf(job.id)).toMatchObject({
        status: 'failed',
        errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
      });
      expect(await db.select().from(undoJournal)).toEqual([]);
      expect(await db.select().from(activityLog)).toEqual([]);
    });

    // Same for any failed row: its next run is a new attempt from a review,
    // never a stalled or dead-letter replay of the old job — which would
    // otherwise skip the re-check, since a failed row may have reached Gmail.
    it('does not rerun a failed job that is delivered again', async () => {
      const job = await forwardJob({
        status: 'failed',
        errorCode: 'PermanentError',
        resolvedMessageIds: ['p1', 'p2'],
      });
      await protect();
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await run(job);
      const lines = [...warned.mock.calls];
      warned.mockRestore();

      expect(gmail.calls).toHaveLength(0);
      expect(result).toMatchObject({ affectedCount: 0, undoToken: null, alreadyDone: true });
      expect(await statusOf(job.id)).toMatchObject({
        status: 'failed',
        errorCode: 'PermanentError',
      });
      const [line] = structuredLines(lines, 'label_action.failed_redelivery_ignored');
      expect(Object.keys(line!).sort()).toEqual(
        [
          'actionId',
          'errorCode',
          'kind',
          'level',
          'mailboxAccountId',
          'message',
          'severity',
        ].sort(),
      );
    });

    it('stops that retry at the send too, if protection lands during the quota wait', async () => {
      const job = await recoveryJob();
      gmail.duringQuotaWait = protect;

      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect(await statusOf(job.id)).toMatchObject({
        status: 'failed',
        errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
      });
    });

    it('runs a retry the user confirmed with the Protected line — "…anyway" is the consent', async () => {
      const job = await recoveryJob();
      await protect();

      const result = await run(job, { protectedConfirmed: true });

      expect(gmail.calls[0]!.ids.sort()).toEqual(['p1', 'p2']);
      expect(result.affectedCount).toBe(2);
    });

    it('a retry that may already have reached Gmail finishes, even for a now-Protected sender', async () => {
      // `executing` is written as the first request leaves, so this row
      // may have moved mail. Skipping it would leave that mail moved with
      // no Activity row and no Undo.
      const job = await forwardJob({ status: 'executing', resolvedMessageIds: ['p1', 'p2'] });
      await protect();

      const result = await run(job);

      expect(gmail.calls[0]!.ids.sort()).toEqual(['p1', 'p2']);
      expect(result.undoToken).not.toBeNull();
      const [act] = await db.select().from(activityLog);
      expect(act).toMatchObject({ action: 'delete', affectedCount: 2 });
    });

    it('a retry that never reached Gmail is re-checked', async () => {
      // Attempt 1 froze the set, then failed before any request left.
      const job = await forwardJob({ resolvedMessageIds: ['p1', 'p2'] });
      await protect();

      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect((await statusOf(job.id)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    });

    it('is still queued when the token refresh fails, so the retry is re-checked', async () => {
      // In production the refresh happens inside batchModify, before the
      // request is sent — never in getClient.
      const job = await forwardJob();
      gmail.throwBeforeSend = new TransientError('Gmail token refresh failed');

      await expect(run(job)).rejects.toThrow('Gmail token refresh failed');
      expect(await statusOf(job.id)).toMatchObject({ status: 'queued' });

      await protect();
      gmail.throwBeforeSend = null;
      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect((await statusOf(job.id)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    });

    it('is marked executing before the request leaves', async () => {
      const job = await forwardJob();
      let statusAtSend: string | null = null;
      gmail.onSend = async () => {
        statusAtSend = (await statusOf(job.id)).status;
      };

      await run(job);

      expect(statusAtSend).toBe('executing');
    });

    it('catches protection that lands during the quota wait, at the send', async () => {
      const job = await forwardJob();
      gmail.duringQuotaWait = protect;

      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect(await statusOf(job.id)).toMatchObject({
        status: 'done',
        errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
      });
    });

    /** A job whose frozen set needs more than one Gmail request. */
    const manyIds = Array.from({ length: 1500 }, (_, i) => `big-${i}`);

    it('goes back to queued when Gmail refuses the first of several requests', async () => {
      const job = await forwardJob({ resolvedMessageIds: manyIds });
      gmail.shouldThrow = new RateLimitError('Gmail returned 429', 65_000);

      await expect(run(job)).rejects.toBeInstanceOf(RateLimitError);
      expect(await statusOf(job.id)).toMatchObject({ status: 'queued' });

      await protect();
      gmail.shouldThrow = null;
      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect((await statusOf(job.id)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    });

    it('stays executing when a later request is refused — the first one already landed', async () => {
      const job = await forwardJob({ resolvedMessageIds: manyIds });
      gmail.shouldThrow = new RateLimitError('Gmail returned 429', 65_000);
      gmail.failAfterCalls = 1;

      await expect(run(job)).rejects.toBeInstanceOf(RateLimitError);

      expect(gmail.calls).toHaveLength(1);
      expect(await statusOf(job.id)).toMatchObject({ status: 'executing' });
    });

    it('says so loudly when the client never ran the hook, and still marks the job in flight', async () => {
      const job = await forwardJob();
      gmail.ignoreHook = true;
      const captured: string[] = [];
      worker.setObserver({
        captureFailure: () => {},
        captureBackgroundFailure: (_error, ctx) => captured.push(ctx.kind),
        recordBackgroundNotice: () => {},
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      let logged: unknown[][] = [];
      await run(job).finally(() => {
        logged = [...error.mock.calls];
        error.mockRestore();
      });

      const lines = structuredLines(logged, 'label_action.before_first_request_skipped');
      expect(lines).toHaveLength(1);
      // Ids only (D7) — pinned, so an address added later fails here.
      expect(Object.keys(lines[0]!).sort()).toEqual(
        ['actionId', 'kind', 'level', 'mailboxAccountId', 'message', 'severity'].sort(),
      );
      // A console line never reaches Sentry; the observer does.
      expect(captured).toEqual(['label_action.before_first_request_skipped']);
      expect(await statusOf(job.id)).toMatchObject({ status: 'done' });
    });

    it('goes back to queued when Gmail refuses the only request, so the retry is re-checked', async () => {
      const job = await forwardJob();
      gmail.shouldThrow = new RateLimitError('Gmail returned 429', 65_000);

      await expect(run(job)).rejects.toBeInstanceOf(RateLimitError);
      expect(await statusOf(job.id)).toMatchObject({ status: 'queued' });

      await protect();
      gmail.shouldThrow = null;
      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect((await statusOf(job.id)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    });

    it('stays executing after an ambiguous failure — the retry finishes for a now-Protected sender', async () => {
      const job = await forwardJob();
      gmail.shouldThrow = new TransientError('Gmail returned 503');

      await expect(run(job)).rejects.toBeInstanceOf(TransientError);
      expect(await statusOf(job.id)).toMatchObject({ status: 'executing' });

      await protect();
      gmail.shouldThrow = null;
      const result = await run(job);

      expect(gmail.calls[0]!.ids.sort()).toEqual(['p1', 'p2']);
      expect(result.undoToken).not.toBeNull();
    });

    it('re-checks a job the API reported as not enqueued that ran anyway', async () => {
      const job = await forwardJob({ status: 'failed', errorCode: 'ENQUEUE_FAILED' });
      await protect();

      await run(job);

      expect(gmail.calls).toHaveLength(0);
      expect((await statusOf(job.id)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    });

    it('never blocks Undo of a now-Protected sender', async () => {
      await seedMessage(db, mailboxId, 'p3', ['TRASH']);
      const [undo] = await db
        .insert(undoJournal)
        .values({
          mailboxAccountId: mailboxId,
          actionKind: 'delete',
          payload: { kind: 'delete', messageIds: ['p3'], inboxMessageIds: ['p3'] },
        })
        .returning();
      const [job] = await db
        .insert(actionJobs)
        .values({
          mailboxAccountId: mailboxId,
          verb: 'delete',
          direction: 'reverse',
          selector: { type: 'sender', senderId: 'sid', senderKey: SENDER_KEY },
          resolvedMessageIds: ['p3'],
          undoToken: undo!.token,
          idempotencyKey: `revert-${undo!.token}`,
        })
        .returning();
      await protect();

      await run(job!);

      expect(gmail.calls[0]!.ids).toEqual(['p3']);
      expect(gmail.calls[0]!.change).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] });
    });
  });
});

/**
 * `labelChangeForVerb` reads the Action Registry (ADR-0015) as the single
 * source of truth — P3 deleted the worker-local `VERB_LABEL_CHANGES` map.
 * Tested directly because the policy-only branch is unreachable through
 * the worker's DB path (the `action_verb` pg_enum is label-modify-only,
 * so a `keep` row can't be inserted).
 */
describe('labelChangeForVerb (registry-routed, ADR-0015)', () => {
  it('returns the archive forward/reverse INBOX delta from the registry', () => {
    expect(labelChangeForVerb('archive')).toEqual({
      forward: { removeLabelIds: ['INBOX'] },
      reverse: { addLabelIds: ['INBOX'] },
    });
  });

  it('returns the later forward/reverse delta from the registry', () => {
    // ADR-0019 + spec v1.2: later pipeline is now complete (local mirror
    // derived from `LabelChange`, undo payload union covers it, event
    // schema accepts the verb).
    expect(labelChangeForVerb('later')).toEqual({
      forward: { removeLabelIds: ['INBOX'], addLabelIds: ['DeclutrMail/Later'] },
      reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['DeclutrMail/Later'] },
    });
  });

  it('returns the delete forward/reverse TRASH delta from the registry', () => {
    // Spec v1.2 Decision 1 — delete = batchModify add TRASH + remove
    // INBOX; reverse restores INBOX + removes TRASH. Gmail Trash 30-day
    // recovery window is the physical guarantee.
    expect(labelChangeForVerb('delete')).toEqual({
      forward: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] },
      reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] },
    });
  });

  it('refuses a policy-only verb (pipeline isolation, consensus §5)', () => {
    // `keep` is policy-only — it must never reach the label worker.
    expect(() => labelChangeForVerb('keep')).toThrow(ValidationError);
  });

  it('refuses a label-modify verb whose pipeline is incomplete (F1)', () => {
    // The `action_verb` pg_enum currently lists only verbs whose
    // pipeline IS complete (archive/later/delete), so we synthetically
    // probe the guard by calling it with a verb that is in the Action
    // Registry but NOT in `PIPELINE_COMPLETE_VERBS` — `unarchive` is the
    // live candidate (label-modify in the registry, not in the pg_enum
    // or `undo_action_kind`/`activity_action`, so its pipeline is by
    // definition incomplete). This documents the guard's role for any
    // future verb added to the enum without all four surfaces wired up.
    const unarchive = 'unarchive' as ActionVerb;
    expect(() => labelChangeForVerb(unarchive)).toThrow(ValidationError);
    expect(() => labelChangeForVerb(unarchive)).toThrow(/archive-only/);
  });
});

/** The structured JSON log lines of one `kind` among a console spy's calls. */
function structuredLines(calls: unknown[][], kind: string): Array<Record<string, unknown>> {
  return calls.flatMap(([line]) => {
    try {
      const parsed = JSON.parse(String(line)) as Record<string, unknown>;
      return parsed.kind === kind ? [parsed] : [];
    } catch {
      return [];
    }
  });
}
