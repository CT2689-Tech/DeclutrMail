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
//
// One response is Razorpay-only: 502 when normalization needed a
// Razorpay read it could not make (refund/dispute → invoice →
// subscription id). Non-2xx keeps the delivery in the retry queue,
// which is the whole point — see the mapper's failure posture.

import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../common/app-exception.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { BillingWebhookService } from '../billing/billing-webhook.service.js';
import type { NormalizedBillingEvent } from '../billing/billing-provider.interface.js';
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
      // D181: audit BEFORE the 401 — awaited so the row lands before the
      // response (record() never throws); never logs the body or header value.
      await this.securityEvents.record({
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
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Malformed Razorpay webhook body.' });
    }

    // AWAITED — the Razorpay mapper is async: refund and dispute
    // payloads name no subscription, so it resolves one through
    // `GET /v1/invoices/{id}`. That outbound call happens HERE, strictly
    // after `verifyWebhookSignature` above, so an unsigned request can
    // never make us call Razorpay's API (and never gets past the 401).
    let event: NormalizedBillingEvent;
    try {
      event = await this.adapter.mapWebhookEvent({
        ...(payload as Record<string, unknown>),
        __eventId: eventIdHeader,
      });
    } catch (err) {
      // Two failures with opposite meanings, and collapsing them into
      // 400 is what would drop a refund: a malformed envelope is
      // terminal, but a provider read we could not make is a delivery
      // that must come back. The adapter marks the latter by throwing an
      // AppException (5xx) — rethrown verbatim so the event stays in
      // Razorpay's retry queue. Nothing has been written at this point:
      // the dedup insert lives in `service.process` below, so a retry
      // re-drives from scratch with no double effect.
      if (err instanceof AppException) throw err;
      throw new AppException({ code: 'BAD_REQUEST', message: 'Malformed Razorpay webhook body.' });
    }

    const outcome = await this.service.process('razorpay', event, payload);
    if (outcome.kind === 'unresolved') {
      // 503, never 200 — see the Paddle controller: a 2xx retires the
      // event from the provider's retry queue and strands a payment.
      throw new AppException({
        code: 'BILLING_WEBHOOK_UNRESOLVED',
        message: `Billing event unresolved (${outcome.reason}).`,
      });
    }
    return { status: outcome.kind };
  }
}
