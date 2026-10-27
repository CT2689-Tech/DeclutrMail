import type { schema } from '@declutrmail/db';
import {
  actionJobs,
  activityLog,
  automationRules,
  mailboxAccounts,
  mailMessages,
  outboxEvents,
  senderPolicies,
  senders,
  undoJournal,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BatchModifyOptions,
  GmailMutationClient,
  LabelChange,
} from './gmail-mutation-client.js';
import {
  LABEL_SENDER_PROTECTED_ERROR_CODE,
  LabelActionWorker,
  PASSTHROUGH_MAILBOX_LOCK,
  RECOVERY_SENDER_PROTECTED_ERROR_CODE,
} from './label-action.worker.js';
import type { LabelActionJobData } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { RateLimitError, TransientError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Job = typeof actionJobs.$inferSelect;
const SENDER_KEY = 'a'.repeat(64);
const PREVIEW_ID = '00000000-0000-4000-8000-000000000001';
const CTX: WorkerContext = {
  jobId: 'custom',
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

class Gmail implements GmailMutationClient {
  calls: { ids: string[]; change: LabelChange }[] = [];
  beforeHook: (() => Promise<void>) | undefined;
  afterHook: (() => Promise<void>) | undefined;
  error: Error | undefined;
  failAfter = 0;
  async modifyLabels() {}
  async ensureLabelId(): Promise<string> {
    throw new Error('custom jobs must use system labels only');
  }
  async batchModify(ids: string[], change: LabelChange, options: BatchModifyOptions = {}) {
    await this.beforeHook?.();
    await options.beforeFirstRequest?.();
    await this.afterHook?.();
    if (this.error && this.calls.length >= this.failAfter) throw this.error;
    this.calls.push({ ids: [...ids], change });
  }
}

describe('LabelActionWorker approved custom Autopilot', () => {
  let db: Db;
  let mailboxId: string;
  let workspaceId: string;
  let senderId: string;
  let ruleId: string;
  let gmail: Gmail;
  let worker: LabelActionWorker;
  let deferred: ReturnType<
    typeof vi.fn<(payload: LabelActionJobData, delayMs: number) => Promise<void>>
  >;

  beforeEach(async () => {
    db = await freshTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'WS', tier: 'plus' })
      .returning();
    workspaceId = workspace!.id;
    const [user] = await db
      .insert(users)
      .values({ workspaceId, email: 'owner@example.test' })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'owner@example.test',
      })
      .returning();
    mailboxId = mailbox!.id;
    const [sender] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_KEY,
        email: 'sender@example.test',
        domain: 'example.test',
        gmailCategory: 'promotions',
        firstSeenAt: new Date('2020-01-01'),
        lastSeenAt: new Date('2026-01-01'),
      })
      .returning();
    senderId = sender!.id;
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mailboxId,
        isPreset: false,
        presetKey: null,
        name: 'My senders',
        enabled: true,
        mode: 'observe',
        actionKind: 'archive',
        actionPayload: { reach: 'inbox_only' },
        conditions: { kind: 'sender_list', senderKeys: [SENDER_KEY], olderThanDays: null },
      })
      .returning();
    ruleId = rule!.id;
    gmail = new Gmail();
    deferred = vi.fn(async () => {});
    worker = new LabelActionWorker({
      db: db as never,
      gmailMutation: { getClient: async () => gmail },
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
      onQuietDeferred: deferred,
    });
  });

  async function message(id: string, labels = ['INBOX'], outbound = false) {
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: id,
      providerThreadId: `t-${id}`,
      senderKey: SENDER_KEY,
      internalDate: new Date('2020-01-01'),
      labelIds: labels,
      isUnread: false,
      isOutbound: outbound,
    });
  }
  async function job(values: Partial<typeof actionJobs.$inferInsert> = {}): Promise<Job> {
    const [row] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: {
          type: 'sender',
          senderId,
          senderKey: SENDER_KEY,
          autopilot: { ruleId, ruleVersion: 1, previewId: PREVIEW_ID },
        },
        resolvedMessageIds: ['approved'],
        requestedCount: 1,
        idempotencyKey: `custom-${crypto.randomUUID()}`,
        ...values,
      })
      .returning();
    return row!;
  }
  function run(row: Job, protectedConfirmed?: boolean) {
    return worker.processJob(
      {
        actionId: row.id,
        mailboxAccountId: mailboxId,
        idempotencyKey: row.idempotencyKey,
        ...(protectedConfirmed === undefined ? {} : { protectedConfirmed }),
      },
      CTX,
    );
  }
  async function status(row: Job) {
    const [current] = await db.select().from(actionJobs).where(eq(actionJobs.id, row.id));
    return current!;
  }
  async function protect() {
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailboxId,
      senderKey: SENDER_KEY,
      isProtected: true,
      protectionReason: 'starred',
      protectionSetAt: new Date(),
    });
  }
  async function assertNoAction() {
    expect(gmail.calls).toEqual([]);
    expect(await db.select().from(activityLog)).toEqual([]);
    expect(await db.select().from(undoJournal)).toEqual([]);
    expect(await db.select().from(outboxEvents)).toEqual([]);
  }

  it('executes only the approved IDs, attributes Activity, and ignores new mail', async () => {
    await message('approved');
    const row = await job();
    await message('new-mail');
    const result = await run(row);
    expect(gmail.calls).toEqual([{ ids: ['approved'], change: { removeLabelIds: ['INBOX'] } }]);
    expect(result.affectedCount).toBe(1);
    const [activity] = await db.select().from(activityLog);
    expect(activity).toMatchObject({
      source: 'autopilot',
      ruleId,
      actionJobId: row.id,
      affectedCount: 1,
      undoToken: result.undoToken,
    });
    expect((await status(row)).resolvedMessageIds).toEqual(['approved']);
    await run(row);
    expect(gmail.calls).toHaveLength(1);
  });

  it('never expands an empty approved set and records an attributed zero-message result', async () => {
    await message('new-mail');
    const row = await job({ resolvedMessageIds: [], requestedCount: 0 });
    expect(await run(row)).toMatchObject({ affectedCount: 0, undoToken: null });
    expect(gmail.calls).toEqual([]);
    const [activity] = await db.select().from(activityLog);
    expect(activity).toMatchObject({
      source: 'autopilot',
      ruleId,
      affectedCount: 0,
      undoToken: null,
    });
    expect((await status(row)).resolvedMessageIds).toEqual([]);
  });

  it('shrinks frozen IDs to eligible inbound scope after overlapping/manual actions', async () => {
    await message('approved');
    await message('already-archived', []);
    await message('already-deleted', ['INBOX', 'TRASH']);
    await message('outbound', ['INBOX', 'SENT'], true);
    await message('spam', ['INBOX', 'SPAM']);
    await message('new-mail');
    const row = await job({
      resolvedMessageIds: [
        'approved',
        'approved',
        'already-archived',
        'already-deleted',
        'outbound',
        'spam',
        'missing',
      ],
    });
    await run(row);
    expect(gmail.calls[0]!.ids).toEqual(['approved']);
    const [journal] = await db.select().from(undoJournal);
    expect(journal!.payload).toMatchObject({ messageIds: ['approved'] });
  });

  it.each([
    ['paused', { mode: 'paused' as const }, 'AUTOPILOT_RULE_INACTIVE'],
    ['disabled', { enabled: false }, 'AUTOPILOT_RULE_INACTIVE'],
    ['retired', { retiredAt: new Date() }, 'AUTOPILOT_RULE_INACTIVE'],
    ['Active', { mode: 'active' as const }, 'AUTOPILOT_RULE_INACTIVE'],
    ['non-account scope', { scope: 'workspace' as const }, 'AUTOPILOT_RULE_INVALID'],
    [
      'preset forwarding',
      { isPreset: true, presetKey: 'auto_archive_low_engagement' },
      'AUTOPILOT_RULE_INVALID',
    ],
  ])('safely stops a queued job when its rule is %s', async (_name, changes, errorCode) => {
    await message('approved');
    const row = await job();
    await db.update(automationRules).set(changes).where(eq(automationRules.id, ruleId));
    await run(row);
    expect(await status(row)).toMatchObject({ status: 'failed', errorCode, affectedCount: 0 });
    await assertNoAction();
  });

  it.each([false, true])(
    'runs the approved IDs and action after a rule edit (during quota wait: %s)',
    async (duringWait) => {
      await message('approved');
      await message('new-arrival');
      const row = await job();
      const edit = async () => {
        await db
          .update(automationRules)
          .set({
            version: 2,
            actionKind: 'delete',
            conditions: { kind: 'sender_list', senderKeys: ['b'.repeat(64)], olderThanDays: 180 },
          })
          .where(eq(automationRules.id, ruleId));
      };
      if (duringWait) gmail.beforeHook = edit;
      else await edit();
      await run(row);
      expect(await status(row)).toMatchObject({ status: 'done', affectedCount: 1 });
      expect(gmail.calls).toEqual([{ ids: ['approved'], change: { removeLabelIds: ['INBOX'] } }]);
    },
  );

  it('classifies a pause within the same millisecond as revoked without retrying Gmail', async () => {
    await message('approved');
    const row = await job();
    await db
      .update(actionJobs)
      .set({ createdAt: sql`'2026-10-24T00:00:00.000100Z'::timestamptz` })
      .where(eq(actionJobs.id, row.id));
    await db
      .update(automationRules)
      .set({
        mode: 'observe',
        version: 3,
        modeChangedAt: sql`'2026-10-24T00:00:00.000200Z'::timestamptz`,
      })
      .where(eq(automationRules.id, ruleId));
    await run(row);
    expect(await status(row)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_RULE_INACTIVE',
      affectedCount: 0,
    });
    await assertNoAction();
  });

  it('does not revive a waiting approval after Pause and Resume before its next delivery', async () => {
    await message('approved');
    const row = await job();
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true } })
      .where(eq(mailboxAccounts.id, mailboxId));
    expect(await run(row)).toMatchObject({ deferredQuiet: true });
    await db
      .update(automationRules)
      .set({ mode: 'paused', version: 2, modeChangedAt: new Date(Date.now() + 1000) })
      .where(eq(automationRules.id, ruleId));
    await db
      .update(automationRules)
      .set({ mode: 'observe', version: 3, modeChangedAt: new Date(Date.now() + 2000) })
      .where(eq(automationRules.id, ruleId));
    await db
      .update(mailboxAccounts)
      .set({ quietState: {} })
      .where(eq(mailboxAccounts.id, mailboxId));
    await run(row);
    expect(await status(row)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_RULE_INACTIVE',
      affectedCount: 0,
    });
    await assertNoAction();
  });

  it('does not automatically replay a stopped action after its rule resumes', async () => {
    await message('approved');
    const row = await job();
    await db.update(automationRules).set({ mode: 'paused' }).where(eq(automationRules.id, ruleId));
    await run(row);
    await db.update(automationRules).set({ mode: 'observe' }).where(eq(automationRules.id, ruleId));
    expect(await run(row)).toMatchObject({ alreadyDone: true, affectedCount: 0 });
    expect(await status(row)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_RULE_INACTIVE',
    });
    await assertNoAction();
  });

  it('stops a disconnected mailbox and a sender whose ownership no longer matches', async () => {
    await message('approved');
    const disconnected = await job();
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, mailboxId));
    await run(disconnected);
    expect(await status(disconnected)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_MAILBOX_INACTIVE',
    });
    await db
      .update(mailboxAccounts)
      .set({ status: 'active' })
      .where(eq(mailboxAccounts.id, mailboxId));
    const missingSender = await job();
    await db
      .update(senders)
      .set({ senderKey: 'b'.repeat(64) })
      .where(eq(senders.id, senderId));
    await run(missingSender);
    expect(await status(missingSender)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_RULE_INVALID',
    });
    await assertNoAction();
  });

  it('does not accept a forged mailbox lock or another mailbox rule', async () => {
    await message('approved');
    const row = await job();
    await expect(
      worker.processJob(
        {
          actionId: row.id,
          mailboxAccountId: '00000000-0000-4000-8000-000000000002',
          idempotencyKey: row.idempotencyKey,
        },
        CTX,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const [mailbox] = await db
      .select()
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxId));
    const [otherMailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId,
        userId: mailbox!.userId,
        provider: 'gmail',
        providerAccountId: 'other@example.test',
      })
      .returning();
    await db
      .update(automationRules)
      .set({ mailboxAccountId: otherMailbox!.id })
      .where(eq(automationRules.id, ruleId));
    await run(row);
    expect((await status(row)).errorCode).toBe('AUTOPILOT_RULE_INVALID');
    await assertNoAction();
  });

  it('retries without sending when provider sync changes eligibility during quota wait', async () => {
    await message('approved');
    const row = await job();
    gmail.beforeHook = async () => {
      await db
        .update(mailMessages)
        .set({ labelIds: [] })
        .where(eq(mailMessages.providerMessageId, 'approved'));
    };
    await expect(run(row)).rejects.toBeInstanceOf(TransientError);
    expect((await status(row)).status).toBe('queued');
    await assertNoAction();
    gmail.beforeHook = undefined;
    await run(row);
    expect((await status(row)).resolvedMessageIds).toEqual([]);
    expect(gmail.calls).toEqual([]);
  });

  it('defers quiet without spending an attempt or changing durable scope, then resumes', async () => {
    await message('approved');
    const row = await job();
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true } })
      .where(eq(mailboxAccounts.id, mailboxId));
    const beforeDeferral = Date.now();
    expect(await run(row)).toMatchObject({ deferredQuiet: true });
    expect(deferred).toHaveBeenCalledWith(
      { actionId: row.id, mailboxAccountId: mailboxId, idempotencyKey: row.idempotencyKey },
      300_000,
    );
    expect(await status(row)).toMatchObject({ status: 'queued', resolvedMessageIds: ['approved'] });
    const due = (await status(row)).selector.quietDeferredUntilMs!;
    expect(due).toBeGreaterThanOrEqual(beforeDeferral + 300_000);
    expect(due).toBeLessThanOrEqual(Date.now() + 300_000);
    expect((await status(row)).selector).toMatchObject(row.selector);
    // A failed extension must retain only the previously published promise.
    deferred.mockRejectedValueOnce(new Error('extension unavailable'));
    await expect(run(row)).rejects.toThrow('extension unavailable');
    expect((await status(row)).selector.quietDeferredUntilMs).toBe(due);
    expect(await run(row)).toMatchObject({ deferredQuiet: true });
    expect((await status(row)).selector.quietDeferredUntilMs).toBeGreaterThanOrEqual(due);
    await assertNoAction();
    await db
      .update(mailboxAccounts)
      .set({ quietState: {} })
      .where(eq(mailboxAccounts.id, mailboxId));
    await message('arrived-during-quiet');
    await run(row);
    expect(gmail.calls[0]!.ids).toEqual(['approved']);
  });

  it('rechecks quiet and downgrade after a quota wait with no request or lost action', async () => {
    await message('approved');
    const row = await job();
    gmail.beforeHook = async () => {
      await db
        .update(mailboxAccounts)
        .set({
          quietState: { enabled: true, until_at: new Date(Date.now() + 60_000).toISOString() },
        })
        .where(eq(mailboxAccounts.id, mailboxId));
    };
    expect(await run(row)).toMatchObject({ deferredQuiet: true });
    expect(deferred.mock.calls[0]![1]).toBeGreaterThan(0);
    expect(deferred.mock.calls[0]![1]).toBeLessThanOrEqual(60_000);
    gmail.beforeHook = undefined;
    await db.update(workspaces).set({ tier: 'free' }).where(eq(workspaces.id, workspaceId));
    await run(row);
    expect(await status(row)).toMatchObject({
      status: 'failed',
      errorCode: 'AUTOPILOT_NOT_ENTITLED',
    });
    await assertNoAction();
  });

  it('keeps a quiet queue publish failure retryable without marking execution', async () => {
    await message('approved');
    const row = await job();
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true } })
      .where(eq(mailboxAccounts.id, mailboxId));
    deferred.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(run(row)).rejects.toThrow('queue unavailable');
    expect((await status(row)).status).toBe('queued');
    expect((await status(row)).selector.quietDeferredUntilMs).toBeUndefined();
    expect(await run(row)).toMatchObject({ deferredQuiet: true });
    await assertNoAction();
  });

  it('never lets an original custom action override a newly Protected sender', async () => {
    await message('approved');
    const row = await job();
    gmail.beforeHook = protect;
    expect(await run(row, true)).toMatchObject({ skippedProtected: true });
    expect((await status(row)).errorCode).toBe(LABEL_SENDER_PROTECTED_ERROR_CODE);
    await assertNoAction();
  });

  it('finishes an ambiguous in-flight retry despite rule edits, quiet, or downgrade', async () => {
    await message('approved');
    const row = await job();
    gmail.error = new TransientError('connection lost after send');
    await expect(run(row)).rejects.toBeInstanceOf(TransientError);
    expect((await status(row)).status).toBe('executing');
    await db
      .update(automationRules)
      .set({ version: 2, mode: 'paused', actionKind: 'delete' })
      .where(eq(automationRules.id, ruleId));
    await db.update(workspaces).set({ tier: 'free' }).where(eq(workspaces.id, workspaceId));
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true } })
      .where(eq(mailboxAccounts.id, mailboxId));
    await db
      .update(mailMessages)
      .set({ labelIds: [] })
      .where(eq(mailMessages.providerMessageId, 'approved'));
    await message('new-mail');
    gmail.error = undefined;
    await run(row);
    expect(gmail.calls).toEqual([{ ids: ['approved'], change: { removeLabelIds: ['INBOX'] } }]);
    expect((await status(row)).affectedCount).toBe(1);
    expect(deferred).not.toHaveBeenCalled();
  });

  it('stops an in-flight retry when Protected even with custom override payload', async () => {
    await message('approved');
    const row = await job({ status: 'executing' });
    await protect();
    expect(await run(row, true)).toMatchObject({ stoppedProtected: true });
    expect(await status(row)).toMatchObject({
      status: 'failed',
      errorCode: RECOVERY_SENDER_PROTECTED_ERROR_CODE,
    });
    await assertNoAction();
  });

  it('retains reviewed recovery semantics after pause/edit/downgrade, including explicit Protected consent', async () => {
    await message('approved', []);
    const root = await job({ status: 'failed' });
    const recovery = await job({
      rootActionId: root.id,
      retryOfActionId: root.id,
      recoveryAttempt: 1,
      selectionFrozenAt: new Date(),
    });
    await db
      .update(automationRules)
      .set({ version: 2, mode: 'paused' })
      .where(eq(automationRules.id, ruleId));
    await db.update(workspaces).set({ tier: 'free' }).where(eq(workspaces.id, workspaceId));
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true } })
      .where(eq(mailboxAccounts.id, mailboxId));
    await protect();
    expect(await run(recovery, true)).toMatchObject({ affectedCount: 1 });
    expect(gmail.calls[0]!.ids).toEqual(['approved']);
    const [activity] = await db.select().from(activityLog);
    expect(activity).toMatchObject({ source: 'autopilot', ruleId, actionJobId: recovery.id });
  });

  it('reuses the original frozen set after partial multi-request failure', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `approved-${index}`);
    await db.insert(mailMessages).values(
      ids.map((id) => ({
        mailboxAccountId: mailboxId,
        providerMessageId: id,
        providerThreadId: `t-${id}`,
        senderKey: SENDER_KEY,
        internalDate: new Date('2020-01-01'),
        labelIds: ['INBOX'],
        isUnread: false,
      })),
    );
    const row = await job({ resolvedMessageIds: ids, requestedCount: ids.length });
    gmail.error = new RateLimitError('quota exhausted', 60_000);
    gmail.failAfter = 1;
    await expect(run(row)).rejects.toBeInstanceOf(RateLimitError);
    expect(gmail.calls).toHaveLength(1);
    expect((await status(row)).status).toBe('executing');
    await db
      .update(automationRules)
      .set({ mode: 'paused', version: 2 })
      .where(eq(automationRules.id, ruleId));
    await message('new-mail');
    gmail.error = undefined;
    await run(row);
    expect(gmail.calls.slice(1).flatMap((call) => call.ids)).toEqual(ids);
    const [journal] = await db.select().from(undoJournal);
    expect(journal!.payload).toMatchObject({ messageIds: ids });
  });

  it('supports approved Delete scope overrides and preserves Inbox/archive Undo partition', async () => {
    await message('approved');
    await message('archived', []);
    await message('new-mail');
    // Saved rule remains Archive/inbox. The preview approved this Delete override.
    const row = await job({
      verb: 'delete',
      reach: 'all_mail',
      resolvedMessageIds: ['approved', 'archived'],
      requestedCount: 2,
    });
    const result = await run(row);
    const [journal] = await db.select().from(undoJournal);
    expect(journal!.payload).toEqual({
      kind: 'delete',
      messageIds: ['approved', 'archived'],
      inboxMessageIds: ['approved'],
      reach: 'all_mail',
    });
    const reverse = await job({
      verb: 'delete',
      direction: 'reverse',
      resolvedMessageIds: ['approved', 'archived'],
      undoToken: result.undoToken,
    });
    await db
      .update(automationRules)
      .set({ retiredAt: new Date(), mode: 'paused' })
      .where(eq(automationRules.id, ruleId));
    await run(reverse);
    expect(gmail.calls.slice(1)).toEqual([
      { ids: ['approved'], change: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] } },
      { ids: ['archived'], change: { removeLabelIds: ['TRASH'] } },
    ]);
    const [activity] = await db.select().from(activityLog);
    expect(activity!.revertedAt).not.toBeNull();
  });
});
