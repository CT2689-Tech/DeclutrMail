import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RateLimit } from '../../common/rate-limit/index.js';
import { SecurityEventsService } from '../../security-events/security-events.service.js';
import {
  EmailSuppressionService,
  type SuppressionReason,
} from '../../notifications/email-suppression.service.js';
import { verifyResendSignature } from './resend-signature.js';

/**
 * Resend webhook (D162) — `POST /api/webhooks/resend`.
 *
 * Purpose: bounce/complaint suppression. When Resend reports
 * `email.bounced` or `email.complained`, the recipient lands on the
 * suppression list (`users.preferences.emailSuppression`) and every
 * future send is refused BEFORE calling Resend.
 *
 * Auth model — svix-style signature (Standard Webhooks):
 *   - `RESEND_WEBHOOK_SECRET` unset → 503 fail-closed. The endpoint
 *     refuses to process ANYTHING it cannot verify; Resend retries
 *     5xx, so deliveries are not lost while the founder configures
 *     the secret.
 *   - Bad/missing signature or stale timestamp → 401, plus a D181
 *     `webhook.signature_failure` security event.
 *   - Verification runs against the RAW body bytes (`rawBody: true`
 *     in main.ts) — never a re-serialization.
 *
 * Rate-limited (unauthenticated endpoint — CLAUDE.md hard rule) via
 * the `default` bucket keyed on IP.
 *
 * Event types other than bounce/complaint ACK with 200 and are
 * logged — Resend should not retry deliveries we deliberately ignore.
 *
 * Privacy: the handler reads ONLY `type` + `data.to` from the payload
 * (our own outbound transactional email's metadata — no user mail
 * content is ever in a Resend webhook for plain-text sends). Nothing
 * from the body is logged except the event type.
 */

/** The minimal slice of a Resend webhook envelope this handler reads. */
const ResendEventSchema = z.object({
  type: z.string(),
  // Default (strip) object mode — unknown payload keys are ignored.
  data: z
    .object({
      to: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
});

/** Resend event type → suppression reason. */
const SUPPRESSING_EVENTS: Record<string, SuppressionReason> = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
};

@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private readonly suppression: EmailSuppressionService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit('default')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<{ status: string }> {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // Fail-closed: unverifiable deliveries are never processed.
      // 503 (not 401) so Resend keeps retrying until the secret is
      // configured — no suppression signal is permanently lost.
      this.logger.error(
        'resend.webhook.secret_unset — refusing delivery (fail-closed). ' +
          'Set RESEND_WEBHOOK_SECRET; see .env.example.',
      );
      throw new HttpException(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Webhook secret not configured.' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new HttpException(
        { error: { code: 'BAD_REQUEST', message: 'Empty webhook body.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const verdict = verifyResendSignature({
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret,
    });
    if (!verdict.ok) {
      this.logger.warn(`resend.webhook.deny reason=${verdict.reason}`);
      // D181 audit row BEFORE the 401 — mirrors the Gmail Pub/Sub
      // controller. Controlled discriminator only; never raw headers
      // or body bytes.
      void this.securityEvents.record({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: {
          source: 'resend',
          reason: 'signature_verify_failed',
          step: verdict.reason,
        },
      });
      throw new HttpException(
        { error: { code: 'UNAUTHORIZED', message: 'Webhook signature verification failed.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }

    let event: z.infer<typeof ResendEventSchema>;
    try {
      event = ResendEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new HttpException(
        { error: { code: 'BAD_REQUEST', message: 'Malformed webhook payload.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const reason = SUPPRESSING_EVENTS[event.type];
    if (!reason) {
      // Deliveries we don't act on (email.sent, email.delivered, …)
      // ACK so Resend doesn't retry.
      this.logger.log(`resend.webhook.ignored type=${event.type}`);
      return { status: 'ignored' };
    }

    const recipients =
      typeof event.data?.to === 'string' ? [event.data.to] : (event.data?.to ?? []);
    let suppressed = 0;
    for (const recipient of recipients) {
      const outcome = await this.suppression.suppress(recipient, reason);
      if (outcome !== 'unknown_recipient') suppressed += 1;
    }
    this.logger.log(
      `resend.webhook.processed type=${event.type} recipients=${recipients.length} suppressed=${suppressed}`,
    );
    return { status: 'suppressed' };
  }
}
