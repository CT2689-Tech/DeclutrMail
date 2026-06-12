import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailService, type ResendLikeClient } from './email.service.js';
import type { EmailSuppressionService } from './email-suppression.service.js';

/**
 * EmailService tests (D162) — fail-closed posture, suppression-before-
 * send ordering, and provider error classification. No network: the
 * Resend client is the injected fake.
 */

const INPUT = {
  to: 'a@b.com',
  subject: 's',
  text: 't',
  idempotencyKey: 'k1',
};

function fakeSuppression(suppressed: boolean): EmailSuppressionService {
  return {
    isSuppressed: vi.fn().mockResolvedValue(suppressed),
    suppress: vi.fn(),
  } as unknown as EmailSuppressionService;
}

function fakeClient(
  result: Awaited<ReturnType<ResendLikeClient['emails']['send']>>,
): ResendLikeClient & { emails: { send: ReturnType<typeof vi.fn> } } {
  return { emails: { send: vi.fn().mockResolvedValue(result) } };
}

describe('EmailService', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  });

  it('fail-closed: refuses every send with a typed outcome when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const suppression = fakeSuppression(false);
    const service = new EmailService(suppression);

    expect(service.enabled).toBe(false);
    const outcome = await service.deliver(INPUT);
    expect(outcome).toEqual({
      ok: false,
      reason: 'disabled',
      detail: 'RESEND_API_KEY is not configured.',
    });
    // Refusal happens before any suppression lookup or network call.
    expect(suppression.isSuppressed).not.toHaveBeenCalled();
  });

  it('checks the suppression list BEFORE calling the provider', async () => {
    const client = fakeClient({ data: { id: 'x' }, error: null });
    const service = new EmailService(fakeSuppression(true), client);

    const outcome = await service.deliver(INPUT);
    expect(outcome).toMatchObject({ ok: false, reason: 'suppressed' });
    expect(client.emails.send).not.toHaveBeenCalled();
  });

  it('sends with the locked From and forwards the idempotency key', async () => {
    const client = fakeClient({ data: { id: 'rsnd_9' }, error: null });
    const service = new EmailService(fakeSuppression(false), client);

    const outcome = await service.deliver(INPUT);
    expect(outcome).toEqual({ ok: true, providerId: 'rsnd_9' });
    expect(client.emails.send).toHaveBeenCalledWith(
      {
        from: 'DeclutrMail <hello@send.declutrmail.com>',
        to: 'a@b.com',
        subject: 's',
        text: 't',
      },
      { idempotencyKey: 'k1' },
    );
  });

  it('classifies provider 4xx as permanent', async () => {
    const client = fakeClient({
      data: null,
      error: { message: 'bad from', statusCode: 422, name: 'invalid_from_address' },
    });
    const service = new EmailService(fakeSuppression(false), client);
    const outcome = await service.deliver(INPUT);
    expect(outcome).toMatchObject({ ok: false, reason: 'permanent' });
  });

  it('classifies provider 5xx and rate limits as transient', async () => {
    const cases = [
      { message: 'oops', statusCode: 500, name: 'internal_server_error' },
      { message: 'slow down', statusCode: 429, name: 'rate_limit_exceeded' },
      { message: 'no status', statusCode: null, name: 'application_error' },
    ];
    for (const error of cases) {
      const service = new EmailService(fakeSuppression(false), fakeClient({ data: null, error }));
      const outcome = await service.deliver(INPUT);
      expect(outcome).toMatchObject({ ok: false, reason: 'transient' });
    }
  });

  it('classifies a thrown transport error as transient', async () => {
    const client: ResendLikeClient = {
      emails: { send: vi.fn().mockRejectedValue(new Error('ECONNRESET')) },
    };
    const service = new EmailService(fakeSuppression(false), client);
    const outcome = await service.deliver(INPUT);
    expect(outcome).toMatchObject({ ok: false, reason: 'transient', detail: 'ECONNRESET' });
  });
});
