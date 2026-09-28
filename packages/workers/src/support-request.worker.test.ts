import { describe, expect, it, vi } from 'vitest';
import { SupportRequestWorker, type SupportRequestJobData } from './support-request.worker.js';
import { supportRequestJobOptions } from './support-request.queue.js';
import { TransientError, ValidationError } from './worker-errors.js';
const payload: SupportRequestJobData = {
  subject: 'Help please',
  message: 'Private support message',
  replyTo: 'user@example.com',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  submittedAt: '2026-09-22T00:00:00.000Z',
  idempotencyKey: `support-request__${'a'.repeat(64)}`,
};
describe('SupportRequestWorker', () => {
  it('retries transient failures using the same provider key and reports only actual successful delivery', async () => {
    const deliver = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'transient', detail: payload.message })
      .mockResolvedValue({ ok: true, providerId: 'test' });
    const worker = new SupportRequestWorker({ deliver });
    await expect(worker.processJob(payload, {} as never)).rejects.toThrow(TransientError);
    await expect(worker.processJob(payload, {} as never)).resolves.toEqual({
      providerAccepted: true,
    });
    expect(deliver.mock.calls[0]![0].idempotencyKey).toBe(deliver.mock.calls[1]![0].idempotencyKey);
    expect(supportRequestJobOptions(payload.idempotencyKey)).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  });
  it.each(['disabled', 'suppressed', 'permanent'])(
    'fails closed for %s without exposing provider detail',
    async (reason) => {
      const worker = new SupportRequestWorker({
        deliver: vi.fn().mockResolvedValue({ ok: false, reason, detail: payload.message }),
      });
      await expect(worker.processJob(payload, {} as never)).rejects.toThrow(ValidationError);
      await expect(worker.processJob(payload, {} as never)).rejects.not.toThrow(payload.message);
    },
  );
  it('terminal failure alerts through the base worker without persisting support text or reply-to', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const worker = new SupportRequestWorker({
      deliver: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: 'transient', detail: payload.message }),
    });
    worker.setDeadLetterRecorder({ record });
    const job = {
      id: payload.idempotencyKey,
      data: payload,
      queueName: 'support-request',
      attemptsMade: 2,
    };
    await expect(worker.run(job as never)).rejects.toThrow(TransientError);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'support-request', payload: { userId: payload.userId } }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain(payload.message);
    expect(JSON.stringify(record.mock.calls)).not.toContain(payload.replyTo);
  });
  it('keeps provider payload stable across repeated completed submissions and deletes completed queue bodies', async () => {
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'fake' });
    const worker = new SupportRequestWorker({ deliver });
    await worker.processJob(payload, {} as never);
    await worker.processJob({ ...payload, submittedAt: '2026-09-22T00:01:00.000Z' }, {} as never);
    expect(deliver.mock.calls[0]).toEqual(deliver.mock.calls[1]);
    expect(supportRequestJobOptions(payload.idempotencyKey).removeOnComplete).toBe(true);
  });
  it('redacts thrown transport errors and rejects malformed/oversized or recipient-injected payloads before sending', async () => {
    const deliver = vi.fn().mockRejectedValue(new Error(payload.message));
    const worker = new SupportRequestWorker({ deliver });
    await expect(worker.processJob(payload, {} as never)).rejects.toThrow(
      'Support delivery transport failed',
    );
    deliver.mockClear();
    for (const invalid of [
      { ...payload, message: 'x'.repeat(5001) },
      { ...payload, to: 'other@example.com' },
      { ...payload, replyTo: 'bad\naddress' },
    ]) {
      await expect(worker.processJob(invalid, {} as never)).rejects.toThrow(ValidationError);
    }
    expect(deliver).not.toHaveBeenCalled();
  });
});
