import { describe, expect, it, vi } from 'vitest';
import type { LabelActionJobData } from '@declutrmail/workers';
import { senderRuleQuietResume } from './sender-rule-quiet-queue.js';

describe('sender-rule quiet delivery', () => {
  const payload: LabelActionJobData = {
    actionId: 'a9700000-0000-4000-8000-000000000001',
    mailboxAccountId: 'a9700000-0000-4000-8000-000000000003',
    idempotencyKey: 'same-approved-action',
  };

  it('retains both deliveries when quiet is extended within the same minute', async () => {
    const add = vi.fn().mockResolvedValue({});
    const defer = senderRuleQuietResume({ add });
    await defer(payload, 5000);
    await defer(payload, 35000);
    const first = add.mock.calls[0]![2];
    const second = add.mock.calls[1]![2];
    expect(first.jobId).not.toBe(second.jobId);
    expect(first.delay).toBe(5000);
    expect(second.delay).toBe(35000);
    expect(add.mock.calls.map((call) => call[1])).toEqual([payload, payload]);
  });

  it('propagates a queue failure so the original delivery can retry', async () => {
    const defer = senderRuleQuietResume({ add: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(defer(payload, 0)).rejects.toThrow('offline');
  });
});
