import { createHmac } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResendWebhookController } from './resend-webhook.controller.js';
import type { EmailSuppressionService } from '../../notifications/email-suppression.service.js';
import type { SecurityEventsService } from '../../security-events/security-events.service.js';

/**
 * Resend webhook controller tests (D162) — fail-closed without the
 * secret (503), 401 + D181 security event on bad signatures,
 * suppression writes on bounce/complaint, ACK-and-ignore otherwise.
 */

const RAW_SECRET = Buffer.from('test-secret-32-bytes-aaaaaaaaaaa');
const SECRET = `whsec_${RAW_SECRET.toString('base64')}`;

function makeController() {
  const suppression = {
    suppress: vi.fn().mockResolvedValue('suppressed'),
    isSuppressed: vi.fn(),
  };
  const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };
  const controller = new ResendWebhookController(
    suppression as unknown as EmailSuppressionService,
    securityEvents as unknown as SecurityEventsService,
  );
  return { controller, suppression, securityEvents };
}

function signedHeaders(
  body: string,
  id = 'msg_1',
): {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
} {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const mac = createHmac('sha256', RAW_SECRET).update(`${id}.${timestamp}.${body}`, 'utf8');
  return { svixId: id, svixTimestamp: timestamp, svixSignature: `v1,${mac.digest('base64')}` };
}

function req(body: string): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(body) } as RawBodyRequest<Request>;
}

async function expectHttpStatus(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    expect.unreachable(`expected HttpException ${status}`);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
  }
}

describe('ResendWebhookController', () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = savedSecret;
  });

  it('fail-closed: 503 when RESEND_WEBHOOK_SECRET is unset (nothing processed)', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const { controller, suppression } = makeController();
    const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.com'] } });
    const headers = signedHeaders(body);

    await expectHttpStatus(
      controller.handle(req(body), headers.svixId, headers.svixTimestamp, headers.svixSignature),
      503,
    );
    expect(suppression.suppress).not.toHaveBeenCalled();
  });

  it('401 + D181 security event on a bad signature', async () => {
    const { controller, suppression, securityEvents } = makeController();
    const body = JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.com'] } });
    const headers = signedHeaders(body);

    await expectHttpStatus(
      controller.handle(
        req(`${body} `), // tampered raw bytes
        headers.svixId,
        headers.svixTimestamp,
        headers.svixSignature,
      ),
      401,
    );
    expect(suppression.suppress).not.toHaveBeenCalled();
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'webhook.signature_failure',
        payload: expect.objectContaining({ source: 'resend' }),
      }),
    );
  });

  it('401 on missing svix headers', async () => {
    const { controller } = makeController();
    const body = JSON.stringify({ type: 'email.bounced' });
    await expectHttpStatus(controller.handle(req(body), undefined, undefined, undefined), 401);
  });

  it('suppresses every recipient of a bounce', async () => {
    const { controller, suppression } = makeController();
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { to: ['a@b.com', 'c@d.com'] },
    });
    const headers = signedHeaders(body);

    const result = await controller.handle(
      req(body),
      headers.svixId,
      headers.svixTimestamp,
      headers.svixSignature,
    );
    expect(result).toEqual({ status: 'suppressed' });
    expect(suppression.suppress).toHaveBeenCalledWith('a@b.com', 'bounce');
    expect(suppression.suppress).toHaveBeenCalledWith('c@d.com', 'bounce');
  });

  it('suppresses complaints, accepting a bare-string `to`', async () => {
    const { controller, suppression } = makeController();
    const body = JSON.stringify({ type: 'email.complained', data: { to: 'a@b.com' } });
    const headers = signedHeaders(body);

    await controller.handle(
      req(body),
      headers.svixId,
      headers.svixTimestamp,
      headers.svixSignature,
    );
    expect(suppression.suppress).toHaveBeenCalledWith('a@b.com', 'complaint');
  });

  it('ACKs-and-ignores event types it does not act on', async () => {
    const { controller, suppression } = makeController();
    const body = JSON.stringify({ type: 'email.delivered', data: { to: ['a@b.com'] } });
    const headers = signedHeaders(body);

    const result = await controller.handle(
      req(body),
      headers.svixId,
      headers.svixTimestamp,
      headers.svixSignature,
    );
    expect(result).toEqual({ status: 'ignored' });
    expect(suppression.suppress).not.toHaveBeenCalled();
  });

  it('400 on a verified-but-malformed payload', async () => {
    const { controller } = makeController();
    const body = 'not-json';
    const headers = signedHeaders(body);
    await expectHttpStatus(
      controller.handle(req(body), headers.svixId, headers.svixTimestamp, headers.svixSignature),
      400,
    );
  });

  it('400 on an empty body', async () => {
    const { controller } = makeController();
    await expectHttpStatus(
      controller.handle(
        { rawBody: undefined } as unknown as RawBodyRequest<Request>,
        'id',
        '0',
        'v1,sig',
      ),
      400,
    );
  });
});
