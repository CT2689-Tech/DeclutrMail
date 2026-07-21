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
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { subscriptionEvents, subscriptions, users, workspaces } from '@declutrmail/db';
import type {
  BillingSubscription,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  PlanChangeRequest,
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
              scheduledChange:
                !sub.cancelAtPeriodEnd &&
                sub.scheduledTier &&
                (sub.scheduledTier === 'plus' || sub.scheduledTier === 'pro') &&
                sub.scheduledBillingCycle &&
                sub.scheduledChangeAt &&
                sub.scheduledChangeState
                  ? {
                      tier: sub.scheduledTier,
                      cycle: sub.scheduledBillingCycle,
                      effectiveAt: sub.scheduledChangeAt.toISOString(),
                      state: sub.scheduledChangeState,
                    }
                  : null,
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
      // Under the SAME advisory lock the webhook writers take — but the
      // lock only serializes, it does not ORDER. A provider event
      // captured BEFORE this cancel can still win the lock afterwards
      // and upsert its pre-cancel `cancel_at_period_end: false` on top.
      //
      // So the audit row is written IN THIS TRANSACTION and shaped to
      // participate in the webhook's staleness check: carrying
      // `kind: 'cancellation_scheduled'` + `provider_subscription_id`
      // makes it a state-writing event with a `created_at` of NOW, so
      // any in-flight event that arrived earlier is refused as stale.
      // Written as a plain audit blob before, it was invisible to that
      // check and the cancellation was silently reverted.
      const now = new Date();
      await this.db.transaction(async (tx) => {
        await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
        await tx
          .update(subscriptions)
          .set({ cancelAtPeriodEnd: true, updatedAt: now })
          .where(eq(subscriptions.id, sub.id));

        // D118 — reason into the normalized event stream (audit).
        //
        // The event id carries a timestamp so EACH cancellation gets
        // its own row. A fixed `local_cancel_<sub>` id collided with
        // the previous cancellation and `onConflictDoNothing` kept the
        // OLD row — freezing this marker's `created_at` at the first
        // cancel, so a later cancel was no longer newer than in-flight
        // events and could be reverted again. `created_at` cannot be
        // refreshed in place: subscription_events is append-only apart
        // from `processed_at`.
        await tx
          .insert(subscriptionEvents)
          .values({
            provider: sub.provider,
            providerEventId: `local_cancel_${sub.providerSubscriptionId}_${now.toISOString()}`,
            eventType: 'local.cancellation_requested',
            payload: {
              kind: 'cancellation_scheduled',
              provider_subscription_id: sub.providerSubscriptionId,
              // Participates in the webhook's ordering tiebreak: when
              // this marker and an in-flight event share an arrival
              // timestamp, `occurred_at` decides, and a marker without
              // one silently loses to the event it must beat.
              occurred_at: now.toISOString(),
              cancellation_reason: dto.reason ?? null,
            },
            processedAt: now,
          })
          // Two clicks inside the same millisecond are the same intent.
          .onConflictDoNothing();
      });

      this.logger.log(
        `billing_event kind=subscription_canceled provider=${sub.provider} workspace=${principal.workspaceId} at_period_end=true reason=${dto.reason ?? 'none'}`,
      );
    }

    return this.getSubscription(principal.workspaceId);
  }

  /**
   * D117/D120 — self-serve paid↔paid plan change on the EXISTING
   * provider subscription. Upgrades are provider-prorated immediately.
   * Downgrades are stored durably and keep the old entitlement through
   * the current period; Paddle's immediate item swap is masked by the
   * webhook projector until the renewal boundary.
   *
   * Guards:
   *   - paused subs must resume (or cancel) first — a paused sub's
   *     provider-side item change semantics differ per provider, and
   *     the user isn't being billed to change from;
   *   - Founding Pro subs are change-locked (the $129 price lock dies
   *     with the price point — never end it on a casual click);
   *   - same tier+cycle is an idempotent no-op.
   */
  async changePlan(
    principal: { workspaceId: string },
    dto: PlanChangeRequest,
  ): Promise<BillingSubscription> {
    const [sub] = await this.db
      .select({
        id: subscriptions.id,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        providerPriceId: subscriptions.providerPriceId,
        tier: subscriptions.tier,
        billingCycle: subscriptions.billingCycle,
        status: subscriptions.status,
        foundingMember: subscriptions.foundingMember,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        scheduledTier: subscriptions.scheduledTier,
        scheduledBillingCycle: subscriptions.scheduledBillingCycle,
        scheduledProviderPriceId: subscriptions.scheduledProviderPriceId,
        scheduledChangeAt: subscriptions.scheduledChangeAt,
        scheduledChangeState: subscriptions.scheduledChangeState,
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
    if (sub.status === 'paused') {
      throw new AppException({ code: 'SUBSCRIPTION_PAUSED' });
    }
    if (sub.status !== 'active') {
      throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
    }
    if (sub.cancelAtPeriodEnd) {
      throw new AppException({ code: 'SUBSCRIPTION_CANCELING' });
    }
    if (sub.foundingMember) {
      throw new AppException({ code: 'FOUNDING_PLAN_LOCKED' });
    }
    if (sub.provider === 'razorpay') {
      // Paddle-only at launch — see razorpay.adapter.changePlan for why.
      // Checked here too so the answer doesn't depend on catalog state.
      throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
    }

    // Selecting the effective current plan while a downgrade is queued
    // means “keep my current plan.” Restore Paddle's item first while the
    // masking marker is still present, then clear the durable schedule.
    if (
      sub.scheduledChangeState !== null &&
      sub.tier === dto.tierId &&
      sub.billingCycle === dto.cycle
    ) {
      if (!sub.scheduledChangeAt) {
        throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
      }
      // Same renewal-boundary window as scheduling: pinning
      // `next_billed_at` at (or past) the boundary is a guaranteed
      // provider 4xx — refuse cleanly instead. After renewal the user
      // can upgrade again through the normal picker.
      if (sub.scheduledChangeAt.getTime() - Date.now() <= 30 * 60_000) {
        throw new AppException({ code: 'PLAN_CHANGE_TOO_LATE' });
      }
      const now = new Date();
      await this.db.transaction(async (tx) => {
        await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
        // State guard: a webhook may have applied/cleared the schedule
        // between the pre-transaction read and this claim. Without it,
        // this partial write would trip the all-or-nothing CHECK — and
        // restoring a schedule that no longer exists calls the provider
        // for a change the user never previewed.
        const claimed = await tx
          .update(subscriptions)
          .set({
            scheduledChangeState: 'restoring_current',
            scheduledChangeRequestedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(subscriptions.id, sub.id),
              sql`${subscriptions.scheduledChangeState} IS NOT NULL`,
            ),
          )
          .returning({ id: subscriptions.id });
        if (claimed.length === 0) {
          throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
        }
        await tx.insert(subscriptionEvents).values({
          provider: sub.provider,
          providerEventId: `local_plan_change_canceled_${sub.providerSubscriptionId}_${now.toISOString()}`,
          eventType: 'local.plan_change_canceled',
          payload: {
            kind: 'plan_change_canceled',
            provider_subscription_id: sub.providerSubscriptionId,
            occurred_at: now.toISOString(),
          },
          processedAt: now,
        });
      });
      try {
        const confirmation = await this.adapterFor(sub.provider).changePlan(
          sub.providerSubscriptionId,
          sub.providerPriceId,
          {
            kind: 'next_period_no_proration',
            effectiveAt: sub.scheduledChangeAt.toISOString(),
          },
        );
        if (confirmation?.providerPriceId === sub.providerPriceId) {
          const providerConfirmedAt = confirmation.providerUpdatedAt
            ? new Date(confirmation.providerUpdatedAt)
            : now;
          const confirmedAt = Number.isNaN(providerConfirmedAt.getTime())
            ? now
            : providerConfirmedAt;
          await this.db.transaction(async (tx) => {
            await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
            const cleared = await tx
              .update(subscriptions)
              .set({
                scheduledTier: null,
                scheduledBillingCycle: null,
                scheduledProviderPriceId: null,
                scheduledChangeAt: null,
                scheduledChangeState: null,
                scheduledChangeRequestedAt: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(subscriptions.id, sub.id),
                  eq(subscriptions.scheduledChangeState, 'restoring_current'),
                ),
              )
              .returning({ id: subscriptions.id });
            if (cleared.length > 0) {
              await tx.insert(subscriptionEvents).values({
                provider: sub.provider,
                providerEventId: `local_plan_restore_confirmed_${sub.providerSubscriptionId}_${now.toISOString()}`,
                eventType: 'local.plan_restore_confirmed',
                payload: {
                  kind: 'subscription',
                  provider_subscription_id: sub.providerSubscriptionId,
                  provider_price_id: sub.providerPriceId,
                  status: sub.status,
                  occurred_at: confirmedAt.toISOString(),
                },
                processedAt: new Date(),
              });
            }
          });
        }
      } catch (err) {
        if (err instanceof AppException && err.details?.providerOutcome === 'definitive') {
          await this.db
            .update(subscriptions)
            .set({ scheduledChangeState: 'scheduled', updatedAt: new Date() })
            .where(
              and(
                eq(subscriptions.id, sub.id),
                eq(subscriptions.scheduledChangeState, 'restoring_current'),
              ),
            );
        } else {
          // Ambiguous provider outcome: the marker stays
          // `restoring_current` on purpose (retry is safe). Without a
          // reconciler this WARN is how ops finds a stranded row.
          this.logger.warn(
            `billing.plan_restore_unconfirmed workspace=${principal.workspaceId} provider=${sub.provider} sub=${sub.providerSubscriptionId}`,
          );
        }
        throw err;
      }
      this.logger.log(
        `billing.plan_change_canceled workspace=${principal.workspaceId} provider=${sub.provider}`,
      );
      return this.getSubscription(principal.workspaceId);
    }
    if (
      sub.tier === dto.tierId &&
      sub.billingCycle === dto.cycle &&
      sub.scheduledChangeState === null
    ) {
      // Idempotent no-op — nothing to change, nothing to charge.
      return this.getSubscription(principal.workspaceId);
    }
    const priceId = this.catalog.resolvePriceId(sub.provider, dto.tierId, dto.cycle, false);
    if (!priceId) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }

    const isDowngrade =
      (sub.tier === 'pro' && dto.tierId === 'plus') ||
      (sub.tier === dto.tierId && sub.billingCycle === 'annual' && dto.cycle === 'monthly');

    if (isDowngrade) {
      if (!sub.currentPeriodEnd) {
        throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
      }
      const changeAt = sub.currentPeriodEnd;
      const sameScheduledTarget =
        sub.scheduledTier === dto.tierId &&
        sub.scheduledBillingCycle === dto.cycle &&
        sub.scheduledProviderPriceId === priceId;
      if (sub.scheduledChangeState === 'scheduled' && sameScheduledTarget) {
        return this.getSubscription(principal.workspaceId);
      }
      if (changeAt.getTime() - Date.now() <= 30 * 60_000) {
        throw new AppException({ code: 'PLAN_CHANGE_TOO_LATE' });
      }
      if (sub.scheduledChangeState !== null && !sameScheduledTarget) {
        throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
      }

      if (sub.scheduledChangeState === null) {
        const now = new Date();
        await this.db.transaction(async (tx) => {
          await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
          const claimed = await tx
            .update(subscriptions)
            .set({
              scheduledTier: dto.tierId,
              scheduledBillingCycle: dto.cycle,
              scheduledProviderPriceId: priceId,
              scheduledChangeAt: changeAt,
              scheduledChangeState: 'pending_provider',
              scheduledChangeRequestedAt: now,
              updatedAt: now,
            })
            .where(
              and(eq(subscriptions.id, sub.id), sql`${subscriptions.scheduledChangeState} IS NULL`),
            )
            .returning({ id: subscriptions.id });
          if (claimed.length === 0) {
            throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
          }
          await tx.insert(subscriptionEvents).values({
            provider: sub.provider,
            providerEventId: `local_plan_change_${sub.providerSubscriptionId}_${now.toISOString()}`,
            eventType: 'local.plan_change_requested',
            payload: {
              kind: 'plan_change_scheduled',
              provider_subscription_id: sub.providerSubscriptionId,
              occurred_at: now.toISOString(),
              from_tier: sub.tier,
              from_cycle: sub.billingCycle,
              to_tier: dto.tierId,
              to_cycle: dto.cycle,
              effective_at: changeAt.toISOString(),
            },
            processedAt: now,
          });
        });
      }

      // The durable pending marker is committed before this call, so a
      // fast webhook cannot prematurely revoke the current entitlement.
      // On an ambiguous timeout the marker intentionally remains
      // `pending_provider`; retrying the same target is provider-idempotent.
      try {
        await this.adapterFor(sub.provider).changePlan(sub.providerSubscriptionId, priceId, {
          kind: 'next_period_no_proration',
          effectiveAt: changeAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof AppException && err.details?.providerOutcome === 'definitive') {
          await this.db
            .update(subscriptions)
            .set({
              scheduledTier: null,
              scheduledBillingCycle: null,
              scheduledProviderPriceId: null,
              scheduledChangeAt: null,
              scheduledChangeState: null,
              scheduledChangeRequestedAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(subscriptions.id, sub.id),
                eq(subscriptions.scheduledChangeState, 'pending_provider'),
                eq(subscriptions.scheduledProviderPriceId, priceId),
              ),
            );
        } else {
          // Ambiguous provider outcome: the marker stays
          // `pending_provider` on purpose (same-target retry is
          // provider-idempotent). Without a reconciler this WARN is how
          // ops finds a stranded row.
          this.logger.warn(
            `billing.plan_change_unconfirmed workspace=${principal.workspaceId} provider=${sub.provider} sub=${sub.providerSubscriptionId}`,
          );
        }
        throw err;
      }
      await this.db
        .update(subscriptions)
        .set({ scheduledChangeState: 'scheduled', updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.id, sub.id),
            eq(subscriptions.scheduledChangeState, 'pending_provider'),
          ),
        );

      this.logger.log(
        `billing.plan_change_scheduled workspace=${principal.workspaceId} provider=${sub.provider} from=${sub.tier}/${sub.billingCycle} to=${dto.tierId}/${dto.cycle} effective_at=${changeAt.toISOString()}`,
      );
      return this.getSubscription(principal.workspaceId);
    }

    if (sub.scheduledChangeState !== null) {
      throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
    }

    // Provider call IS the immediate upgrade; the webhook writes the
    // new tier/cycle only after the provider accepts the charge.
    await this.adapterFor(sub.provider).changePlan(sub.providerSubscriptionId, priceId, {
      kind: 'immediate_prorated',
    });

    this.logger.log(
      `billing.plan_change_requested workspace=${principal.workspaceId} provider=${sub.provider} from=${sub.tier}/${sub.billingCycle} to=${dto.tierId}/${dto.cycle}`,
    );
    return this.getSubscription(principal.workspaceId);
  }

  /**
   * D118 pause exit — resume the paused subscription immediately.
   * Entitlement returns via the provider webhook, never here.
   */
  async resume(principal: { workspaceId: string }): Promise<BillingSubscription> {
    const [sub] = await this.db
      .select({
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          eq(subscriptions.status, 'paused'),
        ),
      )
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);
    if (!sub) {
      throw new AppException({ code: 'NO_ACTIVE_SUBSCRIPTION' });
    }

    await this.adapterFor(sub.provider).resumeSubscription(sub.providerSubscriptionId);

    this.logger.log(
      `billing.resume_requested workspace=${principal.workspaceId} provider=${sub.provider}`,
    );
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
