import { describe, expect, it, vi } from 'vitest';
import {
  enqueueSenderIndexSweepContinuation,
  senderIndexSweepJobOptions,
} from './sender-index-sweep.queue.js';
describe('durable reconciliation continuations', () => {
  it('uses stable colon-free IDs for retry dedup, separating batches and sweep cycles', async () => {
    const payload = { scheduledAtMinute: '2026-09-22T03:00', afterMailboxId: 'a-mailbox' };
    const add = vi.fn();
    await enqueueSenderIndexSweepContinuation({ add } as never, payload);
    await enqueueSenderIndexSweepContinuation({ add } as never, payload);
    expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
    const id = senderIndexSweepJobOptions(payload.scheduledAtMinute, payload.afterMailboxId).jobId;
    expect(id).not.toContain(':');
    expect(senderIndexSweepJobOptions(payload.scheduledAtMinute).jobId).not.toBe(id);
    expect(senderIndexSweepJobOptions('2026-09-23T03:00', payload.afterMailboxId).jobId).not.toBe(
      id,
    );
  });
});
