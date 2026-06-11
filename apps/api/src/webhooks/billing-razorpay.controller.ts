// apps/api/src/webhooks/billing-razorpay.controller.ts — Razorpay
// billing webhook (D117, D180).
//
// Route: `POST /api/webhooks/billing/razorpay`. Auth IS the
// `X-Razorpay-Signature` header — hex HMAC-SHA256 of the RAW body with
// RAZORPAY_WEBHOOK_SECRET. Razorpay has no timestamp scheme; replay
// defense is the `x-razorpay-event-id` dedup key (unique per event,
// `subscription_events` unique index).
//
// Response semantics mirror the Paddle controller: 503 secret-unset
// (fail closed), 401 bad signature (D181 audit row first), 400
// malformed envelope, 200 processed/duplicate/ignored. Rate-limited —
// unauthenticated endpoint (CLAUDE.md hard rule).

import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../common/app-exception.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { BillingWebhookService } from '../billing/billing-webhook.service.js';
import { RazorpayAdapter } from '../billing/razorpay.adapter.js';

@Controller('webhooks/billing')
export class BillingRazorpayWebhookController {
  private readonly logger = new Logger(BillingRazorpayWebhookController.name);

  constructor(
    private readonly adapter: RazorpayAdapter,
    private readonly service: BillingWebhookService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  @RateLimit('default')
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signatureHeader: string | undefined,
    @Headers('x-razorpay-event-id') eventIdHeader: string | undefined,
  ): Promise<{ status: string }> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      // Fail closed — never process an unverifiable event (D180).
      this.logger.error('billing.webhook.secret_unset provider=razorpay');
      throw new AppException({
        code: 'BILLING_DISABLED',
        message: 'Webhook signing secret not configured.',
      });
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Empty webhook body.' });
    }

    const verdict = this.adapter.verifyWebhookSignature({ rawBody, signatureHeader, secret });
    if (!verdict.ok) {
      // D181: audit BEFORE the 401 — never logs the body or the header value.
      void this.securityEvents.record({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: { source: 'billing.razorpay', reason: verdict.reason },
      });
      this.logger.warn(
        `billing.webhook.signature_denied provider=razorpay reason=${verdict.reason}`,
      );
      throw new AppException({ code: 'UNAUTHORIZED', message: 'Signature verification failed.' });
    }

    // Razorpay carries the event id in a HEADER, not the body — the
    // dedup key must come from the verified delivery, so inject it
    // into the payload the adapter normalizes (`__eventId`).
    if (!eventIdHeader || typeof eventIdHeader !== 'string') {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Missing x-razorpay-event-id.' });
    }

    let payload: unknown;
    let event;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
      event = this.adapter.mapWebhookEvent({
        ...(payload as Record<string, unknown>),
        __eventId: eventIdHeader,
      });
    } catch {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Malformed Razorpay webhook body.' });
    }

    const outcome = await this.service.process('razorpay', event, payload);
    return { status: outcome.kind };
  }
}
