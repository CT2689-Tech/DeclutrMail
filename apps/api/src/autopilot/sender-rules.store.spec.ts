import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemorySenderRulePreviewStore,
  RedisSenderRulePreviewStore,
  SENDER_RULE_PREVIEW_TTL_MS,
} from './sender-rules.store.js';

const input = {
  mailboxId: 'mailbox-a',
  ruleId: 'rule-a',
  ruleVersion: 2,
  action: 'delete' as const,
  reach: 'all_mail' as const,
  olderThanDays: 30,
  targets: [{ senderId: 'sender-a', senderKey: 'a'.repeat(64), messageIds: ['m1'] }],
};

afterEach(() => vi.useRealTimers());

describe('sender-rule preview snapshots', () => {
  it('scopes reads by mailbox and rule and expires after five minutes', async () => {
    vi.useFakeTimers();
    const store = new MemorySenderRulePreviewStore();
    const saved = await store.create(input);
    expect(await store.read('mailbox-b', input.ruleId, saved.previewId)).toBeNull();
    expect(await store.read(input.mailboxId, 'rule-b', saved.previewId)).toBeNull();
    expect(await store.read(input.mailboxId, input.ruleId, saved.previewId)).toEqual(saved);
    vi.advanceTimersByTime(SENDER_RULE_PREVIEW_TTL_MS);
    expect(await store.read(input.mailboxId, input.ruleId, saved.previewId)).toBeNull();
  });

  it('does not allow callers to widen a stored target set through object aliases', async () => {
    const store = new MemorySenderRulePreviewStore();
    const value = structuredClone(input);
    const saved = await store.create(value);
    value.targets[0]!.messageIds.push('new-arrival');
    saved.targets[0]!.messageIds.push('forged');
    const read = await store.read(input.mailboxId, input.ruleId, saved.previewId);
    expect(read!.targets[0]!.messageIds).toEqual(['m1']);
    read!.targets[0]!.messageIds.push('forged-again');
    expect(
      (await store.read(input.mailboxId, input.ruleId, saved.previewId))!.targets[0]!.messageIds,
    ).toEqual(['m1']);
  });

  it('rejects oversized target sets and evicts old local snapshots', async () => {
    const store = new MemorySenderRulePreviewStore();
    await expect(
      store.create({
        ...input,
        targets: [
          { ...input.targets[0]!, messageIds: Array.from({ length: 5001 }, (_, n) => `m${n}`) },
        ],
      }),
    ).rejects.toThrow('execution limit');
    const oldest = await store.create(input);
    for (let n = 0; n < 64; n++) await store.create(input);
    expect(await store.read(input.mailboxId, input.ruleId, oldest.previewId)).toBeNull();
  });

  it('writes Redis atomically with TTL and fails closed on an unavailable cache', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockRejectedValue(new Error('connection failed')),
    };
    const store = new RedisSenderRulePreviewStore(redis as never);
    const saved = await store.create(input);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      2,
      expect.stringContaining(input.mailboxId),
      expect.stringContaining(saved.previewId),
      expect.any(String),
      JSON.stringify(saved),
      String(SENDER_RULE_PREVIEW_TTL_MS),
      String(Date.parse(saved.expiresAt)),
      '16',
    );
    await expect(store.read(input.mailboxId, input.ruleId, saved.previewId)).rejects.toThrow(
      'Could not load',
    );
    redis.eval.mockRejectedValue(new Error('connection failed'));
    await expect(store.create(input)).rejects.toThrow('Could not save');
  });
});
