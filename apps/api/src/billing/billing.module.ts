// apps/api/src/billing/billing.module.ts — D117/D118/D126 billing.
//
// Owns the authed billing endpoints (`/api/billing/*`) AND the two
// provider webhook controllers (which live under
// `apps/api/src/webhooks/` so the webhook-security gate covers them —
// module wiring here keeps them loaded UNCONDITIONALLY, unlike the
// Pub/Sub WebhooksModule whose verifier requires env at construction).
// Both surfaces fail closed at request time instead of boot time:
// endpoints 503 `BILLING_DISABLED` until `BILLING_ENABLED=true`;
// webhooks 503 until their signing secret env is set.
//
// REFUND / CHARGEBACK POLICY (D117 spec note): a Paddle refund or
// chargeback adjustment maps to `cancellation_scheduled` — the
// subscription gets `cancel_at_period_end = true` and the tier HOLDS
// until the provider ends the period (downgrade-at-period-end
// semantics, mirroring D118's no-proration cancel). Immediate hard
// revocation is intentionally NOT done from the adjustment event: the
// provider's own subscription.canceled event is the authoritative
// terminal signal and arrives when the subscription actually ends.
//
// AuthModule provides JwtGuard/CsrfGuard dependencies (JwtService,
// SessionsService, CsrfService) for the authed routes.

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { BillingPaddleWebhookController } from '../webhooks/billing-paddle.controller.js';
import { BillingRazorpayWebhookController } from '../webhooks/billing-razorpay.controller.js';
import { BillingCatalog } from './billing-catalog.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { BillingWebhookService } from './billing-webhook.service.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';

@Module({
  imports: [AuthModule],
  controllers: [
    BillingController,
    BillingPaddleWebhookController,
    BillingRazorpayWebhookController,
  ],
  providers: [
    BillingService,
    BillingWebhookService,
    // Explicit factories: these classes take plain (non-injectable)
    // constructor args with defaults — Nest must not try to resolve them.
    { provide: BillingCatalog, useFactory: (): BillingCatalog => new BillingCatalog() },
    { provide: PaddleAdapter, useFactory: (): PaddleAdapter => new PaddleAdapter() },
    { provide: RazorpayAdapter, useFactory: (): RazorpayAdapter => new RazorpayAdapter() },
  ],
  exports: [BillingService],
})
export class BillingModule {}
