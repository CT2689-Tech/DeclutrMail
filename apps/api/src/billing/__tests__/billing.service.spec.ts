import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { schema, subscriptionEvents, subscriptions, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { AppException } from '../../common/app-exception.js';
import { BillingCatalog, type CatalogEntry } from '../billing-catalog.js';
import { BillingService } from '../billing.service.js';
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

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
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
  let db: DrizzleDb;
  let service: BillingService;
  let paddleCheckout: ReturnType<typeof vi.fn>;
  let paddleCancel: ReturnType<typeof vi.fn>;
  let paddleChangePlan: ReturnType<typeof vi.fn>;
  let paddleResume: ReturnType<typeof vi.fn>;
  let principal: { userId: string; workspaceId: string };

  beforeEach(async () => {
    db = await freshDb();
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
    paddleResume = vi.fn().mockResolvedValue(undefined);
    const paddle = {
      id: 'paddle',
      createCheckout: paddleCheckout,
      cancelSubscription: paddleCancel,
      changePlan: paddleChangePlan,
      resumeSubscription: paddleResume,
    } as unknown as PaddleAdapter;
    const razorpay = {
      id: 'razorpay',
      createCheckout: vi.fn(),
      cancelSubscription: vi.fn(),
      changePlan: vi.fn(),
      resumeSubscription: vi.fn(),
    } as unknown as RazorpayAdapter;
    service = new BillingService(db, new BillingCatalog(CATALOG_ENTRIES, 2), paddle, razorpay);

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
    });
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
      // §10: the endpoint never grants — the webhook does. Local state
      // still shows the pre-change subscription.
      expect(result.tier).toBe('plus');
      expect(result.subscription).toMatchObject({ tier: 'plus', cycle: 'monthly' });
    });

    it('same tier+cycle is an idempotent no-op (no provider call)', async () => {
      await seedActivePlus();
      const result = await service.changePlan(principal, { tierId: 'plus', cycle: 'monthly' });
      expect(paddleChangePlan).not.toHaveBeenCalled();
      expect(result.subscription).toMatchObject({ tier: 'plus', cycle: 'monthly' });
    });

    it('stores a Pro→Plus downgrade for period end and charges nothing now', async () => {
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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
      const effectiveAt = new Date('2026-08-20T12:00:00.000Z');
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

    it('no paused subscription → NO_ACTIVE_SUBSCRIPTION', async () => {
      await expect(service.resume(principal)).rejects.toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    });
  });
});
