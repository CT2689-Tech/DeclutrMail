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

import { Delete, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  BillingReconcileRequestSchema,
  CancelRequestSchema,
  CheckoutRequestSchema,
  PlanChangeRequestSchema,
  ok,
  type BillingReconcileResponse,
  type BillingSubscription,
  type CheckoutSession,
  type Envelope,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { BillingReconciliationService } from './billing-reconciliation.service.js';
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
  constructor(
    private readonly billing: BillingService,
    private readonly reconciliation: BillingReconciliationService,
  ) {}

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

  /**
   * DELETE /api/billing/checkout/pending — the user-asserted release of
   * the cross-device checkout claim ("I checked — no charge went
   * through"). Mirrors the FE's local-lock release; also the recovery
   * path out of CHECKOUT_IN_FLIGHT after an abandoned session.
   */
  @Delete('checkout/pending')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async releasePendingCheckout(
    @CurrentUser() principal: Principal,
  ): Promise<Envelope<{ released: true }>> {
    assertBillingEnabled();
    await this.billing.releasePendingCheckout(principal.workspaceId);
    return ok({ released: true } as const);
  }

  /** GET /api/billing/subscription — current sub + tier + founding flag. */
  @Get('subscription')
  @RateLimit('default')
  async subscription(@CurrentUser() principal: Principal): Promise<Envelope<BillingSubscription>> {
    assertBillingEnabled();
    return ok(await this.billing.getSubscription(principal.workspaceId));
  }

  /**
   * POST /api/billing/reconcile — D249 provider-truth reconciliation of
   * the workspace's pending checkout. The server asks the provider what
   * happened to the claim so the customer never has to guess; a found
   * match projects through the SAME webhook path (never a second grant
   * path). Stricter rate limit than the other mutations: every call can
   * fan out to provider GETs.
   */
  @Post('reconcile')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 60 })
  async reconcile(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ): Promise<Envelope<BillingReconcileResponse>> {
    assertBillingEnabled();
    // The FE's local pending record, as a search hint — load-bearing
    // when the server claim already TTL'd and was swept (stale-lock
    // case). Optional and filter-only; see the contract doc.
    const parsed = BillingReconcileRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid reconcile request.',
      });
    }
    const outcome = await this.reconciliation.reconcilePendingCheckout(principal.workspaceId, {
      tier: parsed.data.toTier,
      cycle: parsed.data.cycle,
      startedAt: parsed.data.startedAt,
    });
    return ok({ outcome });
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

  /**
   * POST /api/billing/change-plan — D117/D120 paid↔paid switch on the
   * existing provider subscription (provider-prorated; tier flips via
   * webhook only).
   */
  @Post('change-plan')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async changePlan(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ): Promise<Envelope<BillingSubscription>> {
    assertBillingEnabled();
    const parsed = PlanChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({ code: 'BAD_REQUEST', message: 'Invalid plan change request.' });
    }
    return ok(await this.billing.changePlan(principal, parsed.data));
  }

  /** POST /api/billing/resume — exit the D118 pause immediately. */
  @Post('resume')
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 10, windowSec: 60 })
  async resume(@CurrentUser() principal: Principal): Promise<Envelope<BillingSubscription>> {
    assertBillingEnabled();
    return ok(await this.billing.resume(principal));
  }
}
