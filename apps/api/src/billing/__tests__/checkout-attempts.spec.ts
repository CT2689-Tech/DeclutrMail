import { createHmac } from 'node:crypto';
import { BillingPaddleWebhookController } from '../../webhooks/billing-paddle.controller.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  billingCustomers,
  billingCheckoutAttempts,
  entitlementGrants,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog } from '../billing-catalog.js';
import { BillingWebhookService } from '../billing-webhook.service.js';
import { PaddleAdapter } from '../paddle.adapter.js';
import type {
  CheckoutTransactionFacts,
  NormalizedBillingEvent,
} from '../billing-provider.interface.js';
import {
  checkoutAttemptView,
  findCheckoutAttempt,
  fulfillCheckoutAttempt,
  reconcileCheckoutAttempt,
  recordCheckoutPayment,
} from '../checkout-attempts.js';
import { ordinaryRefundPolicy } from './fixtures.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TXN = 'txn_01abcdefghjkmnpqrstvwxyz12';
const PRICE = 'pri_attempt_plus';
const PASS = 'pri_attempt_pass';

describe('durable checkout fulfillment and recovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  let db: DrizzleDb;
  let workspaceId: string;
  let webhook: BillingWebhookService;
  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as DrizzleDb;
    const [ws] = await db.insert(workspaces).values({ name: 'attempt workspace' }).returning();
    workspaceId = ws!.id;
    await db.insert(users).values({ workspaceId, email: 'attempt@example.test' });
    const catalog = new BillingCatalog(
      [
        {
          planCode: 'plus_monthly',
          tierId: 'plus',
          cycle: 'monthly',
          founding: false,
          usdCents: 900,
          paddlePriceId: PRICE,
          razorpayPlanId: null,
        },
      ],
      250,
      PASS,
    );
    webhook = new BillingWebhookService(
      db,
      catalog,
      new AutopilotReadService(db),
      ordinaryRefundPolicy,
    );
  });
  async function seed(offer: 'pass_onetime' | null = null) {
    await db.insert(billingCheckoutAttempts).values({
      id: ID,
      workspaceId,
      tier: 'plus',
      cycle: 'monthly',
      offer,
      providerPriceId: offer ? PASS : PRICE,
      currencyCode: 'USD',
      providerTransactionId: TXN,
      state: 'open',
    });
  }
  function event(
    over: Partial<Extract<NormalizedBillingEvent, { kind: 'payment' }>> = {},
  ): Extract<NormalizedBillingEvent, { kind: 'payment' }> {
    return {
      kind: 'payment',
      providerEventId: 'evt_attempt_paid',
      eventType: 'transaction.completed',
      outcome: 'succeeded',
      workspaceId,
      checkoutAttemptId: ID,
      providerTransactionId: TXN,
      providerSubscriptionId: null,
      providerCustomerId: null,
      checkoutPriceIds: [PASS],
      checkoutItemsValid: true,
      checkoutCurrencyCode: 'USD',
      oneTimePriceIds: [PASS],
      ...over,
    };
  }
  it('processes an established renewal carrying the original attempt without rebinding it', async () => {
    await seed();
    await db
      .update(billingCheckoutAttempts)
      .set({
        state: 'fulfilled',
        paidAt: new Date(),
        fulfilledAt: new Date(),
        providerSubscriptionId: 'sub_known',
      })
      .where(eq(billingCheckoutAttempts.id, ID));
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'paddle',
      providerSubscriptionId: 'sub_known',
      providerPriceId: PRICE,
      tier: 'plus',
      billingCycle: 'monthly',
      status: 'active',
    });
    const before = await findCheckoutAttempt(db, workspaceId, ID);
    const renewal = event({
      providerTransactionId: 'txn_renewal',
      providerSubscriptionId: 'sub_known',
      checkoutPriceIds: [PRICE],
      oneTimePriceIds: [],
    });
    await expect(webhook.process('paddle', renewal, {})).resolves.toMatchObject({
      kind: 'processed',
      effect: 'payment:succeeded',
    });
    expect(await findCheckoutAttempt(db, workspaceId, ID)).toEqual(before);
    await expect(
      recordCheckoutPayment(db, { ...renewal, providerSubscriptionId: 'sub_unowned' }),
    ).resolves.toBe(false);
    await db.delete(subscriptions);
    await expect(recordCheckoutPayment(db, renewal)).resolves.toBe(false);
  });
  function provider(state: CheckoutTransactionFacts['state'], sub: string | null = null) {
    return {
      readCheckoutAttempt: vi.fn(async () => ({
        state,
        transactionId: TXN,
        customerId: null,
        subscriptionId: sub,
      })),
      recoverCheckoutAttempt: vi.fn(async () => TXN),
      fetchSubscription: vi.fn(async () => ({
        kind: 'found',
        subscription: {
          providerSubscriptionId: 'sub_attempt',
          providerCustomerId: null,
          providerPriceId: PRICE,
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
          cancelAtPeriodEnd: false,
          pauseUntil: null,
          workspaceId,
        },
      })),
    } as unknown as PaddleAdapter;
  }
  it('a completed Pass fulfills its own attempt under complimentary Pro and replays once', async () => {
    await seed('pass_onetime');
    await db.insert(entitlementGrants).values({
      email: 'attempt@example.test',
      tier: 'pro',
      source: 'comp',
      reason: 'test',
      grantedBy: 'test',
    });
    const first = await reconcileCheckoutAttempt(
      db,
      provider('completed'),
      webhook,
      workspaceId,
      ID,
    );
    expect(first.state).toBe('fulfilled');
    const second = await reconcileCheckoutAttempt(
      db,
      provider('completed'),
      webhook,
      workspaceId,
      ID,
    );
    expect(second.state).toBe('fulfilled');
    const grants = await db
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.source, 'pass'));
    expect(grants).toHaveLength(1);
    expect((await db.select().from(workspaces))[0]!.tier).toBe('pro');
  });
  it('an existing Pass cannot fulfill a different purchase', async () => {
    await seed('pass_onetime');
    await db.insert(entitlementGrants).values({
      email: 'attempt@example.test',
      tier: 'plus',
      source: 'pass',
      provider: 'paddle',
      providerTransactionId: 'txn_previous',
      reason: 'old pass',
      grantedBy: 'test',
      expiresAt: new Date(Date.now() + 86400000),
    });
    await fulfillCheckoutAttempt(db, workspaceId, ID);
    expect((await findCheckoutAttempt(db, workspaceId, ID))!.state).toBe('open');
  });
  it('recovers a completed subscription through the same projector when both webhooks were lost', async () => {
    await seed();
    const result = await reconcileCheckoutAttempt(
      db,
      provider('completed', 'sub_attempt'),
      webhook,
      workspaceId,
      ID,
    );
    expect(result.state).toBe('fulfilled');
    expect((await db.select().from(subscriptions))[0]).toMatchObject({
      workspaceId,
      providerSubscriptionId: 'sub_attempt',
    });
  });
  it.each(['workspace', 'transaction', 'price', 'currency', 'quantity'] as const)(
    'refuses a payment with mismatched %s before granting access',
    async (mismatch) => {
      await seed('pass_onetime');
      const over =
        mismatch === 'workspace'
          ? { workspaceId: '22222222-2222-4222-8222-222222222222' }
          : mismatch === 'transaction'
            ? { providerTransactionId: 'txn_other' }
            : mismatch === 'price'
              ? { checkoutPriceIds: ['pri_other'] }
              : mismatch === 'quantity'
                ? { checkoutItemsValid: false }
                : { checkoutCurrencyCode: 'INR' };
      const result = await webhook.process('paddle', event(over), {});
      expect(result.kind).toBe('unresolved');
      expect(await db.select().from(entitlementGrants)).toHaveLength(0);
    },
  );
  it('never downgrades paid evidence when a later read says unpaid', async () => {
    await seed('pass_onetime');
    await recordCheckoutPayment(db, event());
    const result = await reconcileCheckoutAttempt(db, provider('unpaid'), webhook, workspaceId, ID);
    expect(result.state).toBe('paid');
    expect(result.canResume).toBe(false);
    expect(result.canCancel).toBe(false);
  });
  it('an unreadable transaction remains held', async () => {
    await seed();
    const paddle = provider('unpaid');
    vi.mocked(paddle.readCheckoutAttempt).mockResolvedValue(null);
    expect((await reconcileCheckoutAttempt(db, paddle, webhook, workspaceId, ID)).state).toBe(
      'unknown',
    );
    expect(await findCheckoutAttempt(db, workspaceId)).not.toBeNull();
  });
  it('recovers a missing transaction binding without creating another transaction', async () => {
    await seed('pass_onetime');
    await db.update(billingCheckoutAttempts).set({ state: 'unknown', providerTransactionId: null });
    const paddle = provider('completed');
    const result = await reconcileCheckoutAttempt(db, paddle, webhook, workspaceId, ID);
    expect(result.state).toBe('fulfilled');
    expect(paddle.recoverCheckoutAttempt).toHaveBeenCalledTimes(1);
  });
  it('a stale provider read cannot overwrite a newer payment or release another attempt', async () => {
    await seed('pass_onetime');
    const paddle = provider('unpaid');
    vi.mocked(paddle.readCheckoutAttempt).mockImplementation(async () => {
      await recordCheckoutPayment(db, event());
      return { state: 'stopped', transactionId: TXN, customerId: null, subscriptionId: null };
    });
    expect((await reconcileCheckoutAttempt(db, paddle, webhook, workspaceId, ID)).state).toBe(
      'paid',
    );
  });
  it('cross-workspace reads do not expose the attempt', async () => {
    await seed();
    await expect(
      reconcileCheckoutAttempt(
        db,
        provider('unpaid'),
        webhook,
        '22222222-2222-4222-8222-222222222222',
        ID,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('only confirmed stopping makes the purchase replaceable', async () => {
    await seed();
    const result = await reconcileCheckoutAttempt(
      db,
      provider('stopped'),
      webhook,
      workspaceId,
      ID,
    );
    expect(result.state).toBe('stopped');
    expect(await findCheckoutAttempt(db, workspaceId)).toBeNull();
    expect(checkoutAttemptView((await findCheckoutAttempt(db, workspaceId, ID))!).canResume).toBe(
      false,
    );
  });
  it('defers a modern subscription echo until its exact paid transaction is bound', async () => {
    await seed();
    const result = await webhook.process(
      'paddle',
      {
        kind: 'subscription',
        eventType: 'subscription.activated',
        providerEventId: 'evt_rogue_sub',
        subscription: {
          providerSubscriptionId: 'sub_rogue',
          providerCustomerId: null,
          providerPriceId: PRICE,
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pauseUntil: null,
          workspaceId,
          checkoutAttemptId: ID,
        },
      },
      {},
    );
    expect(result.kind).toBe('unresolved');
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
  it('creation-flag rollback cannot bypass modern admission through an existing customer mapping', async () => {
    await seed();
    await db.insert(billingCustomers).values({
      workspaceId,
      provider: 'paddle',
      providerCustomerId: 'ctm_existing',
      region: 'international',
    });
    const result = await webhook.process(
      'paddle',
      {
        kind: 'subscription',
        eventType: 'subscription.activated',
        providerEventId: 'evt_rollback_sub',
        subscription: {
          providerSubscriptionId: 'sub_rogue',
          providerCustomerId: 'ctm_existing',
          providerPriceId: PRICE,
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pauseUntil: null,
          workspaceId: null,
        },
      },
      {},
    );
    expect(result.kind).toBe('unresolved');
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
  it('an unpaid snapshot cannot reopen a cancellation command, and terminal proof finishes it', async () => {
    await seed();
    await db.update(billingCheckoutAttempts).set({ state: 'stopping' });
    expect(
      (await reconcileCheckoutAttempt(db, provider('unpaid'), webhook, workspaceId, ID)).state,
    ).toBe('stopping');
    await db.update(billingCheckoutAttempts).set({ lastCheckedAt: null });
    expect(
      (await reconcileCheckoutAttempt(db, provider('stopped'), webhook, workspaceId, ID)).state,
    ).toBe('stopped');
  });
  it('late payment evidence on an older stopped purchase disarms a newer checkout', async () => {
    await seed('pass_onetime');
    await db.update(billingCheckoutAttempts).set({ state: 'stopped' });
    const otherId = '33333333-3333-4333-8333-333333333333';
    await db.insert(billingCheckoutAttempts).values({
      id: otherId,
      workspaceId,
      tier: 'plus',
      cycle: 'monthly',
      providerPriceId: PASS,
      currencyCode: 'USD',
      state: 'open',
      offer: 'pass_onetime',
    });
    expect(await recordCheckoutPayment(db, event())).toBe(true);
    expect((await findCheckoutAttempt(db, workspaceId, otherId))!.state).toBe('unknown');
  });
  it('an established subscription binding survives sparse events and rejects a different subscription', async () => {
    await seed();
    const linked = event({
      checkoutPriceIds: [PRICE],
      oneTimePriceIds: [],
      providerSubscriptionId: 'sub_bound',
    });
    expect(await recordCheckoutPayment(db, linked)).toBe(true);
    expect(await recordCheckoutPayment(db, { ...linked, providerSubscriptionId: null })).toBe(true);
    expect((await findCheckoutAttempt(db, workspaceId, ID))!.providerSubscriptionId).toBe(
      'sub_bound',
    );
    expect(
      await recordCheckoutPayment(db, { ...linked, providerSubscriptionId: 'sub_other' }),
    ).toBe(false);
  });

  it('carries signed creation identity through raw webhook authentication to exactly one Pass grant', async () => {
    await seed('pass_onetime');
    const secret = 'synthetic_raw_webhook_secret';
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', secret);
    let createdCustom: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        createdCustom = body.custom_data;
        return new Response(JSON.stringify({ data: { id: TXN, currency_code: 'USD' } }));
      }),
    );
    const paddle = new PaddleAdapter({
      PADDLE_ENV: 'sandbox',
      PADDLE_API_KEY: 'synthetic_sandbox_key',
      PADDLE_CLIENT_TOKEN: 'synthetic_client',
      PADDLE_WEBHOOK_SECRET: secret,
    });
    await paddle.createCheckout({
      workspaceId,
      checkoutAttemptId: ID,
      checkoutOffer: 'pass_onetime',
      userEmail: 'attempt@example.test',
      tierId: 'plus',
      cycle: 'annual',
      providerPriceId: PASS,
    });
    const payload = {
      event_id: 'evt_raw_completed',
      event_type: 'transaction.completed',
      occurred_at: new Date().toISOString(),
      data: {
        id: TXN,
        status: 'completed',
        currency_code: 'USD',
        subscription_id: null,
        custom_data: createdCustom,
        items: [{ price: { id: PASS }, quantity: 1 }],
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const ts = String(Math.floor(Date.now() / 1000));
    const signature =
      'ts=' +
      ts +
      ';h1=' +
      createHmac('sha256', secret)
        .update(ts + ':')
        .update(rawBody)
        .digest('hex');
    const controller = new BillingPaddleWebhookController(paddle, webhook, {
      record: vi.fn(),
    } as never);
    const request = { rawBody } as Parameters<BillingPaddleWebhookController['receive']>[0];
    await expect(controller.receive(request, 'ts=' + ts + ';h1=00')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(await db.select().from(entitlementGrants)).toHaveLength(0);
    await controller.receive(request, signature);
    await controller.receive(request, signature);
    expect(await db.select().from(entitlementGrants)).toHaveLength(1);
    expect((await findCheckoutAttempt(db, workspaceId, ID))!.state).toBe('fulfilled');
  });
});
