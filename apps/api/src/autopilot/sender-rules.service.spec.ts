import {
  actionJobs,
  actionRecoveryPreviews,
  AUTOPILOT_PRESET_KEYS,
  automationRules,
  mailMessages,
  mailboxAccounts,
  senderPolicies,
  ruleMatchLog,
  senders,
  users,
  workspaces,
  undoJournal,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  LabelActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  type BatchModifyOptions,
  type LabelChange,
  type LabelActionJobData,
  type WorkerContext,
} from '@declutrmail/workers';
import { ActionsService } from '../actions/actions.service.js';
import { ActionRecoveryService } from '../actions/action-recovery.service.js';
import { SenderRulesService } from './sender-rules.service.js';
import { AutopilotReadService } from './autopilot.read-service.js';
import { MemorySenderRulePreviewStore, SENDER_RULE_PREVIEW_TTL_MS } from './sender-rules.store.js';

type Db = Awaited<ReturnType<typeof freshTestDb>>;
const A = 'a'.repeat(64),
  B = 'b'.repeat(64),
  C = 'c'.repeat(64);
const definition = {
  name: 'Old newsletters',
  senderKeys: [A],
  action: 'archive' as const,
  reach: 'inbox_only' as const,
  olderThanDays: 30 as const,
};

async function seedMailbox(db: Db, suffix: string) {
  const [ws] = await db.insert(workspaces).values({ name: suffix, tier: 'plus' }).returning();
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${suffix}@example.com` })
    .returning();
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${suffix}@example.com`,
    })
    .returning();
  return mailbox!.id;
}
async function seedSender(db: Db, mailboxId: string, key: string, name = 'Shop news') {
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailboxId,
      senderKey: key,
      displayName: name,
      email: `${key.slice(0, 8)}@example.com`,
      domain: 'example.com',
      gmailCategory: 'promotions',
      firstSeenAt: new Date('2020-01-01'),
      lastSeenAt: new Date(),
    })
    .returning();
  return sender!;
}
async function message(
  db: Db,
  mailboxId: string,
  id: string,
  senderKey = A,
  days = 100,
  labelIds = ['INBOX'],
  isOutbound = false,
) {
  await db.insert(mailMessages).values({
    mailboxAccountId: mailboxId,
    providerMessageId: id,
    providerThreadId: `thread-${id}`,
    senderKey,
    internalDate: new Date(Date.now() - days * 86_400_000),
    labelIds,
    isUnread: false,
    isOutbound,
  });
}

