import { HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecurityEventsService } from '../../security-events/security-events.service.js';
import { GmailWebhookController } from '../gmail-webhook.controller.js';
import type { GmailWebhookService, ProcessOutcome } from '../gmail-webhook.service.js';
import type { OidcVerifyResult, PubSubOidcVerifier } from '../oidc-verifier.js';

/**
 * D181 — `webhook.signature_failure` audit emit. The controller
 * records a row at severity=warning BEFORE the existing 401 throws,
 * so a missing / wrong / replayed / expired Pub/Sub OIDC token is
 * always reflected in the audit log. The recorder is fire-and-forget;
 * `SecurityEventsService` is documented to swallow its own insert
 * failures, but the controller additionally `void`s the call so a
 * regression in that contract cannot alter the 401.
 *
 * Behavior the test pins:
 *
 *   - emit happens on EVERY failure step the verifier discriminates
 *     (sampled via a representative step=2 reason),
 *   - emit payload is the closed shape {source, reason, step, subReason}
 *     — never the raw token or the request body,
 *   - the 401 + UNAUTHORIZED envelope are unchanged (D229 contract),
 *   - a successful verify path emits no `webhook.signature_failure`
 *     (downstream success/dedup/stale outcomes are out of scope here).
 */

interface MakeOpts {
  verify: OidcVerifyResult;
}

function makeController(opts: MakeOpts): {
  controller: GmailWebhookController;
  record: ReturnType<typeof vi.fn>;
  service: { processVerifiedPush: ReturnType<typeof vi.fn> };
} {
  const verifier = {
    verify: vi.fn().mockResolvedValue(opts.verify),
  } as unknown as PubSubOidcVerifier;
  const service = {
    processVerifiedPush: vi.fn<(args: unknown) => Promise<ProcessOutcome>>(),
  };
  const record = vi.fn().mockResolvedValue(undefined);
  const securityEvents = { record } as unknown as SecurityEventsService;
  return {
    controller: new GmailWebhookController(
      verifier,
      service as unknown as GmailWebhookService,
      securityEvents,
    ),
    record,
    service,
  };
}

/** Minimal envelope; the failure path returns before parsing it. */
const ENVELOPE = {
  message: { messageId: 'pubsub-1', data: Buffer.from('{}').toString('base64') },
};

