import {
  billingCustomers,
  pendingCheckouts,
  subscriptionEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { AppException } from '../../common/app-exception.js';
import { BillingCatalog, type CatalogEntry } from '../billing-catalog.js';
import { BillingService } from '../billing.service.js';
import type { BillingReconciliationService } from '../billing-reconciliation.service.js';
import type { PaddleAdapter } from '../paddle.adapter.js';
import type { RazorpayAdapter } from '../razorpay.adapter.js';

/**
 * BillingService integration tests (D117 checkout routing + D118
 * cancel) against PGlite. Adapters are stubbed — their provider-API
 * behavior is covered by their own specs; these tests pin the
 * service's DB semantics: single-active-subscription rule, catalog
 * fail-closed, billing-region recording, founding availability, and
 * the cancel → cancel_at_period_end + reason-audit flow.
 */

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
}

const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    planCode: 'plus_monthly',
    tierId: 'plus',
    cycle: 'monthly',
    founding: false,
    usdCents: 900,
    paddlePriceId: 'pri_plus_m',
    razorpayPlanId: 'plan_plus_m',
  },
  {
    planCode: 'pro_annual',
    tierId: 'pro',
    cycle: 'annual',
    founding: false,
    usdCents: 19000,
    paddlePriceId: 'pri_pro_a',
    razorpayPlanId: null, // not provisioned — exercises fail-closed
  },
  {
    planCode: 'plus_annual',
    tierId: 'plus',
    cycle: 'annual',
    founding: false,
    usdCents: 9000,
    paddlePriceId: 'pri_plus_a',
    razorpayPlanId: null,
  },
  {
    planCode: 'pro_annual_founding',
    tierId: 'pro',
    cycle: 'annual',
    founding: true,
    usdCents: 12900,
    paddlePriceId: 'pri_pro_f',
    razorpayPlanId: 'plan_pro_f',
  },
];

