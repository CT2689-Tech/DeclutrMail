import {
  actionJobs,
  automationRules,
  mailMessages,
  mailboxAccounts,
  senderPolicies,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ActionsService } from '../actions/actions.service.js';
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
    expect(job!.reach).toBe('all_mail');
    expect(job!.resolvedMessageIds.sort()).toEqual(['archive', 'old', 'young']);
    expect(job!.selector).toMatchObject({
      type: 'sender',
      senderKey: A,
      autopilot: { ruleId: rule.id, ruleVersion: 1, previewId: preview.previewId },
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