describe('GmailWebhookController.push — D181 webhook.signature_failure emit', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence the controller's `logger.warn` in unit tests; we already
    // assert the audit emit separately.
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('records webhook.signature_failure before throwing 401 on signature_invalid', async () => {
    const { controller, record } = makeController({
      verify: { ok: false, step: 2, reason: 'signature_invalid' },
    });

    await expect(controller.push('Bearer forged', ENVELOPE)).rejects.toBeInstanceOf(HttpException);

    expect(record).toHaveBeenCalledWith({
      eventType: 'webhook.signature_failure',
      severity: 'warning',
      payload: {
        source: 'pubsub.gmail',
        reason: 'oidc_verify_failed',
        step: 2,
        subReason: 'signature_invalid',
      },
    });
    consoleWarn.mockRestore();
  });

  it('still returns the D229-mandated 401 + UNAUTHORIZED envelope unchanged', async () => {
    const { controller } = makeController({
      verify: { ok: false, step: 1, reason: 'missing_authorization_header' },
    });

    try {
      await controller.push(undefined, ENVELOPE);
      throw new Error('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(http.getResponse()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'OIDC verification failed.' },
      });
    }
    consoleWarn.mockRestore();
  });

  it('carries the discriminated step+subReason for every failure mode the verifier reports', async () => {
    // Sample three steps to prove the controller passes through whatever
    // the verifier discriminates — not just the one branch above.
    const cases: Array<{
      verify: OidcVerifyResult;
      step: number;
      subReason: string;
    }> = [
      {
        verify: { ok: false, step: 3, reason: 'issuer_mismatch', iss: 'evil.example' },
        step: 3,
        subReason: 'issuer_mismatch',
      },
      {
        verify: { ok: false, step: 5, reason: 'email_mismatch', email: 'attacker@x' },
        step: 5,
        subReason: 'email_mismatch',
      },
      {
        verify: { ok: false, step: 6, reason: 'expired', exp: 1 },
        step: 6,
        subReason: 'expired',
      },
    ];

    for (const c of cases) {
      const { controller, record } = makeController({ verify: c.verify });
      await expect(controller.push('Bearer x', ENVELOPE)).rejects.toBeInstanceOf(HttpException);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'webhook.signature_failure',
          payload: expect.objectContaining({ step: c.step, subReason: c.subReason }),
        }),
      );
    }
    consoleWarn.mockRestore();
  });

  it('payload never copies the raw Authorization header bytes (regression)', async () => {
    const { controller, record } = makeController({
      verify: { ok: false, step: 2, reason: 'signature_invalid' },
    });
    const FORGED = 'Bearer eyJhbGciOiJIUzI1NiJ9.SECRET.MARKER';

    await expect(controller.push(FORGED, ENVELOPE)).rejects.toBeInstanceOf(HttpException);

    const arg = record.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(JSON.stringify(arg)).not.toContain('SECRET.MARKER');
    expect(JSON.stringify(arg)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    consoleWarn.mockRestore();
  });

  it('does not emit on a successful verify (downstream outcome handled separately)', async () => {
    const { controller, record, service } = makeController({
      verify: {
        ok: true,
        claims: {
          iss: 'https://accounts.google.com',
          aud: 'aud',
          email: 'sa@x',
          email_verified: true,
          exp: 9_999_999_999,
          iat: 1,
          sub: 's',
        },
      },
    });
    service.processVerifiedPush.mockResolvedValueOnce({
      kind: 'duplicate_message_id',
      messageId: 'pubsub-1',
    });

    await controller.push('Bearer good', {
      message: {
        messageId: 'pubsub-1',
        data: Buffer.from(
          JSON.stringify({ emailAddress: 'x@y.example', historyId: '42' }),
        ).toString('base64'),
      },
    });

    expect(record).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('accepts a numeric historyId (real Gmail pushes send a JSON number, not the string the docs show)', async () => {
    const { controller, record, service } = makeController({
      verify: {
        ok: true,
        claims: {
          iss: 'https://accounts.google.com',
          aud: 'aud',
          email: 'sa@x',
          email_verified: true,
          exp: 9_999_999_999,
          iat: 1,
          sub: 's',
        },
      },
    });
    service.processVerifiedPush.mockResolvedValueOnce({
      kind: 'duplicate_message_id',
      messageId: 'pubsub-2',
    });

    await controller.push('Bearer good', {
      message: {
        messageId: 'pubsub-2',
        data: Buffer.from(
          JSON.stringify({ emailAddress: 'x@y.example', historyId: 142621 }),
        ).toString('base64'),
      },
    });

    expect(service.processVerifiedPush).toHaveBeenCalledWith({
      messageId: 'pubsub-2',
      payload: { emailAddress: 'x@y.example', historyId: '142621' },
    });
    expect(record).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('preserves exact digits for a numeric historyId above 2^53 (uint64 range)', async () => {
    const { controller, record, service } = makeController({
      verify: {
        ok: true,
        claims: {
          iss: 'https://accounts.google.com',
          aud: 'aud',
          email: 'sa@x',
          email_verified: true,
          exp: 9_999_999_999,
          iat: 1,
          sub: 's',
        },
      },
    });
    service.processVerifiedPush.mockResolvedValueOnce({
      kind: 'duplicate_message_id',
      messageId: 'pubsub-3',
    });

    // Raw JSON, not JSON.stringify — a JS number can't hold these
    // digits, which is exactly the hazard being tested.
    const raw = '{"emailAddress":"x@y.example","historyId":18446744073709551615}';
    await controller.push('Bearer good', {
      message: { messageId: 'pubsub-3', data: Buffer.from(raw).toString('base64') },
    });

    expect(service.processVerifiedPush).toHaveBeenCalledWith({
      messageId: 'pubsub-3',
      payload: { emailAddress: 'x@y.example', historyId: '18446744073709551615' },
    });
    expect(record).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('still throws 401 when SecurityEventsService.record rejects (fire-and-forget)', async () => {
    const { controller, record } = makeController({
      verify: { ok: false, step: 2, reason: 'signature_invalid' },
    });
    record.mockRejectedValue(new Error('audit insert lost'));

    await expect(controller.push('Bearer x', ENVELOPE)).rejects.toBeInstanceOf(HttpException);
    consoleWarn.mockRestore();
  });
});