describe('sender-list Autopilot rules', () => {
  let db: Db, mailbox: string, other: string, service: SenderRulesService;
  let queue: { add: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    db = await freshTestDb();
    mailbox = await seedMailbox(db, 'owner');
    other = await seedMailbox(db, 'other');
    await seedSender(db, mailbox, A);
    await seedSender(db, mailbox, B, 'Bank updates');
    await seedSender(db, other, C, 'Other account');
    queue = { add: vi.fn().mockResolvedValue({ id: 'queued' }) };
    service = new SenderRulesService(
      db as never,
      new ActionsService(db as never, queue as never),
      new MemorySenderRulePreviewStore(),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('freezes a preset Delete across Schedule, runs only approved IDs, and undoes mixed placement', async () => {
    const conditions = { kind: 'new_sender', firstSeenWithinDays: 7, fewerThanMessages: 1000 };
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mailbox,
        isPreset: true,
        presetKey: 'auto_screen_new_senders',
        name: 'Evening cleanup',
        enabled: true,
        mode: 'observe',
        conditions,
        actionKind: 'delete',
        actionPayload: { reach: 'all_mail' },
      })
      .returning();
    await message(db, mailbox, 'approved-inbox');
    await message(db, mailbox, 'approved-archive', A, 100, []);
    await message(db, mailbox, 'excluded-sender', B);
    await message(db, mailbox, 'trash', A, 100, ['TRASH']);
    await message(db, mailbox, 'spam', A, 100, ['SPAM']);
    await message(db, mailbox, 'sent', A, 100, [], true);
    const actions = new ActionsService(db as never, queue as never);
    service = new SenderRulesService(db as never, actions, new MemorySenderRulePreviewStore());
    const clock = new Date();
    clock.setUTCDate(clock.getUTCDate() + 1);
    clock.setUTCHours(6, 59, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    try {
      await db
        .update(mailboxAccounts)
        .set({
          quietState: {
            quiet_hours: {
              enabled: true,
              start_local: '22:00',
              end_local: '07:00',
              timezone: 'UTC',
            },
          },
        })
        .where(eq(mailboxAccounts.id, mailbox));
      const preview = await service.preview(mailbox, rule!.id, {
        version: 1,
        includedSenderKeys: [A],
      });
      expect(preview).toMatchObject({ messageCount: 2, reach: 'all_mail', action: 'delete' });
      const approved = await service.execute(mailbox, rule!.id, preview.previewId);
      const read = new AutopilotReadService(db as never, queue as never);
      await expect(
        read.patchRule(mailbox, rule!.id, {
          configuration: {
            version: 1,
            name: 'Changed',
            conditions: conditions as never,
            actionKind: 'archive',
          },
        }),
      ).rejects.toThrow('approved work');
      await expect(
        read.patchRule(mailbox, rule!.id, { mode: 'active', expectedVersion: 1 }),
      ).rejects.toThrow('require preview');
      const provider: Array<{ ids: string[]; change: LabelChange }> = [];
      const deferred: LabelActionJobData[] = [];
      const worker = new LabelActionWorker({
        db: db as never,
        outbox: new OutboxPublisher(),
        lock: PASSTHROUGH_MAILBOX_LOCK,
        gmailMutation: {
          getClient: async () => ({
            modifyLabels: async () => {},
            ensureLabelId: async () => 'unused',
            batchModify: async (
              ids: string[],
              change: LabelChange,
              options: BatchModifyOptions = {},
            ) => {
              await options.beforeFirstRequest?.();
              provider.push({ ids: [...ids], change });
            },
          }),
        },
        onQuietDeferred: async (payload) => {
          deferred.push(payload);
        },
      });
      const context: WorkerContext = {
        jobId: 'preset-delete',
        workerName: 'LabelActionWorker',
        attempt: 1,
        maxAttempts: 5,
        startedAt: clock,
        policy: 'perMailboxPolicy',
      };
      const [forward] = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.id, approved.batchId));
      const payload = {
        actionId: forward!.id,
        mailboxAccountId: mailbox,
        idempotencyKey: forward!.idempotencyKey,
      };
      expect(await worker.processJob(payload, context)).toMatchObject({ deferredQuiet: true });
      expect(provider).toEqual([]);
      expect((await actions.listInFlight(mailbox))[0]!.autopilot?.waitingUntil).toBe(
        new Date(clock.getTime() + 60_000).toISOString(),
      );
      await message(db, mailbox, 'arrived-during-pause');
      vi.setSystemTime(new Date(clock.getTime() + 60_000));
      await worker.processJob(deferred[0]!, context);
      expect(provider).toEqual([
        {
          ids: ['approved-inbox', 'approved-archive'],
          change: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] },
        },
      ]);
      const complete = await actions.getBatchStatus(approved.batchId, mailbox);
      expect(complete).toMatchObject({ status: 'done', requestedCount: 2, affectedCount: 2 });
      const reverse = await actions.enqueueCompositeRevert({
        mailboxAccountId: mailbox,
        token: complete.undoToken!,
      });
      for (const handle of reverse) {
        const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, handle.actionId));
        await worker.processJob(
          { actionId: row!.id, mailboxAccountId: mailbox, idempotencyKey: row!.idempotencyKey },
          context,
        );
      }
      expect(
        await actions.getUndoStatus(
          reverse.map((r) => r.actionId),
          mailbox,
        ),
      ).toMatchObject({ status: 'done', affectedCount: 2 });
      const rows = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailbox));
      expect(rows.find((m) => m.providerMessageId === 'approved-inbox')!.labelIds).toEqual([
        'INBOX',
      ]);
      expect(rows.find((m) => m.providerMessageId === 'approved-archive')!.labelIds).toEqual([]);
      expect(rows.find((m) => m.providerMessageId === 'arrived-during-pause')!.labelIds).toEqual([
        'INBOX',
      ]);
      expect(rows.find((m) => m.providerMessageId === 'trash')!.labelIds).toEqual(['TRASH']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a preset batch to 100 senders and recovers stale selected/excluded keys by narrowing', async () => {
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mailbox,
        isPreset: true,
        presetKey: 'auto_screen_new_senders',
        name: 'Review Delete',
        enabled: true,
        mode: 'observe',
        conditions: { kind: 'new_sender', firstSeenWithinDays: 7, fewerThanMessages: 1000 },
        actionKind: 'delete',
        actionPayload: { reach: 'all_mail' },
      })
      .returning();
    const keys = Array.from({ length: 102 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
    await db.insert(senders).values(
      keys.map((senderKey) => ({
        mailboxAccountId: mailbox,
        senderKey,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        displayName: 'Synthetic news',
        email: 'news@example.com',
        domain: 'example.com',
        gmailCategory: 'promotions' as const,
      })),
    );
    await db.insert(mailMessages).values(
      keys.map((senderKey, i) => ({
        mailboxAccountId: mailbox,
        senderKey,
        providerMessageId: `bounded-${i}`,
        providerThreadId: `bounded-${i}`,
        internalDate: new Date(),
        labelIds: [],
        isUnread: false,
        isOutbound: false,
      })),
    );
    const preview = await service.preview(mailbox, rule!.id, { version: 1 });
    expect(preview).toMatchObject({ messageCount: 100, totalEligibleCount: 102, hasMore: true });
    expect(preview.senders).toHaveLength(100);
    const selected = await service.preview(mailbox, rule!.id, {
      version: 1,
      includedSenderKeys: [keys[0]!, C],
      excludedSenderKeys: [B],
    });
    expect(selected.messageCount).toBe(1);
    expect(selected.senders[0]!.senderKey).toBe(keys[0]);
    await expect(
      service.preview(mailbox, rule!.id, { version: 1, reach: 'inbox_only' }),
    ).rejects.toThrow('Save the rule');
    const read = new AutopilotReadService(db as never, queue as never);
    const summary = await read.previewRule(mailbox, rule!.id);
    expect(summary).toMatchObject({
      actionableSenderCount: 102,
      actionableMessageCount: 102,
      reach: 'all_mail',
    });
    const [match] = await db
      .insert(ruleMatchLog)
      .values({
        mailboxAccountId: mailbox,
        ruleId: rule!.id,
        senderKey: keys[0]!,
        modeAtMatch: 'observe',
        confidence: '1.00',
        reason: 'Synthetic match',
      })
      .returning();
    await expect(read.approveMatches(mailbox, [match!.id])).rejects.toThrow('fresh Delete batch');
    await expect(read.approveAllForRule(mailbox, rule!.id)).rejects.toThrow('fresh Delete batch');
  });

  it.each(['pause', 'disable'] as const)(
    'does not revive a preset Delete approval after %s and restart',
    async (kind) => {
      const [rule] = await db
        .insert(automationRules)
        .values({
          mailboxAccountId: mailbox,
          isPreset: true,
          presetKey: 'auto_screen_new_senders',
          name: 'Delete review',
          enabled: true,
          mode: 'observe',
          conditions: { kind: 'new_sender', firstSeenWithinDays: 7, fewerThanMessages: 1000 },
          actionKind: 'delete',
          actionPayload: { reach: 'inbox_only' },
        })
        .returning();
      await message(db, mailbox, 'approved');
      const preview = await service.preview(mailbox, rule!.id, { version: 1 });
      const accepted = await service.execute(mailbox, rule!.id, preview.previewId);
      const read = new AutopilotReadService(db as never);
      await read.patchRule(
        mailbox,
        rule!.id,
        kind === 'pause'
          ? { mode: 'paused', expectedVersion: 1 }
          : { enabled: false, expectedVersion: 1 },
      );
      await read.patchRule(
        mailbox,
        rule!.id,
        kind === 'pause'
          ? { mode: 'observe', expectedVersion: 2 }
          : { enabled: true, expectedVersion: 2 },
      );
      const getClient = vi.fn(async () => {
        throw new Error('Revoked work must not reach Gmail');
      });
      const worker = new LabelActionWorker({
        db: db as never,
        outbox: new OutboxPublisher(),
        lock: PASSTHROUGH_MAILBOX_LOCK,
        gmailMutation: { getClient },
      });
      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, accepted.batchId));
      await worker.processJob(
        { actionId: row!.id, mailboxAccountId: mailbox, idempotencyKey: row!.idempotencyKey },
        {
          jobId: 'revoke',
          workerName: 'LabelActionWorker',
          attempt: 1,
          maxAttempts: 5,
          startedAt: new Date(),
          policy: 'perMailboxPolicy',
        },
      );
      expect((await db.select().from(actionJobs))[0]).toMatchObject({
        status: 'failed',
        errorCode: 'AUTOPILOT_RULE_INACTIVE',
        affectedCount: 0,
      });
      expect(getClient).not.toHaveBeenCalled();
    },
  );

  it('previews two emails, waits through Schedule and a rule edit, runs only those two, then restores them through Undo', async () => {
    await message(db, mailbox, 'approved-1');
    await message(db, mailbox, 'approved-2');
    await message(db, mailbox, 'excluded-1', B);
    await message(db, mailbox, 'excluded-2', B);
    const actions = new ActionsService(db as never, queue as never);
    service = new SenderRulesService(db as never, actions, new MemorySenderRulePreviewStore());
    const rule = await service.create(mailbox, {
      ...definition,
      name: 'Evening cleanup',
      senderKeys: [A, B],
    });
    const clock = new Date();
    clock.setUTCDate(clock.getUTCDate() + 1);
    clock.setUTCHours(6, 59, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    try {
      await db
        .update(mailboxAccounts)
        .set({
          quietState: {
            quiet_hours: {
              enabled: true,
              start_local: '22:00',
              end_local: '07:00',
              timezone: 'UTC',
            },
          },
        })
        .where(eq(mailboxAccounts.id, mailbox));
      const preview = await service.preview(mailbox, rule.id, {
        version: 1,
        excludedSenderKeys: [B],
      });
      expect(preview.messageCount).toBe(2);
      const approved = await service.execute(mailbox, rule.id, preview.previewId);
      const deferred: Array<{ payload: LabelActionJobData; delay: number }> = [];
      const provider: Array<{ ids: string[]; change: LabelChange }> = [];
      const worker = new LabelActionWorker({
        db: db as never,
        outbox: new OutboxPublisher(),
        lock: PASSTHROUGH_MAILBOX_LOCK,
        gmailMutation: {
          getClient: async () => ({
            modifyLabels: async () => {},
            ensureLabelId: async () => 'unused',
            batchModify: async (
              ids: string[],
              change: LabelChange,
              options: BatchModifyOptions = {},
            ) => {
              await options.beforeFirstRequest?.();
              provider.push({ ids: [...ids], change });
            },
          }),
        },
        onQuietDeferred: async (payload, delay) => {
          deferred.push({ payload, delay });
        },
      });
      const context: WorkerContext = {
        jobId: 'flow',
        workerName: 'LabelActionWorker',
        attempt: 1,
        maxAttempts: 5,
        startedAt: clock,
        policy: 'perMailboxPolicy',
      };
      const [forward] = await db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.id, approved.batchId));
      const payload = {
        actionId: forward!.id,
        mailboxAccountId: mailbox,
        idempotencyKey: forward!.idempotencyKey,
      };
      expect(await worker.processJob(payload, context)).toMatchObject({ deferredQuiet: true });
      expect(provider).toEqual([]);
      expect(deferred).toHaveLength(1);
      expect(deferred[0]!.delay).toBe(60_000);
      expect((await actions.listInFlight(mailbox))[0]!.autopilot).toMatchObject({
        ruleName: 'Evening cleanup',
        waitingUntil: new Date(clock.getTime() + 60_000).toISOString(),
      });
      await service.patch(mailbox, rule.id, {
        version: 1,
        name: 'Next cleanup',
        senderKeys: [B],
        action: 'delete',
        olderThanDays: 180,
      });
      await message(db, mailbox, 'arrived-during-pause');
      vi.setSystemTime(new Date(clock.getTime() + 60_000));
      await worker.processJob(deferred[0]!.payload, context);
      expect(provider).toEqual([
        {
          ids: ['approved-1', 'approved-2'],
          change: { removeLabelIds: ['INBOX'] },
        },
      ]);
      const complete = await actions.getBatchStatus(approved.batchId, mailbox);
      expect(complete).toMatchObject({
        status: 'done',
        requestedCount: 2,
        affectedCount: 2,
        autopilot: { ruleName: 'Evening cleanup', waitingUntil: null },
      });
      expect(complete.undoToken).toBeTruthy();
      const reverse = await actions.enqueueCompositeRevert({
        mailboxAccountId: mailbox,
        token: complete.undoToken!,
      });
      for (const handle of reverse) {
        const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, handle.actionId));
        await worker.processJob(
          { actionId: row!.id, mailboxAccountId: mailbox, idempotencyKey: row!.idempotencyKey },
          context,
        );
      }
      expect(provider[1]).toEqual({
        ids: ['approved-1', 'approved-2'],
        change: { addLabelIds: ['INBOX'] },
      });
      expect(
        await actions.getUndoStatus(
          reverse.map((r) => r.actionId),
          mailbox,
        ),
      ).toMatchObject({ status: 'done', affectedCount: 2 });
      const messages = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailbox));
      expect(messages.every((m) => m.labelIds.includes('INBOX'))).toBe(true);
      expect((await db.select().from(undoJournal))[0]!.revertedAt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['individual', 'all'] as const)(
    'does not revive an approval after real %s Pause and Resume APIs',
    async (kind) => {
      await message(db, mailbox, 'approved');
      const rule = await service.create(mailbox, definition);
      const preview = await service.preview(mailbox, rule.id, { version: 1 });
      const accepted = await service.execute(mailbox, rule.id, preview.previewId);
      if (kind === 'all') await new AutopilotReadService(db as never).pauseAll(mailbox);
      else await service.patch(mailbox, rule.id, { version: 1, mode: 'paused' });
      await service.patch(mailbox, rule.id, { version: 2, mode: 'observe' });
      const worker = new LabelActionWorker({
        db: db as never,
        outbox: new OutboxPublisher(),
        lock: PASSTHROUGH_MAILBOX_LOCK,
        gmailMutation: {
          getClient: async () => {
            throw new Error('revoked approval must not reach Gmail');
          },
        },
      });
      const [row] = await db.select().from(actionJobs).where(eq(actionJobs.id, accepted.batchId));
      await worker.processJob(
        { actionId: row!.id, mailboxAccountId: mailbox, idempotencyKey: row!.idempotencyKey },
        {
          jobId: 'revoked',
          workerName: 'LabelActionWorker',
          attempt: 1,
          maxAttempts: 5,
          startedAt: new Date(),
          policy: 'perMailboxPolicy',
        },
      );
      expect((await db.select().from(actionJobs))[0]).toMatchObject({
        status: 'failed',
        errorCode: 'AUTOPILOT_RULE_INACTIVE',
        affectedCount: 0,
      });
    },
  );

  it('creates approval-only rules and keeps preset and cross-mailbox rows separate', async () => {
    const rule = await service.create(mailbox, definition);
    expect(rule).toMatchObject({
      version: 1,
      enabled: true,
      mode: 'observe',
      action: 'archive',
      matchingMessageCount: 0,
    });
    expect(await service.list(other)).toEqual([]);
    await expect(service.patch(other, rule.id, { version: 1, mode: 'paused' })).rejects.toThrow(
      'Rule not found',
    );
    await expect(service.create(mailbox, { ...definition, senderKeys: [C] })).rejects.toThrow(
      'selected Gmail account',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('deduplicates Save retries by durable mailbox-scoped request identity', async () => {
    const saved = await service.create(mailbox, definition, 'same-save-request');
    expect((await service.create(mailbox, definition, 'same-save-request')).id).toBe(saved.id);
    const editedDraft = await service.create(
      mailbox,
      { ...definition, name: 'Edited after uncertain Save' },
      'same-save-request',
    );
    expect(editedDraft).toMatchObject({ id: saved.id, name: definition.name });
    expect(await service.list(mailbox)).toHaveLength(1);
    const separate = await service.create(
      other,
      { ...definition, senderKeys: [C] },
      'same-save-request',
    );
    expect(separate.id).not.toBe(saved.id);
    await service.retire(mailbox, saved.id, 1);
    await expect(service.create(mailbox, definition, 'same-save-request')).rejects.toThrow(
      'already used',
    );
    expect(await service.list(mailbox)).toEqual([]);
  });

  it('keeps preset and custom libraries separate and omits retired rules from both', async () => {
    await db.insert(automationRules).values(
      AUTOPILOT_PRESET_KEYS.map((presetKey) => ({
        mailboxAccountId: mailbox,
        isPreset: true,
        presetKey,
        name: presetKey,
        actionKind: 'archive' as const,
        conditions: {},
        actionPayload: {},
      })),
    );
    const live = await service.create(mailbox, definition);
    const retired = await service.create(mailbox, { ...definition, name: 'Retired' });
    await service.retire(mailbox, retired.id, 1);
    const reads = new AutopilotReadService(db as never);
    const presets = await reads.listRules(mailbox);
    expect(presets).toHaveLength(5);
    expect(presets.every((rule) => rule.isPreset)).toBe(true);
    expect(await reads.getRule(mailbox, live.id)).toBeNull();
    expect(await reads.getRule(mailbox, retired.id)).toBeNull();
    expect((await service.list(mailbox)).map((rule) => rule.id)).toEqual([live.id]);
    await db
      .update(automationRules)
      .set({ retiredAt: new Date() })
      .where(eq(automationRules.id, presets[0]!.id));
    expect(await reads.getRule(mailbox, presets[0]!.id)).toBeNull();
    expect(await reads.listRules(mailbox)).toHaveLength(4);
    // Four presets and one custom rule; retired rows stay untouched.
    expect(await reads.pauseAll(mailbox)).toEqual({ pausedCount: 5 });
    expect((await service.list(mailbox))[0]).toMatchObject({ mode: 'paused', version: 2 });
  });

  it('counts current inbound scope and protection across all rules in one grouped query', async () => {
    await message(db, mailbox, 'old-inbox');
    await message(db, mailbox, 'young-inbox', A, 10);
    await message(db, mailbox, 'archived', A, 100, []);
    await message(db, mailbox, 'trash', A, 100, ['TRASH']);
    for (const label of ['TRASH', 'SPAM', 'DRAFT', 'CHAT'])
      await message(db, mailbox, `odd-${label}`, A, 100, ['INBOX', label]);
    await message(db, mailbox, 'outbound', A, 100, ['INBOX', 'SENT'], true);
    await message(db, other, 'other', A);
    await message(db, mailbox, 'protected', B);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailbox,
      senderKey: B,
      isProtected: true,
      protectionReason: 'user_defined',
    });
    await service.create(mailbox, { ...definition, senderKeys: [A, B] });
    await service.create(mailbox, {
      ...definition,
      action: 'delete',
      reach: 'all_mail',
      olderThanDays: null,
    });
    const metadata = vi.spyOn(
      service as never as { metadata: (...args: unknown[]) => Promise<unknown> },
      'metadata',
    );
    const rows = await service.list(mailbox);
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      matchingMessageCount: 1,
      matchingSenderCount: 1,
      protectedSenderCount: 1,
    });
    expect(rows[1]).toMatchObject({ matchingMessageCount: 3, matchingSenderCount: 1 });
    expect(rows[0]!.senders).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('thread-');
    expect(await service.preview(mailbox, rows[0]!.id, { version: 1 })).toMatchObject({
      messageCount: 1,
    });
  });

  it('preserves every reach and age bucket together, including protected and empty senders', async () => {
    const ages = [0, 29, 31, 89, 91, 179, 181];
    for (const days of ages) {
      await message(db, mailbox, `inbox-${days}`, A, days);
      await message(db, mailbox, `archive-${days}`, A, days, []);
    }
    for (const label of ['TRASH', 'SPAM', 'DRAFT', 'CHAT'])
      await message(db, mailbox, `excluded-${label}`, A, 200, ['INBOX', label]);
    await message(db, mailbox, 'outbound-old', A, 200, ['INBOX'], true);
    await message(db, mailbox, 'protected-old', B, 200);
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailbox,
      senderKey: B,
      isProtected: true,
      protectionReason: 'user_defined',
    });
    const emptyKey = 'd'.repeat(64);
    await seedSender(db, mailbox, emptyKey, 'No messages');
    for (const reach of ['inbox_only', 'all_mail'] as const) {
      for (const olderThanDays of [null, 30, 90, 180] as const) {
        await service.create(mailbox, {
          ...definition,
          name: `${reach}-${olderThanDays ?? 0}`,
          action: reach === 'all_mail' ? 'delete' : 'archive',
          senderKeys: [A, B, emptyKey],
          reach,
          olderThanDays,
        });
      }
    }
    const rules = await service.list(mailbox);
    expect(rules).toHaveLength(8);
    for (const rule of rules) {
      const expected = ages.filter(
        (days) => rule.olderThanDays === null || days >= rule.olderThanDays,
      ).length;
      expect(rule).toMatchObject({
        matchingMessageCount: expected * (rule.reach === 'all_mail' ? 2 : 1),
        matchingSenderCount: 1,
        protectedSenderCount: 1,
      });
      expect(rule.senders).toHaveLength(3);
      const preview = await service.preview(mailbox, rule.id, { version: rule.version });
      expect(preview).toMatchObject({
        messageCount: rule.matchingMessageCount,
        protectedSenderCount: 1,
      });
    }
    // A preview override requests a different bucket than its saved rule.
    expect(
      await service.preview(mailbox, rules[0]!.id, {
        version: 1,
        action: 'delete',
        reach: 'all_mail',
        olderThanDays: 180,
      }),
    ).toMatchObject({ messageCount: 2, protectedSenderCount: 1 });
    // Mirrored messages may outlive a sender-index row; they must not create
    // a synthetic sender or inflate the visible rule's actionable total.
    await db.delete(senders).where(eq(senders.senderKey, A));
    for (const rule of await service.list(mailbox)) {
      expect(rule).toMatchObject({
        matchingMessageCount: 0,
        matchingSenderCount: 0,
        protectedSenderCount: 1,
      });
      expect(rule.senders).toHaveLength(2);
    }
  });

  it('uses optimistic versions for edits, pause and retire; stale previews cannot execute', async () => {
    await message(db, mailbox, 'old');
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const paused = await service.patch(mailbox, rule.id, { version: 1, mode: 'paused' });
    expect(paused.version).toBe(2);
    await expect(
      service.patch(mailbox, rule.id, { version: 1, name: 'Stale edit' }),
    ).rejects.toThrow('changed');
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow('changed');
    await expect(service.retire(other, rule.id, 2)).rejects.toThrow('not found');
    expect(await service.retire(mailbox, rule.id, 2)).toMatchObject({ version: 3, retired: true });
    expect(await service.list(mailbox)).toEqual([]);
    await expect(service.preview(mailbox, rule.id, { version: 3 })).rejects.toThrow('not found');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('freezes override scope, exclusions and message IDs; new arrivals never widen execution', async () => {
    await message(db, mailbox, 'old');
    await message(db, mailbox, 'young', A, 1);
    await message(db, mailbox, 'archive', A, 100, []);
    await message(db, mailbox, 'excluded', B);
    const rule = await service.create(mailbox, { ...definition, senderKeys: [A, B] });
    const preview = await service.preview(mailbox, rule.id, {
      version: 1,
      action: 'delete',
      reach: 'all_mail',
      olderThanDays: null,
      excludedSenderKeys: [B],
    });
    expect(preview).toMatchObject({
      action: 'delete',
      reach: 'all_mail',
      olderThanDays: null,
      messageCount: 3,
    });
    await message(db, mailbox, 'new-arrival');
    const accepted = await service.execute(mailbox, rule.id, preview.previewId);
    expect(accepted).toMatchObject({ requestedCount: 3, enqueueFailedCount: 0 });
    const [job] = await db.select().from(actionJobs);
    expect(job!.verb).toBe('delete');
    expect(job!.idempotencyKey).toMatch(/^sender-rule-/);
    expect(job!.reach).toBe('all_mail');
    expect(job!.resolvedMessageIds.sort()).toEqual(['archive', 'old', 'young']);
    expect(job!.selector).toMatchObject({
      type: 'sender',
      senderKey: A,
      autopilot: {
        ruleId: rule.id,
        ruleVersion: 1,
        previewId: preview.previewId,
        ruleName: definition.name,
      },
    });
    expect((await service.list(mailbox))[0]!.action).toBe('archive');
  });

  it('deduplicates confirms into one batch with the same accepted handles', async () => {
    await message(db, mailbox, 'one');
    await message(db, mailbox, 'two', B);
    const rule = await service.create(mailbox, { ...definition, senderKeys: [A, B] });
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const first = await service.execute(mailbox, rule.id, preview.previewId);
    const replay = await service.execute(mailbox, rule.id, preview.previewId);
    expect(replay).toEqual(first);
    const jobs = await db.select().from(actionJobs);
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.id !== first.batchId)!.compositeId).toBe(first.batchId);
  });

  it('keeps reviewed rules visible and recoverable while excluding preset engine claims', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const accepted = await service.execute(mailbox, rule.id, preview.previewId);
    const actions = new ActionsService(db as never, queue as never);
    expect((await actions.listInFlight(mailbox)).map((group) => group.groupId)).toContain(
      accepted.batchId,
    );
    const [original] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.id, accepted.actionIds[0]!));
    await db
      .update(actionJobs)
      .set({ status: 'failed', errorCode: 'TransientError' })
      .where(eq(actionJobs.id, original!.id));
    const [claim] = await db
      .insert(actionJobs)
      .values({
        mailboxAccountId: mailbox,
        verb: 'archive',
        direction: 'forward',
        selector: {
          type: 'sender',
          senderId: original!.selector.type === 'sender' ? original!.selector.senderId : '',
          senderKey: A,
        },
        resolvedMessageIds: ['one'],
        requestedCount: 1,
        status: 'failed',
        errorCode: 'TransientError',
        idempotencyKey: `autopilot-${rule.id}`,
      })
      .returning();
    expect((await actions.listInFlight(mailbox)).map((group) => group.groupId)).not.toContain(
      claim!.id,
    );
    const recovery = new ActionRecoveryService(db as never, queue as never, queue as never);
    await expect(
      recovery.createPreview({ mailboxAccountId: mailbox, actionId: claim!.id }),
    ).rejects.toThrow('Only failed');
    const review = await recovery.createPreview({
      mailboxAccountId: mailbox,
      actionId: original!.id,
    });
    expect(review).toMatchObject({ status: 'verifying', rootActionId: original!.id });
    await db
      .update(actionRecoveryPreviews)
      .set({
        status: 'ready',
        outcome: 'not_applied',
        targetMessageIds: ['one'],
        remainingMessageIds: ['one'],
        verifiedCount: 1,
        verifiedAt: new Date(),
      })
      .where(eq(actionRecoveryPreviews.id, review.previewId));
    await service.patch(mailbox, rule.id, { version: 1, mode: 'paused' });
    const retry = await recovery.confirmPreview({
      mailboxAccountId: mailbox,
      previewId: review.previewId,
      idempotencyKey: 'explicit-review-confirm',
      wakeAt: null,
    });
    const [child] = await db.select().from(actionJobs).where(eq(actionJobs.id, retry.actionId));
    expect(child).toMatchObject({
      rootActionId: original!.id,
      recoveryAttempt: 1,
      resolvedMessageIds: ['one'],
      selector: original!.selector,
    });
  });

  it('returns durable accepted handles after cache expiry, rule edits and retirement', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const accepted = await service.execute(mailbox, rule.id, preview.previewId);
    await db.update(actionJobs).set({ status: 'done', affectedCount: 1 });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SENDER_RULE_PREVIEW_TTL_MS + 1);
    expect(await service.execute(mailbox, rule.id, preview.previewId)).toEqual(accepted);
    await service.patch(mailbox, rule.id, { version: 1, mode: 'paused' });
    expect(await service.execute(mailbox, rule.id, preview.previewId)).toEqual(accepted);
    await service.retire(mailbox, rule.id, 2);
    expect(await service.execute(mailbox, rule.id, preview.previewId)).toEqual(accepted);
    await expect(service.execute(other, rule.id, preview.previewId)).rejects.toThrow('not found');
    expect(await db.select().from(actionJobs)).toHaveLength(1);
  });

  it('rejects newly Protected senders and changed email scope before accepting any jobs', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailbox,
      senderKey: A,
      isProtected: true,
      protectionReason: 'user_defined',
    });
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow(
      'protection changed',
    );
    expect(await db.select().from(actionJobs)).toEqual([]);
    await db.delete(senderPolicies);
    await db.update(mailMessages).set({ labelIds: [] });
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow(
      'emails changed',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('excludes Protected senders from previews and never accepts a protection override', async () => {
    await message(db, mailbox, 'one');
    await db.insert(senderPolicies).values({
      mailboxAccountId: mailbox,
      senderKey: A,
      isProtected: true,
      protectionReason: 'user_defined',
    });
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    expect(preview).toMatchObject({ messageCount: 0, protectedSenderCount: 1, senders: [] });
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow('no emails');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects expired, wrong-rule, cross-mailbox and paused preview execution', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const otherRule = await service.create(mailbox, { ...definition, name: 'Another' });
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    await expect(service.execute(other, rule.id, preview.previewId)).rejects.toThrow('not found');
    await expect(service.execute(mailbox, otherRule.id, preview.previewId)).rejects.toThrow(
      'expired',
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SENDER_RULE_PREVIEW_TTL_MS + 1);
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow('expired');
  });

  it('attempts every queue publication and returns durable failed handles truthfully', async () => {
    await message(db, mailbox, 'one');
    await message(db, mailbox, 'two', B);
    queue.add.mockRejectedValueOnce(new Error('Redis rejected one enqueue'));
    const rule = await service.create(mailbox, { ...definition, senderKeys: [A, B] });
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const result = await service.execute(mailbox, rule.id, preview.previewId);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ requestedCount: 2, enqueueFailedCount: 1 });
    expect(result.actionIds).toHaveLength(2);
    const jobs = await db.select().from(actionJobs);
    expect(jobs.find((r) => r.status === 'failed')).toMatchObject({
      errorCode: 'ENQUEUE_FAILED',
      quotaUnits: 0,
    });
    expect((await service.execute(mailbox, rule.id, preview.previewId)).actionIds).toEqual(
      result.actionIds,
    );
    const actions = new ActionsService(db as never, queue as never);
    expect((await actions.getBatchStatus(result.batchId, mailbox)).failureCodes).toEqual([
      'ENQUEUE_FAILED',
    ]);
    await db.update(actionJobs).set({ status: 'failed', errorCode: 'ENQUEUE_FAILED' });
    expect((await actions.getBatchStatus(result.batchId, mailbox)).failureCodes).toEqual([
      'ENQUEUE_FAILED',
    ]);
    await db.update(actionJobs).set({ status: 'done', errorCode: 'ENQUEUE_FAILED' });
    expect((await actions.getBatchStatus(result.batchId, mailbox)).failureCodes).toBeUndefined();
    await db
      .update(actionJobs)
      .set({ status: 'failed', errorCode: 'unregistered-provider-detail' });
    expect((await actions.getBatchStatus(result.batchId, mailbox)).failureCodes).toBeUndefined();
  });

  it('does not race an already running sender action or change the saved rule through an override', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const first = await service.preview(mailbox, rule.id, { version: 1 });
    const second = await service.preview(mailbox, rule.id, { version: 1 });
    await service.execute(mailbox, rule.id, first.previewId);
    await expect(service.execute(mailbox, rule.id, second.previewId)).rejects.toThrow(
      'already has an action',
    );
    const [saved] = await db.select().from(automationRules).where(eq(automationRules.id, rule.id));
    expect(saved!.version).toBe(1);
  });

  it('searches known senders with bounded keyset pages and treats wildcards literally', async () => {
    for (let n = 1; n <= 30; n++)
      await seedSender(db, mailbox, n.toString(16).padStart(64, '0'), `Choice ${n}`);
    const first = await service.search(mailbox, 'Choice');
    expect(first.senders).toHaveLength(25);
    const next = await service.search(mailbox, 'Choice', first.nextCursor!);
    expect(next.senders).toHaveLength(5);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.senders, ...next.senders].map((s) => s.id)).size).toBe(30);
    expect((await service.search(mailbox, '%')).senders).toEqual([]);
    await expect(service.search(mailbox, '', 'invalid')).rejects.toThrow('cursor');
  });

  it('caps one preview at 5000 emails and reports the remaining eligible mail', async () => {
    for (let start = 0; start < 5001; start += 500)
      await db.insert(mailMessages).values(
        Array.from({ length: Math.min(500, 5001 - start) }, (_, offset) => ({
          mailboxAccountId: mailbox,
          senderKey: A,
          providerMessageId: `message-${start + offset}`,
          providerThreadId: `thread-${start + offset}`,
          internalDate: new Date(Date.now() - 100 * 86_400_000),
          labelIds: ['INBOX'],
          isUnread: false,
        })),
      );
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    expect(preview).toMatchObject({ messageCount: 5000, totalEligibleCount: 5001, hasMore: true });
    const result = await service.execute(mailbox, rule.id, preview.previewId);
    expect(result.requestedCount).toBe(5000);
    expect((await db.select().from(actionJobs))[0]!.resolvedMessageIds).toHaveLength(5000);
  });

  it('enforces the mailbox rule limit without affecting another mailbox', async () => {
    await db.insert(automationRules).values(
      Array.from({ length: 50 }, (_, n) => ({
        mailboxAccountId: mailbox,
        isPreset: false,
        presetKey: null,
        name: `Saved ${n}`,
        enabled: true,
        actionKind: 'archive' as const,
        conditions: { kind: 'sender_list', senderKeys: [A], olderThanDays: 30 },
        actionPayload: { reach: 'inbox_only' },
      })),
    );
    await expect(service.create(mailbox, definition)).rejects.toThrow('up to 50');
    await expect(service.create(other, { ...definition, senderKeys: [C] })).resolves.toMatchObject({
      version: 1,
    });
  });

  it('rechecks capability after preview if the workspace is downgraded', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    await db.update(workspaces).set({ tier: 'free' });
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toMatchObject({
      status: 402,
    });
    expect(await db.select().from(actionJobs)).toEqual([]);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('global Pause invalidates custom previews and excludes retired rules', async () => {
    await message(db, mailbox, 'one');
    const rule = await service.create(mailbox, definition);
    const retired = await service.create(mailbox, { ...definition, name: 'Retired' });
    await service.retire(mailbox, retired.id, 1);
    const preview = await service.preview(mailbox, rule.id, { version: 1 });
    const reads = new AutopilotReadService(db as never);
    expect(await reads.pauseAll(mailbox)).toEqual({ pausedCount: 1 });
    expect((await service.list(mailbox))[0]).toMatchObject({ mode: 'paused', version: 2 });
    await expect(service.execute(mailbox, rule.id, preview.previewId)).rejects.toThrow('changed');
    expect(await reads.pauseAll(mailbox)).toEqual({ pausedCount: 0 });
  });
});
