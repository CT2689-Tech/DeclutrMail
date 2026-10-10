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
// Refund / chargeback verdicts retain their provenance across later provider
// updates. Refund access is bounded while settlement is pending, ends when
// settlement is confirmed, and is restored on rejection. Partial refunds do
// not end access. Chargebacks revoke subscription access immediately; a
// separate complimentary grant may still preserve the workspace's tier.
// See BillingWebhookService for the authoritative transition logic.
//
// AuthModule provides JwtGuard/CsrfGuard dependencies (JwtService,
// SessionsService, CsrfService) for the authed routes.

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AutopilotModule } from '../autopilot/autopilot.module.js';
import { BillingPaddleWebhookController } from '../webhooks/billing-paddle.controller.js';
import { BillingRazorpayWebhookController } from '../webhooks/billing-razorpay.controller.js';
import { BillingCatalog } from './billing-catalog.js';
import { BillingDeletionGuard } from './billing-deletion-guard.js';
import { BillingController } from './billing.controller.js';
import { BillingReconciliationService } from './billing-reconciliation.service.js';
import { BillingService } from './billing.service.js';
import { BillingWebhookService } from './billing-webhook.service.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';
import { BillingUpgradeRefundService } from './billing-upgrade-refund.service.js';

@Module({
  // AutopilotModule exports the AutopilotReadService facade the D251
  // tier write demotes through (billing never writes automation_rules
  // directly, D204).
  imports: [AuthModule, AutopilotModule],
  controllers: [
    BillingController,
    BillingPaddleWebhookController,
    BillingRazorpayWebhookController,
  ],
  providers: [
    BillingService,
    BillingDeletionGuard,
    BillingWebhookService,
    BillingReconciliationService,
    BillingUpgradeRefundService,
    // Explicit factories: these classes take plain (non-injectable)
    // constructor args with defaults — Nest must not try to resolve them.
    { provide: BillingCatalog, useFactory: (): BillingCatalog => new BillingCatalog() },
    { provide: PaddleAdapter, useFactory: (): PaddleAdapter => new PaddleAdapter() },
    { provide: RazorpayAdapter, useFactory: (): RazorpayAdapter => new RazorpayAdapter() },
  ],
  exports: [BillingService, BillingDeletionGuard],
})
export class BillingModule {}