describe('BillingService', () => {
  /**
   * A period end far enough out that `changePlan`'s 30-minute
   * PLAN_CHANGE_TOO_LATE guard cannot trip.
   *
   * RELATIVE TO NOW, DELIBERATELY. This was hard-coded as
   * `2026-08-20T12:00:00.000Z`, which is a date bomb: it sat in the
   * future for months, then quietly became "today" on 2026-08-20 and
   * failed six tests at once with `PLAN_CHANGE_TOO_LATE` — a real guard
   * firing on a fixture that had aged into the past, not a regression in
   * anything these tests are about. A fixed future date in a test that
   * compares against `Date.now()` always has an expiry date; an offset
   * does not.
   */
  const DEFERRED_PERIOD_END = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let db: DrizzleDb;
  let service: BillingService;
  let paddleCheckout: ReturnType<typeof vi.fn>;
  let paddleCancel: ReturnType<typeof vi.fn>;
  let paddleChangePlan: ReturnType<typeof vi.fn>;
  let paddlePreviewPlanChange: ReturnType<typeof vi.fn>;
  let paddleResume: ReturnType<typeof vi.fn>;
  let paddleClearScheduledCancellation: ReturnType<typeof vi.fn>;
  let paddlePause: ReturnType<typeof vi.fn>;
  let reconcileWorkspace: ReturnType<typeof vi.fn>;
  let paddleListInvoices: ReturnType<typeof vi.fn>;
  let paddleInvoiceDocumentUrl: ReturnType<typeof vi.fn>;
  let paddlePaymentMethodSession: ReturnType<typeof vi.fn>;
  let razorpayListInvoices: ReturnType<typeof vi.fn>;
  let reconciliationStub: BillingReconciliationService;
  let principal: { userId: string; workspaceId: string };

  beforeEach(async () => {
    db = await freshDb();
    reconcileWorkspace = vi.fn().mockResolvedValue('already_recorded');
    reconciliationStub = {
      reconcileWorkspaceSubscriptions: reconcileWorkspace,
    } as unknown as BillingReconciliationService;
    paddleCheckout = vi.fn().mockResolvedValue({
      provider: 'paddle',
      kind: 'overlay',
      priceId: 'pri_plus_m',
      clientToken: 'test_tok',
      environment: 'sandbox',
      customData: { workspace_id: 'set-below', sig: 'test-sig' },
    });
    paddleCancel = vi.fn().mockResolvedValue(undefined);
    paddleChangePlan = vi.fn().mockResolvedValue({
      providerPriceId: null,
      providerUpdatedAt: null,
    });
    paddlePreviewPlanChange = vi.fn().mockResolvedValue({ result: null, nextBilledAt: null });
    paddleResume = vi.fn().mockResolvedValue(undefined);
    paddleClearScheduledCancellation = vi.fn().mockResolvedValue(undefined);
    paddlePause = vi.fn().mockResolvedValue(undefined);
    paddleListInvoices = vi.fn().mockResolvedValue({ invoices: [], truncated: false, omitted: 0 });
    paddleInvoiceDocumentUrl = vi.fn().mockResolvedValue('https://paddle.example/doc.pdf');
    paddlePaymentMethodSession = vi
      .fn()
      .mockResolvedValue({ kind: 'url', url: 'https://paddle.example/portal' });
    const paddle = {
      id: 'paddle',
      createCheckout: paddleCheckout,
      cancelSubscription: paddleCancel,
      changePlan: paddleChangePlan,
      previewPlanChange: paddlePreviewPlanChange,
      resumeSubscription: paddleResume,
      clearScheduledCancellation: paddleClearScheduledCancellation,
      pauseSubscription: paddlePause,
      listInvoices: paddleListInvoices,
      invoiceDocumentUrl: paddleInvoiceDocumentUrl,
      paymentMethodSession: paddlePaymentMethodSession,
    } as unknown as PaddleAdapter;
    razorpayListInvoices = vi
      .fn()
      .mockResolvedValue({ invoices: [], truncated: false, omitted: 0 });
    const razorpay = {
      id: 'razorpay',
      createCheckout: vi.fn(),
      cancelSubscription: vi.fn(),
      changePlan: vi.fn(),
      resumeSubscription: vi.fn(),
      clearScheduledCancellation: vi.fn(),
      pauseSubscription: vi.fn(),
      listInvoices: razorpayListInvoices,
      invoiceDocumentUrl: vi.fn().mockResolvedValue(null),
      paymentMethodSession: vi
        .fn()
        .mockResolvedValue({ kind: 'unsupported', reason: 'no_self_serve' }),
    } as unknown as RazorpayAdapter;
    service = new BillingService(
      db,
      new BillingCatalog(CATALOG_ENTRIES, 2),
      paddle,
      razorpay,
      // The upgrade path projects provider truth post-changePlan; specs
      // here assert the adapter calls, not the projection (covered in
      // billing-reconciliation.service.spec.ts).
      reconciliationStub,
    );

    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Checkout WS' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'buyer@example.com' })
      .returning({ id: users.id });
    principal = { userId: user!.id, workspaceId: ws!.id };
  });

  it('checkout resolves the catalog price, records billing_region, delegates to the adapter', async () => {
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    expect(paddleCheckout).toHaveBeenCalledWith({
      workspaceId: principal.workspaceId,
      userEmail: 'buyer@example.com',
      tierId: 'plus',
      cycle: 'monthly',
      providerPriceId: 'pri_plus_m',
    });
    const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
    expect(user!.billingRegion).toBe('international');
  });

  it('refuses a SECOND checkout while an unexpired claim exists — atomic, cross-device (CHECKOUT_IN_FLIGHT)', async () => {
    // The race the 0051 index only made LOUD: two devices opening
    // checkout inside the read window both reached the provider and
    // both could complete. The claim is one conditional upsert — it
    // wins iff no row exists or the existing one expired — so the
    // second opener is refused BEFORE any provider session exists.
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_IN_FLIGHT' });
    expect(paddleCheckout).toHaveBeenCalledTimes(1);
  });

  it('an EXPIRED claim is reclaimable — abandoned checkouts self-heal at the TTL', async () => {
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    await db
      .update(pendingCheckouts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingCheckouts.workspaceId, principal.workspaceId));
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    expect(paddleCheckout).toHaveBeenCalledTimes(2);
  });

  it('a provider failure KEEPS the claim — an ambiguous outcome may be payable provider-side', async () => {
    // A timeout after the request landed still creates the provider
    // artifact, and Razorpay creates with customer_notify — the orphan
    // is payable from the provider's own emailed link. Auto-releasing
    // here reopened checkout for attempt #2 while #1 could still be
    // paid (Codex stop-review 2026-07-29). Only the TTL or the user's
    // explicit no-charge assertion reopens.
    paddleCheckout.mockRejectedValueOnce(new Error('paddle timeout'));
    await expect(
      service.createCheckout(principal, { tierId: 'plus', cycle: 'monthly', provider: 'paddle' }),
    ).rejects.toThrow('paddle timeout');
    await expect(
      service.createCheckout(principal, { tierId: 'plus', cycle: 'monthly', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_IN_FLIGHT' });
    expect(paddleCheckout).toHaveBeenCalledTimes(1);

    // The user-asserted release is the recovery path — then retry wins.
    await service.releasePendingCheckout(principal.workspaceId);
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    expect(paddleCheckout).toHaveBeenCalledTimes(2);
  });

  it('releasePendingCheckout clears the claim (the user-asserted "no charge" path)', async () => {
    await service.createCheckout(principal, {
      tierId: 'plus',
      cycle: 'monthly',
      provider: 'paddle',
    });
    await service.releasePendingCheckout(principal.workspaceId);
    await service.createCheckout(principal, {
      tierId: 'pro',
      cycle: 'annual',
      provider: 'paddle',
    });
    expect(paddleCheckout).toHaveBeenCalledTimes(2);
  });

  it('fails closed (BILLING_NOT_PROVISIONED) when the catalog has no id for the price point', async () => {
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'razorpay' }),
    ).rejects.toMatchObject({ code: 'BILLING_NOT_PROVISIONED' });
  });

  it('rejects a second checkout while a granting subscription exists (SUBSCRIPTION_EXISTS)', async () => {
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_existing',
      tier: 'plus',
      status: 'active',
      providerPriceId: 'pri_plus_m',
      billingCycle: 'monthly',
    });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
  });

  // A PAUSED blocker is a different refusal from a live one, and it used to
  // share `SUBSCRIPTION_EXISTS` — whose copy asserts the account "already has
  // an ACTIVE subscription", untrue of a paused row. On Razorpay that made a
  // real trap (sandbox smoke 2026-07-29): no no-charge resume, no plan change,
  // and the only message claimed an active subscription the user did not have.
  // The exit is cancel-then-resubscribe, so the code has to be distinguishable
  // for the UI to say that.
  it('distinguishes a PAUSED blocker from a live one (SUBSCRIPTION_PAUSED_BLOCKS_NEW)', async () => {
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_paused_rzp',
      tier: 'plus',
      status: 'paused',
      providerPriceId: 'plan_plus_m',
      billingCycle: 'monthly',
    });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PAUSED_BLOCKS_NEW' });
  });

  it('a live row outranks a paused one, so the stronger blocker is reported', async () => {
    // Both present: the message must name the live subscription, not the
    // paused one, or it would offer a cancel-and-resubscribe exit to someone
    // whose real answer is "change your plan".
    await db.insert(subscriptions).values([
      {
        workspaceId: principal.workspaceId,
        provider: 'razorpay',
        providerSubscriptionId: 'sub_paused_sibling',
        tier: 'plus',
        status: 'paused',
        providerPriceId: 'plan_plus_m',
        billingCycle: 'monthly',
      },
      {
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_live_sibling',
        tier: 'plus',
        status: 'active',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
      },
    ]);
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
  });

  // D253 — the settling window. A full refund ends entitlement immediately
  // while the row stays `active` until the provider confirms the refund
  // settled. For that stretch the customer holds nothing AND cannot buy, and
  // `SUBSCRIPTION_EXISTS` told them to go manage a subscription that is
  // already dead. The refusal stands; only the reason becomes true.
  const REFUND_SETTLING_ROW = {
    provider: 'paddle' as const,
    providerSubscriptionId: 'sub_refunded',
    tier: 'plus' as const,
    status: 'active' as const,
    providerPriceId: 'pri_plus_m',
    billingCycle: 'monthly' as const,
    cancelSource: 'refund' as const,
    entitlementEndsAt: new Date(Date.now() - 60_000),
  };

  it('a refunded row whose entitlement has LAPSED refuses with SUBSCRIPTION_REFUND_SETTLING', async () => {
    await db
      .insert(subscriptions)
      .values({ workspaceId: principal.workspaceId, ...REFUND_SETTLING_ROW });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_REFUND_SETTLING' });
  });

  // The founder decision this pins (2026-08-13): refunds unlock early,
  // CHARGEBACKS do not. A chargebacked customer stays blocked until the
  // period ends naturally, and the unchanged refusal is what says so —
  // re-arming the same payment method same-day is how a merchant-of-record
  // seller account gets flagged. Identical row shape, one enum apart.
  it('a CHARGEBACK with the same lapsed shape keeps the ORIGINAL refusal', async () => {
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      ...REFUND_SETTLING_ROW,
      providerSubscriptionId: 'sub_chargeback',
      cancelSource: 'chargeback',
    });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
  });

  // A refund verdict whose entitlement runs to the period end (the partial-
  // refund shapes) has NOT lapsed: that customer still holds the plan they
  // paid for, so the new code's "you hold nothing" premise is false for them.
  it('a refunded row whose entitlement is still in the FUTURE keeps SUBSCRIPTION_EXISTS', async () => {
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      ...REFUND_SETTLING_ROW,
      providerSubscriptionId: 'sub_refund_future',
      entitlementEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await expect(
      service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
  });

  it('blocks foundingPro checkout when the 250-cap (here 2) is exhausted', async () => {
    // Two founding subscriptions in OTHER workspaces exhaust the cap.
    for (const n of [1, 2]) {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: `F${n}` })
        .returning({ id: workspaces.id });
      await db.insert(subscriptions).values({
        workspaceId: ws!.id,
        provider: 'paddle',
        providerSubscriptionId: `sub_f${n}`,
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_f',
        billingCycle: 'annual',
        foundingMember: true,
      });
    }
    await expect(
      service.createCheckout(principal, {
        tierId: 'pro',
        cycle: 'annual',
        provider: 'paddle',
        promo: 'foundingPro',
      }),
    ).rejects.toMatchObject({ code: 'FOUNDING_PRO_SOLD_OUT' });
  });

  it('getSubscription returns free/null for never-subscribed workspaces', async () => {
    expect(await service.getSubscription(principal.workspaceId)).toEqual({
      tier: 'free',
      foundingMember: false,
      subscription: null,
      pendingCheckout: null,
    });
  });

  it('getSubscription serves the GRANTING row even when a non-granting row is newer (A6)', async () => {
    // Latest-by-updated_at let a paused row SHADOW the granting one, so
    // the FE read asserted two plans at once (audit A6). The read must
    // prefer the row in a granting status (active/past_due).
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_active_old',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_pro_a',
      billingCycle: 'annual',
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    });
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_paused_new',
      tier: 'plus',
      status: 'paused',
      providerPriceId: 'pri_plus_m',
      billingCycle: 'monthly',
      updatedAt: new Date('2026-07-20T00:00:00Z'),
    });
    await db
      .update(workspaces)
      .set({ tier: 'pro' })
      .where(eq(workspaces.id, principal.workspaceId));

    const result = await service.getSubscription(principal.workspaceId);
    expect(result.tier).toBe('pro');
    expect(result.subscription).toMatchObject({ tier: 'pro', status: 'active' });
  });

  it('getSubscription falls back to the most recent NON-granting row when nothing grants', async () => {
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_paused_old',
      tier: 'plus',
      status: 'paused',
      providerPriceId: 'pri_plus_m',
      billingCycle: 'monthly',
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    });
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_canceled_new',
      tier: 'pro',
      status: 'canceled',
      providerPriceId: 'pri_pro_a',
      billingCycle: 'annual',
      updatedAt: new Date('2026-07-20T00:00:00Z'),
    });

    const result = await service.getSubscription(principal.workspaceId);
    expect(result.subscription).toMatchObject({ tier: 'pro', status: 'canceled' });
  });

  it('cancelAtPeriodEnd calls the provider, sets the flag, records the D118 reason — idempotently', async () => {
    const periodEnd = new Date('2026-07-11T10:00:00Z');
    await db.insert(subscriptions).values({
      workspaceId: principal.workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_cancel_me',
      tier: 'pro',
      status: 'active',
      providerPriceId: 'pri_pro_a',
      billingCycle: 'annual',
      currentPeriodEnd: periodEnd,
    });
    await db
      .update(workspaces)
      .set({ tier: 'pro' })
      .where(eq(workspaces.id, principal.workspaceId));

    const result = await service.cancelAtPeriodEnd(principal, { reason: 'too_expensive' });
    expect(paddleCancel).toHaveBeenCalledWith('sub_cancel_me');
    expect(result.subscription).toMatchObject({
      status: 'active', // stays active until period end (D118)
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEnd.toISOString(),
    });
    expect(result.tier).toBe('pro'); // tier holds until the period ends

    const audits = await db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.eventType, 'local.cancellation_requested'));
    expect(audits).toHaveLength(1);
    // Shaped as a state-writing event on purpose: the webhook's
    // staleness check reads `kind` + `provider_subscription_id`, and a
    // plain audit blob was invisible to it, so an in-flight event that
    // predated the cancel could silently revert it.
    expect(audits[0]!.payload).toEqual({
      kind: 'cancellation_scheduled',
      provider_subscription_id: 'sub_cancel_me',
      occurred_at: expect.any(String),
      cancellation_reason: 'too_expensive',
    });

    // Second click: no second provider call, no second audit row.
    await service.cancelAtPeriodEnd(principal, {});
    expect(paddleCancel).toHaveBeenCalledTimes(1);
  });

  it('cancel without any granting subscription is NO_ACTIVE_SUBSCRIPTION', async () => {
    await expect(service.cancelAtPeriodEnd(principal, {})).rejects.toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  describe('resumeCancellation (D118 — the way back out of a cancel)', () => {
    async function seedCancellingPro(): Promise<void> {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_uncancel',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: new Date('2027-07-30T18:00:00Z'),
        cancelAtPeriodEnd: true,
      });
      await db
        .update(workspaces)
        .set({ tier: 'pro' })
        .where(eq(workspaces.id, principal.workspaceId));
    }

    it('revokes at the provider, clears the flag, and records a staleness-shaped marker', async () => {
      await seedCancellingPro();

      const result = await service.resumeCancellation(principal);
      expect(paddleClearScheduledCancellation).toHaveBeenCalledWith('sub_uncancel');
      expect(result.subscription).toMatchObject({
        status: 'active',
        cancelAtPeriodEnd: false,
      });
      expect(result.tier).toBe('pro');

      // Same shape as the cancel marker, for the same reason: a provider
      // event captured BEFORE this call must not win the lock afterwards
      // and re-assert `cancel_at_period_end: true`.
      const audits = await db
        .select()
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.eventType, 'local.cancellation_revoked'));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.payload).toEqual({
        kind: 'cancellation_revoked',
        provider_subscription_id: 'sub_uncancel',
        occurred_at: expect.any(String),
      });
    });

    it('is NO_SCHEDULED_CANCELLATION when nothing is scheduled — and never calls the provider', async () => {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_healthy',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: new Date('2027-07-30T18:00:00Z'),
      });

      await expect(service.resumeCancellation(principal)).rejects.toMatchObject({
        code: 'NO_SCHEDULED_CANCELLATION',
      });
      expect(paddleClearScheduledCancellation).not.toHaveBeenCalled();
    });

    it('is NO_ACTIVE_SUBSCRIPTION with no subscription at all', async () => {
      await expect(service.resumeCancellation(principal)).rejects.toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    });

    // The un-cancel must never launder a refund/chargeback verdict.
    // Since the projector pins `cancel_at_period_end` true under a local
    // verdict, such a row is REACHABLE here — it can sit in `active` for
    // the rest of its paid period. Revoking its schedule would clear the
    // renewal block at the provider while `entitlement_ends_at` (what
    // the tier recompute reads) keeps ending the plan: a button that
    // reports a restored subscription the account does not have.
    for (const source of ['refund', 'chargeback'] as const) {
      it(`refuses a ${source} verdict — never calls the provider, writes nothing`, async () => {
        await db.insert(subscriptions).values({
          workspaceId: principal.workspaceId,
          provider: 'paddle',
          providerSubscriptionId: 'sub_refunded',
          tier: 'pro',
          status: 'active',
          providerPriceId: 'pri_pro_a',
          billingCycle: 'annual',
          currentPeriodEnd: new Date('2027-07-30T18:00:00Z'),
          cancelAtPeriodEnd: true,
          cancelSource: source,
        });

        await expect(service.resumeCancellation(principal)).rejects.toMatchObject({
          code: 'CANCELLATION_NOT_REVOCABLE',
        });
        expect(paddleClearScheduledCancellation).not.toHaveBeenCalled();

        const [row] = await db
          .select({
            cancelSource: subscriptions.cancelSource,
            cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          })
          .from(subscriptions)
          .where(eq(subscriptions.providerSubscriptionId, 'sub_refunded'));
        expect(row).toMatchObject({ cancelSource: source, cancelAtPeriodEnd: true });
      });
    }
  });

  describe('pauseForThirtyDays (D118 retention offer)', () => {
    async function seedActivePro(overrides: Record<string, unknown> = {}): Promise<void> {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_pause',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: new Date('2027-07-30T18:00:00Z'),
        ...overrides,
      });
      await db
        .update(workspaces)
        .set({ tier: 'pro' })
        .where(eq(workspaces.id, principal.workspaceId));
    }

    it('pauses at the provider with a 30-day resume_at and records pause_until', async () => {
      await seedActivePro();
      const before = Date.now();

      const result = await service.pauseForThirtyDays(principal);

      expect(paddlePause).toHaveBeenCalledTimes(1);
      const [subId, resumeAt] = paddlePause.mock.calls[0] as [string, string];
      expect(subId).toBe('sub_pause');
      const days = (new Date(resumeAt).getTime() - before) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);

      // NOTHING about the pause is written locally — not `status`, and
      // not `pause_until`. Both belong to `subscription.paused`, like
      // every other grant/revoke (D117). Writing either here strands the
      // two stores if the pause does not take effect, and Paddle's
      // `scheduled_change.action='resume'` already supplies the date
      // through the webhook alongside the status that makes it true.
      expect(result.subscription?.status).toBe('active');
      expect(result.subscription?.pauseUntil).toBeNull();
      expect(result.tier).toBe('pro');

      // The audit marker IS written — the request happened, whatever the
      // provider ultimately does with it.
      const markers = await db
        .select()
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.eventType, 'local.pause_requested'));
      expect(markers).toHaveLength(1);
    });

    it('refuses a subscription already on its way out (two conflicting schedules)', async () => {
      await seedActivePro({ cancelAtPeriodEnd: true });
      await expect(service.pauseForThirtyDays(principal)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_CANCELING',
      });
      expect(paddlePause).not.toHaveBeenCalled();
    });

    it('refuses an already-paused subscription', async () => {
      await seedActivePro({ status: 'paused' });
      await expect(service.pauseForThirtyDays(principal)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_PAUSED',
      });
      expect(paddlePause).not.toHaveBeenCalled();
    });
  });

  describe('changePlan (D117/D120 paid↔paid switch)', () => {
    async function seedActivePlus(): Promise<void> {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_change_me',
        tier: 'plus',
        status: 'active',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
      });
      await db
        .update(workspaces)
        .set({ tier: 'plus' })
        .where(eq(workspaces.id, principal.workspaceId));
    }

    it('resolves the target price and delegates to the provider; tier is NOT written locally', async () => {
      await seedActivePlus();
      const result = await service.changePlan(principal, { tierId: 'pro', cycle: 'annual' });
      expect(paddleChangePlan).toHaveBeenCalledWith('sub_change_me', 'pri_pro_a', {
        kind: 'immediate_prorated',
      });
      // The endpoint itself never grants — the tier flip arrives via
      // projection (stubbed here as a no-op) or the webhook. Local
      // state still shows the pre-change subscription.
      expect(result.tier).toBe('plus');
      expect(result.subscription).toMatchObject({ tier: 'plus', cycle: 'monthly' });
      // The upgrade projects provider truth in-request (D249) so a
      // lost webhook cannot strand a charged upgrade on the old tier.
      expect(reconcileWorkspace).toHaveBeenCalledWith(principal.workspaceId);
    });

    it('a projection failure never fails the upgrade request (fail-open, webhook backstops)', async () => {
      await seedActivePlus();
      reconcileWorkspace.mockRejectedValueOnce(new Error('projector down'));
      const result = await service.changePlan(principal, { tierId: 'pro', cycle: 'annual' });
      expect(result.subscription).toMatchObject({ tier: 'plus' });
    });

    it('same tier+cycle is an idempotent no-op (no provider call)', async () => {
      await seedActivePlus();
      const result = await service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
      expect(reconcileWorkspace).not.toHaveBeenCalled();
      expect(result.subscription).toMatchObject({ tier: 'plus', cycle: 'monthly' });
    });

    it('planChangePreview: upgrade previews via the provider; downgrade/same-plan never call it', async () => {
      await seedActivePlus();
      paddlePreviewPlanChange.mockResolvedValueOnce({
        result: { action: 'charge', amount: '18101', currencyCode: 'USD' },
        nextBilledAt: '2027-07-30T18:00:27.060Z',
      });
      const up = await service.planChangePreview(principal, { tierId: 'pro', cycle: 'annual' });
      expect(paddlePreviewPlanChange).toHaveBeenCalledWith('sub_change_me', 'pri_pro_a', {
        kind: 'immediate_prorated',
      });
      expect(up).toEqual({
        kind: 'immediate',
        result: { action: 'charge', amount: '18101', currencyCode: 'USD' },
        nextBilledAt: '2027-07-30T18:00:27.060Z',
      });

      // Same plan — nothing to preview, no provider call.
      const same = await service.planChangePreview(principal, {
        tierId: 'plus',
        cycle: 'monthly',
      });
      expect(same).toEqual({ kind: 'none' });

      // Downgrade — deferred to period end, still no provider call.
      paddlePreviewPlanChange.mockClear();
      await db
        .update(subscriptions)
        .set({ currentPeriodEnd: DEFERRED_PERIOD_END })
        .where(eq(subscriptions.providerSubscriptionId, 'sub_change_me'));
      const down = await service.planChangePreview(principal, {
        tierId: 'plus',
        cycle: 'monthly',
      });
      // plus/monthly IS the current plan — use annual→monthly instead.
      expect(down).toEqual({ kind: 'none' });
      await db
        .update(subscriptions)
        .set({ billingCycle: 'annual', providerPriceId: 'pri_plus_a' })
        .where(eq(subscriptions.providerSubscriptionId, 'sub_change_me'));
      const cycleDown = await service.planChangePreview(principal, {
        tierId: 'plus',
        cycle: 'monthly',
      });
      expect(cycleDown).toEqual({
        kind: 'deferred',
        effectiveAt: DEFERRED_PERIOD_END.toISOString(),
      });
      expect(paddlePreviewPlanChange).not.toHaveBeenCalled();
    });

    it('refuses a downgrade scheduled too close to renewal (PLAN_CHANGE_TOO_LATE)', async () => {
      // NOTHING ASSERTED THIS GUARD BEFORE. `changePlan` refuses a
      // deferred change inside 30 minutes of the period end, because
      // Paddle cannot be relied on to apply it before the renewal fires
      // — but the only thing exercising that branch was the fixture
      // date above ageing into "today" and tripping it by accident,
      // which is a coincidence, not a test. Making the fixture relative
      // removed that accident, so this replaces it with real coverage.
      const almostDue = new Date(Date.now() + 10 * 60 * 1000);
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_too_late',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: almostDue,
      });
      await db
        .update(workspaces)
        .set({ tier: 'pro' })
        .where(eq(workspaces.id, principal.workspaceId));

      await expect(
        service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' }),
      ).rejects.toMatchObject({ code: 'PLAN_CHANGE_TOO_LATE' });
      // The provider must not be touched on a refusal.
      expect(paddleChangePlan).not.toHaveBeenCalled();
    });

    it('stores a Pro→Plus downgrade for period end and charges nothing now', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_downgrade',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
      });
      await db
        .update(workspaces)
        .set({ tier: 'pro' })
        .where(eq(workspaces.id, principal.workspaceId));

      const result = await service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' });

      expect(paddleChangePlan).toHaveBeenCalledWith('sub_downgrade', 'pri_plus_m', {
        kind: 'next_period_no_proration',
        effectiveAt: effectiveAt.toISOString(),
      });
      expect(result.tier).toBe('pro');
      expect(result.subscription?.scheduledChange).toEqual({
        tier: 'plus',
        cycle: 'monthly',
        effectiveAt: effectiveAt.toISOString(),
        state: 'scheduled',
      });
    });

    it('clears a pending marker after a definitive provider rejection', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_rejected',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
      });
      paddleChangePlan.mockRejectedValueOnce(
        new AppException({
          code: 'BILLING_PROVIDER_ERROR',
          details: { providerOutcome: 'definitive' },
        }),
      );

      await expect(
        service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' }),
      ).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR' });
      const [sub] = await db.select().from(subscriptions);
      expect(sub?.scheduledChangeState).toBeNull();
      expect(sub?.scheduledTier).toBeNull();
    });

    it('retains the mask after an ambiguous provider timeout', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_timeout',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
      });
      paddleChangePlan.mockRejectedValueOnce(new AppException({ code: 'BILLING_PROVIDER_ERROR' }));

      await expect(
        service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' }),
      ).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR' });
      const [sub] = await db.select().from(subscriptions);
      expect(sub).toMatchObject({
        tier: 'pro',
        scheduledTier: 'plus',
        scheduledChangeState: 'pending_provider',
      });
    });

    it('lets only one concurrent downgrade claim the provider mutation', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_race',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
      });

      const outcomes = await Promise.allSettled([
        service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' }),
        service.changePlan(principal, { tierId: 'plus', cycle: 'annual' }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
      expect(paddleChangePlan).toHaveBeenCalledTimes(1);
      const [sub] = await db.select().from(subscriptions);
      expect(sub?.scheduledProviderPriceId).toBe(paddleChangePlan.mock.calls[0]?.[1] as string);
    });

    it('clears the downgrade after Paddle synchronously confirms restoring the current plan', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_keep_current',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
        scheduledTier: 'plus',
        scheduledBillingCycle: 'monthly',
        scheduledProviderPriceId: 'pri_plus_m',
        scheduledChangeAt: effectiveAt,
        scheduledChangeState: 'scheduled',
        scheduledChangeRequestedAt: new Date(),
      });

      paddleChangePlan.mockResolvedValueOnce({
        providerPriceId: 'pri_pro_a',
        providerUpdatedAt: '2026-07-20T12:00:00.000Z',
      });
      const result = await service.changePlan(principal, { tierId: 'pro', cycle: 'annual' });

      expect(paddleChangePlan).toHaveBeenCalledWith('sub_keep_current', 'pri_pro_a', {
        kind: 'next_period_no_proration',
        effectiveAt: effectiveAt.toISOString(),
      });
      expect(result.subscription?.scheduledChange).toBeNull();
      const [sub] = await db.select().from(subscriptions);
      expect(sub?.scheduledChangeState).toBeNull();
      const [marker] = await db
        .select({ payload: subscriptionEvents.payload })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.eventType, 'local.plan_restore_confirmed'));
      expect(marker?.payload).toMatchObject({
        kind: 'subscription',
        provider_price_id: 'pri_pro_a',
        occurred_at: '2026-07-20T12:00:00.000Z',
      });
    });

    it('keeps restore retryable when a successful response cannot confirm the provider price', async () => {
      const effectiveAt = DEFERRED_PERIOD_END;
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_keep_unconfirmed',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        currentPeriodEnd: effectiveAt,
        scheduledTier: 'plus',
        scheduledBillingCycle: 'monthly',
        scheduledProviderPriceId: 'pri_plus_m',
        scheduledChangeAt: effectiveAt,
        scheduledChangeState: 'scheduled',
        scheduledChangeRequestedAt: new Date(),
      });

      const result = await service.changePlan(principal, { tierId: 'pro', cycle: 'annual' });

      expect(result.subscription?.scheduledChange?.state).toBe('restoring_current');
    });

    it('no subscription → NO_ACTIVE_SUBSCRIPTION', async () => {
      await expect(
        service.changePlan(principal, { tierId: 'pro', cycle: 'annual' }),
      ).rejects.toMatchObject({ code: 'NO_ACTIVE_SUBSCRIPTION' });
    });

    it('paused subscription → SUBSCRIPTION_PAUSED (resume or cancel first)', async () => {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_paused',
        tier: 'plus',
        status: 'paused',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
      });
      await expect(
        service.changePlan(principal, { tierId: 'pro', cycle: 'annual' }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PAUSED' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
    });

    it('Founding Pro subscription → FOUNDING_PLAN_LOCKED (price lock protected)', async () => {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_founding',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_f',
        billingCycle: 'annual',
        foundingMember: true,
      });
      await expect(
        service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' }),
      ).rejects.toMatchObject({ code: 'FOUNDING_PLAN_LOCKED' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
    });

    it('Razorpay subscription → PLAN_CHANGE_UNSUPPORTED (Paddle-only at launch)', async () => {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'razorpay',
        providerSubscriptionId: 'sub_rzp',
        tier: 'plus',
        status: 'active',
        providerPriceId: 'plan_plus_m',
        billingCycle: 'monthly',
      });
      await expect(
        service.changePlan(principal, { tierId: 'pro', cycle: 'annual' }),
      ).rejects.toMatchObject({ code: 'PLAN_CHANGE_UNSUPPORTED' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
    });

    it('unprovisioned target price fails closed (BILLING_NOT_PROVISIONED)', async () => {
      // The fixture catalog has NO pro_monthly entry.
      await seedActivePlus();
      await expect(
        service.changePlan(principal, { tierId: 'pro', cycle: 'monthly' }),
      ).rejects.toMatchObject({ code: 'BILLING_NOT_PROVISIONED' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
    });
  });

  describe('resume (D118 pause exit)', () => {
    it('delegates to the provider for a paused subscription; entitlement stays webhook-only', async () => {
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_paused',
        tier: 'plus',
        status: 'paused',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
      });
      const result = await service.resume(principal);
      expect(paddleResume).toHaveBeenCalledWith('sub_paused');
      // Local state unchanged until the provider webhook lands.
      expect(result.tier).toBe('free');
      expect(result.subscription).toMatchObject({ status: 'paused' });
    });

    it('REFUSES to resume while another subscription is already billing', async () => {
      // The double-charge path. `resume` is a provider-side call whose
      // effect lands via webhook, so with no guard the provider starts
      // charging for BOTH and the webhook writes a second granting row
      // — `recomputeWorkspaceTier` then quietly grants the max rank and
      // nothing on any screen says the customer is paying twice.
      // Checkout has always guarded this; resume was missed.
      // Providers chosen deliberately: `resume` calls the adapter of the
      // PAUSED subscription, so that one must be paddle — the only
      // adapter whose `resumeSubscription` is an observable mock here.
      // Seeding it as razorpay would make the assertion below vacuous:
      // paddleResume could not have fired either way.
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'razorpay',
        providerSubscriptionId: 'sub_active_pro',
        tier: 'pro',
        status: 'active',
        providerPriceId: 'pri_pro_m',
        billingCycle: 'monthly',
      });
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_paused_plus',
        tier: 'plus',
        status: 'paused',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
      });

      await expect(service.resume(principal)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_EXISTS',
      });
      // The refusal must land BEFORE the provider call — a resume that
      // rejected locally but still reached Paddle would bill the
      // customer anyway, which is the whole failure being prevented.
      expect(paddleResume).not.toHaveBeenCalled();
    });

    it('no paused subscription → NO_ACTIVE_SUBSCRIPTION', async () => {
      await expect(service.resume(principal)).rejects.toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    });
  });

  // D253. Freeing the plan slot leaves TWO rows on the workspace — the
  // dead refunded one and the repurchase. An earlier design left the
  // dead row `active`, and three reviews rejected it on exactly this:
  // every reader below would then have two candidates, the dead row
  // would win on `updated_at` (the drift sweep bumps it), and Cancel /
  // Pause / Change-plan would fire at a subscription id that no longer
  // bills while the live one kept charging. Flipping the dead row to
  // `canceled` preserves the singleton these readers assume — and
  // nothing writes to it afterwards, so it can never climb back to the
  // front: the terminal-canceled floor updates the EVENT row, not the
  // subscription, and the post-flip watch pass alerts without writing.
  describe('after a refund-then-repurchase, every action targets the LIVE row', () => {
    async function seedRefundedThenRepurchased(): Promise<void> {
      // The dead row: refunded, entitlement gone, flipped by settlement.
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_dead_refunded',
        tier: 'pro',
        status: 'canceled',
        providerPriceId: 'pri_pro_a',
        billingCycle: 'annual',
        cancelAtPeriodEnd: true,
        cancelSource: 'refund',
        entitlementEndsAt: new Date(),
      });
      await db.insert(subscriptions).values({
        workspaceId: principal.workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_live_repurchase',
        tier: 'plus',
        status: 'active',
        providerPriceId: 'pri_plus_m',
        billingCycle: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });
      await db
        .update(workspaces)
        .set({ tier: 'plus' })
        .where(eq(workspaces.id, principal.workspaceId));
    }

    it('getSubscription serves the repurchase, not the refunded plan', async () => {
      await seedRefundedThenRepurchased();
      const result = await service.getSubscription(principal.workspaceId);
      // Serving pro/annual here would show a paying customer the plan
      // they were refunded for.
      expect(result.subscription).toMatchObject({ tier: 'plus', cycle: 'monthly' });
    });

    it('changePlan targets the live subscription id', async () => {
      await seedRefundedThenRepurchased();
      await service.changePlan(principal, { tierId: 'pro', cycle: 'annual' });
      expect(paddleChangePlan).toHaveBeenCalledWith(
        'sub_live_repurchase',
        'pri_pro_a',
        expect.anything(),
      );
    });

    it('a second checkout is still refused — the LIVE row blocks it, plainly', async () => {
      // The dead row no longer blocks; the repurchase does. So the
      // refusal must be the ORDINARY one, never the settling message —
      // otherwise a customer holding a healthy subscription would be
      // told to wait for a refund that has nothing to do with them.
      await seedRefundedThenRepurchased();
      await expect(
        service.createCheckout(principal, { tierId: 'pro', cycle: 'annual', provider: 'paddle' }),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
    });
  });

  describe('D119 billing artifacts (ADR-0035 — provider-owned, proxied on read)', () => {
    const PADDLE_ROW = {
      id: 'txn_1',
      issuedAt: '2026-05-01T00:00:00.000Z',
      amount: '1900',
      currencyCode: 'USD',
      status: 'paid' as const,
      hostedUrl: null,
      documentAvailable: true,
    };
    const RZP_ROW = {
      id: 'inv_1',
      issuedAt: '2026-06-01T00:00:00.000Z',
      amount: '99900',
      currencyCode: 'INR',
      status: 'paid' as const,
      hostedUrl: 'https://rzp.io/i/x',
      documentAvailable: false,
    };

    /** A CANCELED paddle row + an ACTIVE razorpay row — the region-switch shape. */
    async function seedBothRails() {
      await db.insert(subscriptions).values([
        {
          workspaceId: principal.workspaceId,
          provider: 'paddle',
          providerSubscriptionId: 'sub_pdl_old',
          tier: 'plus',
          status: 'canceled',
          providerPriceId: 'pri_plus_m',
          billingCycle: 'monthly',
        },
        {
          workspaceId: principal.workspaceId,
          provider: 'razorpay',
          providerSubscriptionId: 'sub_rzp_live',
          tier: 'pro',
          status: 'active',
          providerPriceId: 'plan_pro_m',
          billingCycle: 'monthly',
        },
      ]);
    }

    it('unions invoices across BOTH rails, including a canceled row — the tax need outlives the subscription', async () => {
      await seedBothRails();
      paddleListInvoices.mockResolvedValue({
        invoices: [PADDLE_ROW],
        truncated: false,
        omitted: 0,
      });
      razorpayListInvoices.mockResolvedValue({ invoices: [RZP_ROW], truncated: false, omitted: 1 });
      const list = await service.listInvoices(principal.workspaceId);
      expect(paddleListInvoices).toHaveBeenCalledWith('sub_pdl_old');
      expect(razorpayListInvoices).toHaveBeenCalledWith('sub_rzp_live');
      // Newest first across providers; per-adapter omissions aggregate.
      expect(list.invoices.map((i) => i.id)).toEqual(['inv_1', 'txn_1']);
      expect(list.invoices[0]!.provider).toBe('razorpay');
      expect(list.omittedRows).toBe(1);
      expect(list.unavailableProviders).toEqual([]);
    });

    it('names an unreachable rail instead of failing the whole read or serving a silently short list', async () => {
      await seedBothRails();
      paddleListInvoices.mockRejectedValue(new AppException({ code: 'BILLING_PROVIDER_ERROR' }));
      razorpayListInvoices.mockResolvedValue({ invoices: [RZP_ROW], truncated: false, omitted: 0 });
      const list = await service.listInvoices(principal.workspaceId);
      expect(list.invoices.map((i) => i.id)).toEqual(['inv_1']);
      expect(list.unavailableProviders).toEqual(['paddle']);
    });

    it('reports the subscription-row cap as truncated instead of silently dropping the oldest rows', async () => {
      // Eleven canceled rows: one past the fan-out bound. The bound
      // walks ten; the eleventh existing is exactly what `truncated`
      // exists to disclose (no-silent-caps).
      await db.insert(subscriptions).values(
        Array.from({ length: 11 }, (_, i) => ({
          workspaceId: principal.workspaceId,
          provider: 'paddle' as const,
          providerSubscriptionId: `sub_old_${i}`,
          tier: 'plus' as const,
          status: 'canceled' as const,
          providerPriceId: 'pri_plus_m',
          billingCycle: 'monthly' as const,
        })),
      );
      const list = await service.listInvoices(principal.workspaceId);
      expect(paddleListInvoices).toHaveBeenCalledTimes(10);
      expect(list.truncated).toBe(true);
    });

    it('IDOR: an id absent from a COMPLETE listing is NOT_FOUND and never reaches the provider', async () => {
      await seedBothRails();
      paddleListInvoices.mockResolvedValue({
        invoices: [PADDLE_ROW],
        truncated: false,
        omitted: 0,
      });
      await expect(
        service.invoiceDocument(principal.workspaceId, 'txn_strangers'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(paddleInvoiceDocumentUrl).not.toHaveBeenCalled();
    });

    it('an id absent from an INCOMPLETE listing is a provider error, never "not found"', async () => {
      // With a rail unreadable, the id may belong to exactly the rows
      // we could not read — NOT_FOUND would tell the customer their
      // invoice does not exist during a provider blip.
      await seedBothRails();
      paddleListInvoices.mockRejectedValue(new AppException({ code: 'BILLING_PROVIDER_ERROR' }));
      await expect(service.invoiceDocument(principal.workspaceId, 'txn_1')).rejects.toMatchObject({
        code: 'BILLING_PROVIDER_ERROR',
      });
      expect(paddleInvoiceDocumentUrl).not.toHaveBeenCalled();
    });

    it('mints a document for an owned row that advertises one', async () => {
      await seedBothRails();
      paddleListInvoices.mockResolvedValue({
        invoices: [PADDLE_ROW],
        truncated: false,
        omitted: 0,
      });
      const doc = await service.invoiceDocument(principal.workspaceId, 'txn_1');
      expect(paddleInvoiceDocumentUrl).toHaveBeenCalledWith('txn_1');
      expect(doc).toEqual({ provider: 'paddle', url: 'https://paddle.example/doc.pdf' });
    });

    it('payment-method session: no granting subscription is a 409, not a provider call', async () => {
      await expect(service.paymentMethodSession(principal.workspaceId)).rejects.toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
      expect(paddlePaymentMethodSession).not.toHaveBeenCalled();
    });

    it('payment-method session: resolves ids from the granting row + customer record', async () => {
      await seedBothRails();
      await db.insert(billingCustomers).values({
        workspaceId: principal.workspaceId,
        provider: 'razorpay',
        providerCustomerId: 'cust_rzp_1',
        region: 'india',
      });
      const session = await service.paymentMethodSession(principal.workspaceId);
      // The granting row is the razorpay one — the canceled paddle row
      // must not be the instrument anyone is sent to update.
      expect(session).toEqual({
        kind: 'unsupported',
        reason: 'no_self_serve',
        provider: 'razorpay',
      });
    });

    it('payment-method session: a granting row with no customer record is a loud provider error', async () => {
      await seedBothRails();
      await expect(service.paymentMethodSession(principal.workspaceId)).rejects.toMatchObject({
        code: 'BILLING_PROVIDER_ERROR',
      });
    });
  });
});
