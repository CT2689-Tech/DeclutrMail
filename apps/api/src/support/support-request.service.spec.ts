import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { SupportRequestWorker, type SupportRequestJobData } from '@declutrmail/workers';
import { AppException } from '../common/app-exception.js';
import type { UsersService } from '../users/users.service.js';
import { SupportRequestService } from './support-request.service.js';
const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' };
const PAYLOAD = { subject: 'Cannot connect Gmail', message: 'I keep hitting an error at step 2.' };
const users = (email: string | null = 'user@example.com') =>
  ({ findById: vi.fn().mockResolvedValue(email ? { email } : null) }) as unknown as UsersService;
function queue(state = 'waiting') {
  return { add: vi.fn().mockResolvedValue({ getState: vi.fn().mockResolvedValue(state) }) };
}
const castQueue = (q: ReturnType<typeof queue>) => q as unknown as Queue<SupportRequestJobData>;

describe('SupportRequestService durable acceptance', () => {
  it('enqueues validated data, then worker sends fixed recipient with authenticated reply-to', async () => {
    const q = queue();
    const service = new SupportRequestService(users(), castQueue(q));
    const result = await service.submit(
      { ...PRINCIPAL, sessionId: 'extra-auth-field' } as typeof PRINCIPAL,
      PAYLOAD,
    );
    expect(result).toEqual({ status: 'accepted', submittedAt: expect.any(String) });
    const [name, job, options] = q.add.mock.calls[0]!;
    expect(name).toBe('support-request');
    expect(options).toMatchObject({ jobId: job.idempotencyKey, attempts: 3 });
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'fake' });
    await new SupportRequestWorker({ deliver }).processJob(job, {} as never);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@declutrmail.com',
        replyTo: 'user@example.com',
        subject: 'Support request: Cannot connect Gmail',
        idempotencyKey: job.idempotencyKey,
      }),
    );
    expect(deliver.mock.calls[0]![0].text).toContain(PAYLOAD.message);
  });
  it('does not acknowledge before durable enqueue resolves', async () => {
    const q = queue();
    let release!: (job: unknown) => void;
    q.add.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let accepted = false;
    const pending = new SupportRequestService(users(), castQueue(q))
      .submit(PRINCIPAL, PAYLOAD)
      .then(() => {
        accepted = true;
      });
    await vi.waitFor(() => expect(q.add).toHaveBeenCalled());
    expect(accepted).toBe(false);
    release({ getState: async () => 'waiting' });
    await pending;
    expect(accepted).toBe(true);
  });
  it('never acknowledges missing queues, failed enqueue, failed existing jobs or missing reply address', async () => {
    await expect(
      new SupportRequestService(users(), null).submit(PRINCIPAL, PAYLOAD),
    ).rejects.toThrow(AppException);
    const q = queue();
    q.add.mockRejectedValue(new Error('private provider data'));
    await expect(
      new SupportRequestService(users(), castQueue(q)).submit(PRINCIPAL, PAYLOAD),
    ).rejects.toThrow(AppException);
    await expect(
      new SupportRequestService(users(), castQueue(queue('failed'))).submit(PRINCIPAL, PAYLOAD),
    ).rejects.toThrow(AppException);
    const missing = queue();
    await expect(
      new SupportRequestService(users(null), castQueue(missing)).submit(PRINCIPAL, PAYLOAD),
    ).rejects.toThrow(AppException);
    expect(missing.add).not.toHaveBeenCalled();
  });
  it('deduplicates retries, separates edited messages and rejects caller-controlled recipients', async () => {
    const q = queue();
    const service = new SupportRequestService(users(), castQueue(q));
    await service.submit(PRINCIPAL, PAYLOAD);
    await service.submit(PRINCIPAL, PAYLOAD);
    await service.submit(PRINCIPAL, { ...PAYLOAD, message: PAYLOAD.message + ' edited' });
    expect(q.add.mock.calls[0]![2].jobId).toBe(q.add.mock.calls[1]![2].jobId);
    expect(q.add.mock.calls[0]![2].jobId).not.toBe(q.add.mock.calls[2]![2].jobId);
    await expect(
      service.submit(PRINCIPAL, { ...PAYLOAD, to: 'attacker@example.com' } as typeof PAYLOAD),
    ).rejects.toThrow(AppException);
  });
});
