import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import type { EmailService } from '../notifications/email.service.js';
import type { UsersService } from '../users/users.service.js';
import { SupportRequestService } from './support-request.service.js';

const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' };
const PAYLOAD = { subject: 'Cannot connect Gmail', message: 'I keep hitting an error at step 2.' };

function fakeUsers(email: string | null): UsersService {
  return {
    findById: vi.fn().mockResolvedValue(email ? { id: 'user-1', email } : null),
  } as unknown as UsersService;
}

function fakeEmail(outcome: Awaited<ReturnType<EmailService['deliver']>>): EmailService {
  return { deliver: vi.fn().mockResolvedValue(outcome) } as unknown as EmailService;
}

describe('SupportRequestService', () => {
  it('emails support@ with the user set as reply-to', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    const result = await service.submit(PRINCIPAL, PAYLOAD);

    expect(result.submittedAt).toEqual(expect.any(String));
    expect(email.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@declutrmail.com',
        replyTo: 'user@example.com',
        subject: 'Support request: Cannot connect Gmail',
      }),
    );
    const call = (email.deliver as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.text).toContain('I keep hitting an error at step 2.');
    expect(call.text).toContain('user@example.com');
    expect(call.text).toContain('user-1');
  });

  it('omits reply-to when the user row cannot be found', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers(null), email);

    await service.submit(PRINCIPAL, PAYLOAD);

    const call = (email.deliver as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call).not.toHaveProperty('replyTo');
  });

  it('throws instead of reporting success when delivery fails', async () => {
    const email = fakeEmail({ ok: false, reason: 'transient', detail: 'boom' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    await expect(service.submit(PRINCIPAL, PAYLOAD)).rejects.toThrow(AppException);
  });

  it('derives the same idempotency key for a repeated identical submission (retry dedup)', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    await service.submit(PRINCIPAL, PAYLOAD);
    await service.submit(PRINCIPAL, PAYLOAD);

    const calls = (email.deliver as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
  });

  it('derives a different idempotency key when the message content differs', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    await service.submit(PRINCIPAL, PAYLOAD);
    await service.submit(PRINCIPAL, { ...PAYLOAD, message: PAYLOAD.message + ' (edited)' });

    const calls = (email.deliver as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].idempotencyKey).not.toBe(calls[1]![0].idempotencyKey);
  });
});
