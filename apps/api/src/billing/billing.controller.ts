// apps/api/src/billing/billing.controller.ts — HTTP surface for D117
// checkout / read / D118 cancel.
//
// Thin per D201: Zod-validates input (shared contracts —
// `packages/shared/src/contracts/billing.ts`), delegates to
// `BillingService`, wraps in the D202 envelope.
//
// AUTH: `JwtGuard` on every route (billing is workspace-scoped — no
// `CurrentMailboxGuard`; a workspace with zero connected mailboxes can
// still manage its subscription). Mutations additionally take
// `CsrfGuard` (double-submit cookie) + rate limiting (the checkout
// route reaches a paid provider API — abuse costs money).
//
// FLAG: every route 503s with `BILLING_DISABLED` until
// `BILLING_ENABLED=true` — the module is always loaded so the routes
// exist and fail CLEANLY (not 404) while billing is dark.

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  CancelRequestSchema,
  CheckoutRequestSchema,
  ok,
  type BillingSubscription,
  type CheckoutSession,
  type Envelope,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { BillingService } from './billing.service.js';

/** Session principal shape attached by JwtGuard. */
interface Principal {
  userId: string;
  workspaceId: string;
}

function assertBillingEnabled(): void {
  if (process.env.BILLING_ENABLED !== 'true') {
    throw new AppException({ code: 'BILLING_DISABLED' });
  }
}

@Controller('billing')
@UseGuards(JwtGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * POST /api/billing/checkout — provider-specific checkout payload.
   * Never flips the tier (webhooks are the only grant path).
   */
  @Post('checkout')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async checkout(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ): Promise<Envelope<CheckoutSession>> {
    assertBillingEnabled();
    const parsed = CheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid checkout request.',
      });
    }
    return ok(await this.billing.createCheckout(principal, parsed.data));
  }

  /** GET /api/billing/subscription — current sub + tier + founding flag. */
  @Get('subscription')
  @RateLimit('default')
  async subscription(@CurrentUser() principal: Principal): Promise<Envelope<BillingSubscription>> {
    assertBillingEnabled();
    return ok(await this.billing.getSubscription(principal.workspaceId));
  }

  /** POST /api/billing/cancel — D118 cancel at period end (no proration). */
  @Post('cancel')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async cancel(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ): Promise<Envelope<BillingSubscription>> {
    assertBillingEnabled();
    const parsed = CancelRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Invalid cancel request.' });
    }
    return ok(await this.billing.cancelAtPeriodEnd(principal, parsed.data));
  }
}
