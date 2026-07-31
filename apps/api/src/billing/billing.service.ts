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
import {
  pendingCheckouts,
  subscriptionEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import type {
  BillingSubscription,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  PlanChangePreview,
  PlanChangeRequest,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { BillingProvider } from './billing-provider.interface.js';
import { BillingCatalog } from './billing-catalog.js';
import { BillingReconciliationService } from './billing-reconciliation.service.js';
import { lockSubscription } from './billing-webhook.service.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';

/** 0051 — pending-checkout display/lock horizon. */
const PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;

/** D118 — the pause offer's fixed length ("Pause for 30 days"). */
const PAUSE_DAYS = 30;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalog: BillingCatalog,
    private readonly paddle: PaddleAdapter,
    private readonly razorpay: RazorpayAdapter,
    private readonly reconciliation: BillingReconciliationService,
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
    //
    // A PAUSED blocker gets its own code. Both are refusals, but they need
    // different next steps, and `SUBSCRIPTION_EXISTS` claims the account
    // "already has an ACTIVE subscription" — false for a paused row, and
    // exactly the assert-what-you-don't-know defect this codebase keeps
    // hitting. It also left a real trap (sandbox smoke 2026-07-29): a paused
    // Razorpay subscriber cannot resume (`RESUME_UNSUPPORTED` — the rail has
    // no no-charge resume), cannot change plan (`PLAN_CHANGE_UNSUPPORTED`),
    // and was told only that they already had an "active" subscription. The
    // exit does exist — cancel, then subscribe again, which Razorpay's
    // adapter fully supports — so the fix is to SAY so rather than to loosen
    // the guard. Loosening it would let a second live subscription start
    // while the provider could still resume the paused one.
    const [existing] = await this.db
      .select({ id: subscriptions.id, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due', 'paused']),
        ),
      )
      // Deterministic pick: a live row outranks a paused one, so the message
      // names the stronger blocker when both exist.
      .orderBy(sql`CASE WHEN ${subscriptions.status} = 'paused' THEN 1 ELSE 0 END`)
      .limit(1);
    if (existing) {
      throw new AppException({
        code:
          existing.status === 'paused' ? 'SUBSCRIPTION_PAUSED_BLOCKS_NEW' : 'SUBSCRIPTION_EXISTS',
      });
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

    // ATOMIC cross-device claim (Codex stop-review 2026-07-29). The
    // SELECT-then-throw above closes the subscription-exists case but
    // not the in-flight one: two devices opening checkout inside the
    // read window both used to reach the provider, and both could
    // complete — the 0051 index then made the second charge LOUD, not
    // prevented. This upsert claims the workspace's single pending slot
    // in one statement: it wins iff no row exists (INSERT) or the
    // existing row is expired (the conditional DO UPDATE). Zero rows
    // back = someone else's unexpired claim → refuse BEFORE any
    // provider session exists. The claim precedes the provider call on
    // purpose; a provider failure releases it below.
    const claimed = await this.db
      .insert(pendingCheckouts)
      .values({
        workspaceId: principal.workspaceId,
        provider: dto.provider,
        tier: dto.tierId,
        billingCycle: dto.cycle,
        expiresAt: new Date(Date.now() + PENDING_CHECKOUT_TTL_MS),
      })
      .onConflictDoUpdate({
        target: pendingCheckouts.workspaceId,
        set: {
          provider: dto.provider,
          tier: dto.tierId,
          billingCycle: dto.cycle,
          // New claim cycle — the previous attempt's provider artifact
          // (if any) no longer describes THIS checkout (D249).
          providerRef: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + PENDING_CHECKOUT_TTL_MS),
        },
        setWhere: sql`${pendingCheckouts.expiresAt} < now()`,
      })
      .returning({ workspaceId: pendingCheckouts.workspaceId });
    if (claimed.length === 0) {
      throw new AppException({ code: 'CHECKOUT_IN_FLIGHT' });
    }

    let session: CheckoutSession;
    try {
      session = await this.adapterFor(dto.provider).createCheckout({
        workspaceId: principal.workspaceId,
        userEmail: user.email,
        tierId: dto.tierId,
        cycle: dto.cycle,
        providerPriceId: priceId,
      });
    } catch (err) {
      // The claim SURVIVES a provider-call failure — deliberately
      // (Codex stop-review 2026-07-29). A thrown error here is not
      // proof the provider saw nothing: a timeout after the request
      // landed still creates the artifact, and Razorpay's create runs
      // with `customer_notify: 1`, so an orphaned subscription is
      // PAYABLE from the provider's own emailed authorization link —
      // outside our FE entirely. Auto-releasing on that ambiguity
      // reopened checkout for attempt #2 while #1 could still be paid:
      // the exact double-charge this claim exists to prevent. The two
      // honest reopeners are the 30-minute TTL and the user's explicit
      // "I checked — no charge" assertion (DELETE /billing/checkout/
      // pending) — a human or a horizon, never an inference from an
      // unknown outcome.
      this.logger.error(
        `billing.checkout.create_failed workspace=${principal.workspaceId} provider=${dto.provider} claim_held=true — claim reopens via TTL or user release only`,
      );
      throw err;
    }

    // D249 — when the server itself created the provider artifact
    // (Razorpay mints the subscription before payment), record its id
    // on the claim so reconciliation can ask the provider about THIS
    // checkout exactly. Best-effort: a failed stash only means the
    // reconciler falls back to the email-search ladder.
    if (session.provider === 'razorpay') {
      try {
        await this.db
          .update(pendingCheckouts)
          .set({ providerRef: session.subscriptionId })
          .where(eq(pendingCheckouts.workspaceId, principal.workspaceId));
      } catch (err) {
        this.logger.warn(
          `billing.checkout.provider_ref_stash_failed workspace=${principal.workspaceId} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `billing.checkout_created workspace=${principal.workspaceId} provider=${dto.provider} tier=${dto.tierId} cycle=${dto.cycle} founding=${founding}`,
    );
    return session;
  }

  /**
   * User-asserted release of the pending-checkout claim ("I checked —
   * no charge went through"), mirroring the FE's local-lock release.
   * Idempotent; also the recovery path when CHECKOUT_IN_FLIGHT blocks a
   * retry after an abandoned session. If a payment DID complete
   * despite the assertion, the webhook grant still lands — the claim
   * gates checkout opening, never payment processing.
   */
  async releasePendingCheckout(workspaceId: string): Promise<void> {
    await this.db.delete(pendingCheckouts).where(eq(pendingCheckouts.workspaceId, workspaceId));
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

    // The read serves ONE row, and it must be the row that tells the
    // plan story: "latest by updated_at" let a paused/canceled row
    // SHADOW the granting one, so the FE asserted two plans at once
    // (audit A6). Prefer the row in a granting status (the webhook
    // recompute's GRANTING_STATUSES: active/past_due); otherwise serve
    // the most recent non-granting row. Row count per workspace is
    // bounded by the one-live-subscription rule.
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .orderBy(desc(subscriptions.updatedAt));
    const sub = rows.find((r) => r.status === 'active' || r.status === 'past_due') ?? rows[0];

    // 0051 cross-device pending checkout: serve only while unexpired
    // AND no granting subscription exists — once the webhook grants,
    // the row is deleted, but the guard here means a race can never
    // show "payment in flight" beside an active plan.
    const [pending] = await this.db
      .select()
      .from(pendingCheckouts)
      .where(eq(pendingCheckouts.workspaceId, workspaceId))
      .limit(1);
    const hasGranting = rows.some((r) => r.status === 'active' || r.status === 'past_due');
    const pendingCheckout =
      pending &&
      !hasGranting &&
      pending.expiresAt.getTime() > Date.now() &&
      (pending.tier === 'plus' || pending.tier === 'pro')
        ? {
            provider: pending.provider,
            tier: pending.tier,
            cycle: pending.billingCycle,
            expiresAt: pending.expiresAt.toISOString(),
          }
        : null;

    return {
      tier: ws.tier,
      foundingMember: ws.foundingMember,
      pendingCheckout,
      subscription:
        sub && (sub.tier === 'plus' || sub.tier === 'pro')
          ? {
              provider: sub.provider,
              tier: sub.tier,
              status: sub.status,
              cycle: sub.billingCycle,
              currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              cancelSource: sub.cancelSource,
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
   * D118 — revoke a scheduled cancellation and go back on renewal.
   *
   * Why this exists: cancelling was a one-way door. `resume` only
   * un-pauses (`status='paused'`), `checkout` refuses with
   * `SUBSCRIPTION_EXISTS`, and `changePlan` refuses with
   * `SUBSCRIPTION_CANCELING` — even for the identical plan. A user who
   * mis-clicked Cancel on an annual plan had no way back for up to a
   * year, and support had to PATCH the provider by hand (matrix E3,
   * verified 2026-07-31).
   *
   * Deliberately the exact mirror of `cancelAtPeriodEnd`, including the
   * staleness-participating marker: an in-flight provider event
   * captured BEFORE this call must not win the lock afterwards and
   * re-assert `cancel_at_period_end: true`. Nothing is charged and no
   * entitlement moves — only the schedule changes — so the local write
   * is safe here in a way a pause's would not be.
   */
  async resumeCancellation(principal: { workspaceId: string }): Promise<BillingSubscription> {
    const [sub] = await this.db
      .select({
        id: subscriptions.id,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        cancelSource: subscriptions.cancelSource,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due']),
        ),
      )
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);
    if (!sub) {
      throw new AppException({ code: 'NO_ACTIVE_SUBSCRIPTION' });
    }
    if (!sub.cancelAtPeriodEnd) {
      throw new AppException({ code: 'NO_SCHEDULED_CANCELLATION' });
    }
    // A refund/chargeback row is now REACHABLE here: the projector pins
    // `cancel_at_period_end` true under a local verdict (2026-07-31), and
    // such a row can sit in `active` for the rest of its paid period. Only
    // the USER's own cancel is revocable. Un-scheduling a refunded plan
    // would clear the renewal block at the provider while
    // `entitlement_ends_at` keeps ending it — a button that answers
    // "you're back on Pro" over an account that is not.
    if (sub.cancelSource === 'refund' || sub.cancelSource === 'chargeback') {
      throw new AppException({ code: 'CANCELLATION_NOT_REVOCABLE' });
    }

    // Provider call IS the confirmation — only a successful revoke lets
    // the local row claim the renewal is back on.
    await this.adapterFor(sub.provider).clearScheduledCancellation(sub.providerSubscriptionId);

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
      // `cancel_at_period_end` ONLY — the exact inverse of what
      // `cancelAtPeriodEnd()` writes. Deliberately NOT `cancel_source`:
      // that column is never set by a user cancel (its enum is
      // provider/refund/chargeback), so clearing it here could only ever
      // erase a REFUND or CHARGEBACK verdict — and those rows are refused
      // by the guard above, so reaching this line already means the
      // schedule is the user's own. Clearing a column this operation does
      // not own would still be wrong.
      await tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: false, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      await tx
        .insert(subscriptionEvents)
        .values({
          provider: sub.provider,
          providerEventId: `local_uncancel_${sub.providerSubscriptionId}_${now.toISOString()}`,
          eventType: 'local.cancellation_revoked',
          payload: {
            kind: 'cancellation_revoked',
            provider_subscription_id: sub.providerSubscriptionId,
            occurred_at: now.toISOString(),
          },
          processedAt: now,
        })
        .onConflictDoNothing();
    });

    this.logger.log(
      `billing_event kind=subscription_uncanceled provider=${sub.provider} workspace=${principal.workspaceId}`,
    );
    return this.getSubscription(principal.workspaceId);
  }

  /**
   * D118 — "Pause for 30 days" instead of cancelling. The retention
   * offer the D-body specced; it had no endpoint and no button until
   * now, so the lever meant to catch a cancellation never ran.
   *
   * The entitlement drop is NOT written here. A paused subscription
   * grants nothing, and every other grant/revoke arrives via webhook
   * (D117) — `subscription.paused` flips `status` and recomputes the
   * tier through the single writer that owns that. Writing it locally
   * would be a third copy of the tier recompute and could revoke access
   * for a pause the provider ultimately rejected. Erring toward a few
   * seconds of extra access is the safe direction.
   */
  async pauseForThirtyDays(principal: { workspaceId: string }): Promise<BillingSubscription> {
    const [sub] = await this.db
      .select({
        id: subscriptions.id,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        status: subscriptions.status,
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
    if (sub.status === 'paused') {
      throw new AppException({ code: 'SUBSCRIPTION_PAUSED' });
    }
    // Pausing a subscription that is already on its way out would leave
    // two conflicting schedules on the provider row. Revoke the cancel
    // first — which is now possible.
    if (sub.cancelAtPeriodEnd) {
      throw new AppException({ code: 'SUBSCRIPTION_CANCELING' });
    }

    const resumeAt = new Date(Date.now() + PAUSE_DAYS * 24 * 60 * 60 * 1000);
    await this.adapterFor(sub.provider).pauseSubscription(
      sub.providerSubscriptionId,
      resumeAt.toISOString(),
    );

    // NOTHING about the pause is written locally — not `status`, and not
    // `pause_until` either. An earlier revision wrote `pause_until` here
    // as "just a display fact", which stranded the two stores against
    // each other: if the pause never took effect (provider rejects it
    // asynchronously, or the webhook never lands) the row kept a
    // resume date describing a pause that was not happening (Codex
    // stop-review, 2026-07-31).
    //
    // It was redundant as well as unsafe: Paddle answers a pause with
    // `scheduled_change: {action: 'resume', effective_at}`, which
    // `toNormalizedSubscription` already maps to `pauseUntil` when the
    // status is `paused` — so the webhook supplies the same value, and
    // only ever alongside the status that makes it true.
    //
    // What remains is the audit marker: an ordering record of the
    // request, which is a fact regardless of the outcome.
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await lockSubscription(tx, sub.provider, sub.providerSubscriptionId);
      await tx
        .insert(subscriptionEvents)
        .values({
          provider: sub.provider,
          providerEventId: `local_pause_${sub.providerSubscriptionId}_${now.toISOString()}`,
          eventType: 'local.pause_requested',
          payload: {
            kind: 'pause_requested',
            provider_subscription_id: sub.providerSubscriptionId,
            occurred_at: now.toISOString(),
            resume_at: resumeAt.toISOString(),
          },
          processedAt: now,
        })
        .onConflictDoNothing();
    });

    this.logger.log(
      `billing_event kind=subscription_pause_requested provider=${sub.provider} workspace=${principal.workspaceId} resume_at=${resumeAt.toISOString()}`,
    );
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
  /**
   * Shared entry guard for changePlan and its read-only preview — ONE
   * sequence so the dry run can never accept a subscription the real
   * change would reject (or vice versa).
   */
  private async loadChangeableSubscription(workspaceId: string) {
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
          eq(subscriptions.workspaceId, workspaceId),
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
    return sub;
  }

  /**
   * Read-only dry run of `changePlan` (D117/D120). Same guards, same
   * price resolution, same downgrade classification — then Paddle's
   * preview endpoint computes the exact immediate charge so the confirm
   * panel can state a number instead of "a prorated difference".
   * Nothing is written or applied.
   */
  async planChangePreview(
    principal: { workspaceId: string },
    dto: PlanChangeRequest,
  ): Promise<PlanChangePreview> {
    const sub = await this.loadChangeableSubscription(principal.workspaceId);
    if (
      sub.scheduledChangeState !== null ||
      (sub.tier === dto.tierId && sub.billingCycle === dto.cycle)
    ) {
      // Pending change or same-plan: the picker disables these paths;
      // nothing would be charged now, and nothing is worth previewing.
      return { kind: 'none' };
    }
    const priceId = this.catalog.resolvePriceId(sub.provider, dto.tierId, dto.cycle, false);
    if (!priceId) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    const isDowngrade =
      (sub.tier === 'pro' && dto.tierId === 'plus') ||
      (sub.tier === dto.tierId && sub.billingCycle === 'annual' && dto.cycle === 'monthly');
    if (isDowngrade) {
      return {
        kind: 'deferred',
        effectiveAt: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      };
    }
    const preview = await this.adapterFor(sub.provider).previewPlanChange(
      sub.providerSubscriptionId,
      priceId,
      { kind: 'immediate_prorated' },
    );
    return { kind: 'immediate', result: preview.result, nextBilledAt: preview.nextBilledAt };
  }

  async changePlan(
    principal: { workspaceId: string },
    dto: PlanChangeRequest,
  ): Promise<BillingSubscription> {
    const sub = await this.loadChangeableSubscription(principal.workspaceId);

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

    // Provider call IS the immediate upgrade — Paddle applies it
    // synchronously and the webhook merely confirms.
    await this.adapterFor(sub.provider).changePlan(sub.providerSubscriptionId, priceId, {
      kind: 'immediate_prorated',
    });

    this.logger.log(
      `billing.plan_change_requested workspace=${principal.workspaceId} provider=${sub.provider} from=${sub.tier}/${sub.billingCycle} to=${dto.tierId}/${dto.cycle}`,
    );

    // Project provider truth NOW through the one projector (D249)
    // instead of leaving the tier flip hostage to webhook delivery —
    // a lost webhook previously stranded a charged upgrade on the old
    // tier until the 6h sweep. Fail-open: the change already happened
    // provider-side, so a projection error must not fail the request;
    // the webhook, the on-demand reconcile, and the sweep all backstop.
    try {
      const projected = await this.reconciliation.reconcileWorkspaceSubscriptions(
        principal.workspaceId,
      );
      this.logger.log(
        `billing.plan_change_projected workspace=${principal.workspaceId} outcome=${projected}`,
      );
    } catch (err) {
      this.logger.warn(
        `billing.plan_change_project_failed workspace=${principal.workspaceId} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

    // Refuse to resume alongside a subscription that is already
    // billing. `resume` is a provider-side call whose effect returns
    // via webhook, so without this check the sequence is: user resumes
    // paused Plus while Pro is active -> the provider starts charging
    // for BOTH -> `subscription.updated` writes a second granting row,
    // and `recomputeWorkspaceTier` quietly grants the max rank. The
    // customer pays twice and no surface says so.
    //
    // Checkout has always guarded this (`SUBSCRIPTION_EXISTS`, above);
    // resume is the same "workspace gains a second billing
    // subscription" transition and was simply missed.
    const [alreadyBilling] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, principal.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due']),
        ),
      )
      .limit(1);
    if (alreadyBilling) {
      throw new AppException({ code: 'SUBSCRIPTION_EXISTS' });
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
