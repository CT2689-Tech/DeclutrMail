// apps/api/src/webhooks/billing-paddle.controller.ts — Paddle billing
// webhook (D117, D180, built to the D229 verification bar).
//
// Route: `POST /api/webhooks/billing/paddle` (global `api` prefix in
// main.ts). Unauthenticated at the HTTP layer — auth IS the
// `Paddle-Signature` HMAC over the RAW body (ts + h1, HMAC-SHA256 of
// `ts:rawBody` with PADDLE_WEBHOOK_SECRET, ≤5s skew). `rawBody` is
// captured by Nest's `rawBody: true` bootstrap option (main.ts).
//
// Response semantics:
//   - 503 when PADDLE_WEBHOOK_SECRET is unset — FAIL CLOSED: Paddle
//     marks the delivery failed and retries; we never process an
//     unverifiable event.
//   - 401 on any signature failure (recorded to the D181 security
//     audit as `webhook.signature_failure` BEFORE the throw).
//   - 400 on a verified-but-malformed envelope (Paddle stops retrying).
//   - 200 on processed / duplicate / ignored — dedup hits and
//     recognized-but-irrelevant events are valid terminal outcomes
//     under at-least-once delivery.
//
// Rate-limited (unauthenticated endpoint — CLAUDE.md hard rule), keyed
// by source IP via the shared interceptor. 429 makes Paddle retry
// later, which is exactly the desired backpressure.

import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../common/app-exception.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { BillingWebhookService } from '../billing/billing-webhook.service.js';
import { PaddleAdapter } from '../billing/paddle.adapter.js';

@Controller('webhooks/billing')
export class BillingPaddleWebhookController {
  private readonly logger = new Logger(BillingPaddleWebhookController.name);

  constructor(
    private readonly adapter: PaddleAdapter,
    private readonly service: BillingWebhookService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  @Post('paddle')
  @HttpCode(HttpStatus.OK)
  @RateLimit('default')
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('paddle-signature') signatureHeader: string | undefined,
  ): Promise<{ status: string }> {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      // Fail closed — never process an unverifiable event (D180).
      this.logger.error('billing.webhook.secret_unset provider=paddle');
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
        payload: { source: 'billing.paddle', reason: verdict.reason },
      });
      this.logger.warn(`billing.webhook.signature_denied provider=paddle reason=${verdict.reason}`);
      throw new AppException({ code: 'UNAUTHORIZED', message: 'Signature verification failed.' });
    }

    let payload: unknown;
    let event;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
      event = this.adapter.mapWebhookEvent(payload);
    } catch {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Malformed Paddle webhook body.' });
    }

    const outcome = await this.service.process('paddle', event, payload);
    if (outcome.kind === 'unresolved') {
      // 503, never 200 — a 2xx retires the event from Paddle's retry
      // queue and strands a real payment with no subscription row.
      throw new AppException({
        code: 'BILLING_WEBHOOK_UNRESOLVED',
        message: `Billing event unresolved (${outcome.reason}).`,
      });
    }
    return { status: outcome.kind };
  }
}
