// apps/api/src/billing/billing.service.ts — authed billing operations
// (D117 checkout + D118 cancel + the billing-screen read).
//
// Provider routing is the USER'S explicit choice (D117: India →
// Razorpay, everywhere else → Paddle); the chosen provider's implied
// `users.billing_region` is recorded at checkout so Settings → Account
// shows the active routing without IP re-detection.
//
// CHECKOUT NEVER GRANTS. The checkout endpoint returns a provider
// payload only; tier flips happen exclusively in the verified webhook
// path (BillingWebhookService) — client-claimed success is never
// trusted (no-fake-completion bar, CLAUDE.md §10).
//
// D118 cancel: provider API call first (the server-side confirmation),
// then `cancel_at_period_end = true` locally; status stays `active`
// until the provider's period-end webhook flips it. The optional
// cancellation reason lands in the `subscription_events` stream as a
// synthetic `local.cancellation_requested` row (D118 — "reason
// captured in subscription_events", anonymous enum for analytics).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { subscriptionEvents, subscriptions, users, workspaces } from '@declutrmail/db';
import type {
  BillingSubscription,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { BillingProvider } from './billing-provider.interface.js';
import { BillingCatalog } from './billing-catalog.js';
import { lockSubscription } from './billing-webhook.service.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalog: BillingCatalog,
    private readonly paddle: PaddleAdapter,
    private readonly razorpay: RazorpayAdapter,
  ) {}

  private adapterFor(provider: 'paddle' | 'razorpay'): BillingProvider {
    return provider === 'paddle' ? this.paddle : this.razorpay;
  }

  async createCheckout(
    principal: { userId: string; workspaceId: string },
    dto: CheckoutRequest,
  ): Promise<CheckoutSession> {
    // One subscription per workspace at a time — plan CHANGES are a
    // provider-side update flow (D120), not a second checkout.
    const [existing] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due', 'paused']),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppException({ code: 'SUBSCRIPTION_EXISTS' });
    }

    const founding = dto.promo === 'foundingPro';
    if (founding) {
      // Advisory availability check — the AUTHORITATIVE gate is the
      // race-safe counter in the webhook path; this stops obviously
      // sold-out checkouts before the user reaches a payment form.
      const remaining = await this.foundingRemaining();
      if (remaining <= 0) {
        throw new AppException({ code: 'FOUNDING_PRO_SOLD_OUT' });
      }
    }

    const priceId = this.catalog.resolvePriceId(dto.provider, dto.tierId, dto.cycle, founding);
    if (!priceId) {
      // Catalog not provisioned for this price point (founder step F3).
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }

    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!user) {
      throw new AppException({ code: 'UNAUTHORIZED' });
    }

    // Record the provider's implied billing region (D117).
    await this.db
      .update(users)
      .set({ billingRegion: dto.provider === 'razorpay' ? 'india' : 'international' })
      .where(eq(users.id, principal.userId));

    const session = await this.adapterFor(dto.provider).createCheckout({
      workspaceId: principal.workspaceId,
      userEmail: user.email,
      tierId: dto.tierId,
      cycle: dto.cycle,
      providerPriceId: priceId,
    });

    this.logger.log(
      `billing.checkout_created workspace=${principal.workspaceId} provider=${dto.provider} tier=${dto.tierId} cycle=${dto.cycle} founding=${founding}`,
    );
    return session;
  }

  async getSubscription(workspaceId: string): Promise<BillingSubscription> {
    const [ws] = await this.db
      .select({ tier: workspaces.tier, foundingMember: workspaces.foundingMember })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) {
      throw new AppException({ code: 'NOT_FOUND' });
    }

    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);

    return {
      tier: ws.tier,
      foundingMember: ws.foundingMember,
      subscription:
        sub && (sub.tier === 'plus' || sub.tier === 'pro')
          ? {
              provider: sub.provider,
              tier: sub.tier,
              status: sub.status,
              cycle: sub.billingCycle,
              currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              pauseUntil: sub.pauseUntil?.toISOString() ?? null,
              foundingMember: sub.foundingMember,
            }
          : null,
    };
  }

  async cancelAtPeriodEnd(
    principal: { workspaceId: string },
    dto: CancelRequest,
  ): Promise<BillingSubscription> {
    const [sub] = await this.db
      .select({
        id: subscriptions.id,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due', 'paused']),
        ),
      )
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);
    if (!sub) {
      throw new AppException({ code: 'NO_ACTIVE_SUBSCRIPTION' });
    }

    if (!sub.cancelAtPeriodEnd) {
      // Provider call IS the confirmation; only after it succeeds does
      // the local row record the scheduled cancel. Idempotent: a
      // second cancel click skips the provider round-trip.
      await this.adapterFor(sub.provider).cancelSubscription(sub.providerSubscriptionId);
      // Under the SAME advisory lock the webhook writers take: a
      // provider event for this subscription can be in flight right
      // now, and its upsert would otherwise overwrite the flag we are
      // about to set with the pre-cancel value it read earlier.
      await this.db.transaction(async (tx) => {
        await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
        await tx
          .update(subscriptions)
          .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));
      });

      // D118 — reason into the normalized event stream (audit).
      await this.db
        .insert(subscriptionEvents)
        .values({
          provider: sub.provider,
          providerEventId: `local_cancel_${sub.providerSubscriptionId}`,
          eventType: 'local.cancellation_requested',
          payload: { cancellation_reason: dto.reason ?? null },
          processedAt: new Date(),
        })
        .onConflictDoNothing();

      this.logger.log(
        `billing_event kind=subscription_canceled provider=${sub.provider} workspace=${principal.workspaceId} at_period_end=true reason=${dto.reason ?? 'none'}`,
      );
    }

    return this.getSubscription(principal.workspaceId);
  }

  /** D126 — Founding Pro spots left (advisory; webhook path is authoritative). */
  async foundingRemaining(): Promise<number> {
    const rows = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.foundingMember, true));
    return Math.max(0, this.catalog.foundingMaxRedemptions - rows.length);
  }
}
