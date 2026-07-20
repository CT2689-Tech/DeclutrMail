import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  billingCustomers,
  schema,
  subscriptionEvents,
  subscriptions,
  workspaces,
} from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog, type CatalogEntry } from '../billing-catalog.js';
import { BillingService } from '../billing.service.js';
import { BillingWebhookService, projectWebhookPayload } from '../billing-webhook.service.js';
import { PaddleAdapter } from '../paddle.adapter.js';
import { RazorpayAdapter } from '../razorpay.adapter.js';
import {
  paddleAdjustmentCreated,
  paddleSubscriptionActivated,
  paddleTransactionCompleted,
  razorpaySubscriptionEvent,
  TEST_PADDLE_WEBHOOK_SECRET,
  TEST_PRICE_IDS,
} from './fixtures.js';

/**
 * BillingWebhookService integration tests (D117, D118, D126).
 *
 * Runs against an in-process PGlite with every migration applied, so
 * the `(provider, provider_event_id)` dedup gate, the subscription
 * upsert key, the advisory-locked founding counter, and the tier flip
 * are exercised against the REAL schema. Events flow through the real
 * adapters' `mapWebhookEvent` — fixture → normalize → apply, the same
 * pipeline the controllers drive.
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

function testCatalog(foundingMax = 250): BillingCatalog {
  const entries: CatalogEntry[] = [
    {
      planCode: 'plus_monthly',
      tierId: 'plus',
      cycle: 'monthly',
      founding: false,
      usdCents: 900,
      paddlePriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.plus_monthly,
    },
    {
      planCode: 'pro_annual',
      tierId: 'pro',
      cycle: 'annual',
      founding: false,
      usdCents: 19000,
      paddlePriceId: TEST_PRICE_IDS.paddle.pro_annual,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.pro_annual,
    },
    {
      planCode: 'pro_annual_founding',
      tierId: 'pro',
      cycle: 'annual',
      founding: true,
      usdCents: 12900,
      paddlePriceId: TEST_PRICE_IDS.paddle.pro_annual_founding,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.pro_annual_founding,
    },
  ];
  return new BillingCatalog(entries, foundingMax);
}

async function seedWorkspace(db: DrizzleDb, name = 'Billing WS'): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name }).returning({ id: workspaces.id });
  return ws!.id;
}

/** D7 scrub helper — every key at every depth of a stored jsonb value. */
function collectKeysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysDeep(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out.push(key);
      collectKeysDeep(nested, out);
    }
  }
  return out;
}

/** PII key names real Paddle/Razorpay webhook bodies carry (D7-banned). */
const PII_KEYS = ['email', 'contact', 'card', 'name', 'billing_details', 'address'] as const;

const paddle = new PaddleAdapter({
  PADDLE_WEBHOOK_SECRET: TEST_PADDLE_WEBHOOK_SECRET,
} as unknown as NodeJS.ProcessEnv);
const razorpay = new RazorpayAdapter({} as NodeJS.ProcessEnv);

describe('BillingWebhookService.process', () => {
  let db: DrizzleDb;
  let service: BillingWebhookService;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new BillingWebhookService(db, testCatalog());
    workspaceId = await seedWorkspace(db);
  });

  it('flips the workspace tier from a Paddle subscription.activated — exactly once on replay', async () => {
    const fixture = paddleSubscriptionActivated({ workspaceId });
    const event = paddle.mapWebhookEvent(fixture);

    const first = await service.process('paddle', event, fixture);
    expect(first).toEqual({ kind: 'processed', effect: 'subscription:active' });

    // Replay the SAME event — dedup gate, no double effect.
    const second = await service.process('paddle', event, fixture);
    expect(second).toEqual({ kind: 'duplicate' });

    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.processedAt).not.toBeNull();

    const subRows = await db.select().from(subscriptions);
    expect(subRows).toHaveLength(1);
    expect(subRows[0]).toMatchObject({
      workspaceId,
      provider: 'paddle',
      tier: 'plus',
      status: 'active',
      billingCycle: 'monthly',
      foundingMember: false,
    });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');

    // Customer record captured for future webhook attribution.
    const customers = await db.select().from(billingCustomers);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      workspaceId,
      provider: 'paddle',
      providerCustomerId: 'ctm_01paddle000001',
      region: 'international',
    });
  });

  it('resumes processing when a prior delivery crashed after the dedup insert', async () => {
    const fixture = paddleSubscriptionActivated({ workspaceId });
    const event = paddle.mapWebhookEvent(fixture);
    // Simulate the crash: event row exists, processed_at null, no effect.
    await db.insert(subscriptionEvents).values({
      provider: 'paddle',
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payload: projectWebhookPayload(event, fixture),
    });

    const outcome = await service.process('paddle', event, fixture);
    expect(outcome).toEqual({ kind: 'processed', effect: 'subscription:active' });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.processedAt).not.toBeNull();
  });

  it('walks the full lifecycle: activated → paused (tier locks) → canceled (tier free)', async () => {
    const activate = paddleSubscriptionActivated({ workspaceId, eventId: 'evt_lc_1' });
    await service.process('paddle', paddle.mapWebhookEvent(activate), activate);

    const pause = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_lc_2',
      eventType: 'subscription.paused',
      status: 'paused',
      periodEndsAt: null,
      scheduledChange: { action: 'resume', effective_at: '2026-08-11T10:00:00.000000Z' },
    });
    await service.process('paddle', paddle.mapWebhookEvent(pause), pause);
    let [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    // D118 — features lock during pause.
    expect(ws!.tier).toBe('free');
    const [pausedSub] = await db.select().from(subscriptions);
    expect(pausedSub!.status).toBe('paused');
    expect(pausedSub!.pauseUntil).not.toBeNull();

    const cancel = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_lc_3',
      eventType: 'subscription.canceled',
      status: 'canceled',
      periodEndsAt: null,
    });
    await service.process('paddle', paddle.mapWebhookEvent(cancel), cancel);
    [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('free');
    const subRows = await db.select().from(subscriptions);
    expect(subRows).toHaveLength(1); // upsert, never a second row
    expect(subRows[0]!.status).toBe('canceled');
  });

  it('past_due keeps the entitlement (dunning grace)', async () => {
    const activate = paddleSubscriptionActivated({ workspaceId, eventId: 'evt_pd_1' });
    await service.process('paddle', paddle.mapWebhookEvent(activate), activate);
    const pastDue = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_pd_2',
      eventType: 'subscription.past_due',
      status: 'past_due',
    });
    await service.process('paddle', paddle.mapWebhookEvent(pastDue), pastDue);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('applies Razorpay events via notes attribution and flips pro tier', async () => {
    const fixture = razorpaySubscriptionEvent({ workspaceId });
    const event = razorpay.mapWebhookEvent({ ...fixture, __eventId: 'evt_rzp_1' });
    const outcome = await service.process('razorpay', event, fixture);
    expect(outcome).toEqual({ kind: 'processed', effect: 'subscription:active' });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('pro');
    const customers = await db.select().from(billingCustomers);
    expect(customers[0]).toMatchObject({ provider: 'razorpay', region: 'india' });
  });

  it('D126 — grants founding_member to the first N and stops at the cap (race-safe count)', async () => {
    service = new BillingWebhookService(db, testCatalog(2));
    const ws2 = await seedWorkspace(db, 'WS 2');
    const ws3 = await seedWorkspace(db, 'WS 3');

    const buy = (ws: string, n: number) =>
      paddleSubscriptionActivated({
        workspaceId: ws,
        eventId: `evt_found_${n}`,
        subscriptionId: `sub_found_${n}`,
        customerId: `ctm_found_${n}`,
        priceId: TEST_PRICE_IDS.paddle.pro_annual_founding,
      });

    // Sequential here — PGlite is a single backend so the advisory
    // lock cannot be contended in-test; the lock + in-tx count is the
    // production (multi-connection) race defense. This pins the
    // counter + cap + replay semantics.
    const f1 = buy(workspaceId, 1);
    const f2 = buy(ws2, 2);
    await service.process('paddle', paddle.mapWebhookEvent(f1), f1);
    await service.process('paddle', paddle.mapWebhookEvent(f2), f2);
    const f3 = buy(ws3, 3);
    await service.process('paddle', paddle.mapWebhookEvent(f3), f3);

    const subRows = await db.select().from(subscriptions);
    expect(subRows.filter((s) => s.foundingMember)).toHaveLength(2);
    // Spot #3 still gets pro — just not the price-lock flag.
    const [ws3Row] = await db.select().from(workspaces).where(eq(workspaces.id, ws3));
    expect(ws3Row!.tier).toBe('pro');
    expect(ws3Row!.foundingMember).toBe(false);
    const [ws1Row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws1Row!.foundingMember).toBe(true);

    // Replaying a founding purchase never re-counts it.
    await service.process('paddle', paddle.mapWebhookEvent(f1), f1);
    const after = await db.select().from(subscriptions);
    expect(after.filter((s) => s.foundingMember)).toHaveLength(2);
  });

  it('refund adjustment schedules cancel-at-period-end; tier holds until period end', async () => {
    const activate = paddleSubscriptionActivated({ workspaceId, eventId: 'evt_ref_1' });
    await service.process('paddle', paddle.mapWebhookEvent(activate), activate);

    const refund = paddleAdjustmentCreated({ eventId: 'evt_ref_2', action: 'refund' });
    const outcome = await service.process('paddle', paddle.mapWebhookEvent(refund), refund);
    expect(outcome).toEqual({ kind: 'processed', effect: 'cancellation_scheduled:refund' });

    const [sub] = await db.select().from(subscriptions);
    expect(sub!.cancelAtPeriodEnd).toBe(true);
    expect(sub!.status).toBe('active');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus'); // holds until the provider ends the period
  });

  it('payment events are observability-only; unknown price ids are recorded but never flip', async () => {
    const txn = paddleTransactionCompleted({});
    const txnOutcome = await service.process('paddle', paddle.mapWebhookEvent(txn), txn);
    expect(txnOutcome).toEqual({ kind: 'processed', effect: 'payment:succeeded' });

    const unknown = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_unknown_price',
      priceId: 'pri_never_provisioned',
    });
    const outcome = await service.process('paddle', paddle.mapWebhookEvent(unknown), unknown);
    expect(outcome).toEqual({ kind: 'unresolved', reason: 'unknown_price' });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('free');

    // The payment is terminal; the drifted price is NOT. Stamping the
    // latter processed made every provider retry short-circuit as
    // `duplicate`, so a real payment could never be recovered once the
    // catalog was patched (2026-07-20 sandbox incident).
    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(2);
    const drifted = eventRows.find((r) => r.providerEventId === 'evt_unknown_price');
    expect(drifted!.processedAt).toBeNull();
    expect(eventRows.find((r) => r.providerEventId !== 'evt_unknown_price')!.processedAt).not.toBe(
      null,
    );
  });

  it('an unresolved event re-drives on retry once the catalog is patched', async () => {
    const unknown = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_retry_me',
      priceId: 'pri_never_provisioned',
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(unknown), unknown)).toEqual({
      kind: 'unresolved',
      reason: 'unknown_price',
    });

    // Same event id again — must NOT short-circuit as `duplicate`; the
    // resume path re-drives it. Here it stays unresolved because the
    // catalog is still drifted, which is the point: the event survives
    // until someone fixes the cause.
    expect(await service.process('paddle', paddle.mapWebhookEvent(unknown), unknown)).toEqual({
      kind: 'unresolved',
      reason: 'unknown_price',
    });
    expect(await db.select().from(subscriptionEvents)).toHaveLength(1);
  });

  it('unattributable events (no sub, no customer, bad workspace id) are recorded, never applied', async () => {
    const forged = paddleSubscriptionActivated({
      workspaceId: '99999999-9999-4999-8999-999999999999', // not a real workspace
      eventId: 'evt_forged_1',
      subscriptionId: 'sub_forged_1',
      customerId: 'ctm_forged_1',
    });
    const outcome = await service.process('paddle', paddle.mapWebhookEvent(forged), forged);
    expect(outcome).toEqual({ kind: 'unresolved', reason: 'unattributable' });
    expect(await db.select().from(subscriptions)).toHaveLength(0);
    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(1);
    // Recorded for audit but left UNPROCESSED — a forged id is dropped
    // on every retry anyway, while a genuinely-not-yet-attributable
    // event gets to land once a sibling seeds billing_customers.
    expect(eventRows[0]!.processedAt).toBeNull();
  });

  it('a user cancel is not reverted by an in-flight webhook that predates it', async () => {
    // The advisory lock serializes writers but does NOT order them: a
    // provider event captured BEFORE the cancel can still win the lock
    // afterwards and upsert its pre-cancel `cancel_at_period_end:
    // false`. The user cancels, a renewal lands, and the cancellation
    // silently disappears. The local cancel therefore records a
    // state-writing event so the stale one loses the ordering check.
    const activate = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_ucr_activate',
      subscriptionId: 'sub_ucr',
    });
    await service.process('paddle', paddle.mapWebhookEvent(activate), activate);

    // A renewal is delivered and sits unprocessed (in flight).
    const inFlight = paddleSubscriptionActivated({
      workspaceId,
      eventId: 'evt_ucr_renewal',
      subscriptionId: 'sub_ucr',
      eventType: 'subscription.updated',
    });
    const inFlightEvent = paddle.mapWebhookEvent(inFlight);
    await db.insert(subscriptionEvents).values({
      provider: 'paddle',
      providerEventId: inFlightEvent.providerEventId,
      eventType: inFlightEvent.eventType,
      payload: projectWebhookPayload(inFlightEvent, inFlight),
    });

    // The user cancels through BillingService (provider call stubbed).
    const billing = new BillingService(
      db,
      testCatalog(),
      { id: 'paddle', cancelSubscription: async () => {} } as unknown as PaddleAdapter,
      { id: 'razorpay' } as unknown as RazorpayAdapter,
    );
    await billing.cancelAtPeriodEnd({ workspaceId }, { reason: 'too_expensive' });

    // Now the in-flight renewal finally processes. It must NOT revert.
    const outcome = await service.process('paddle', inFlightEvent, inFlight);
    expect(outcome).toEqual({ kind: 'ignored' });

    const [subRow] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_ucr'));
    expect(subRow!.cancelAtPeriodEnd).toBe(true);
  });

  it('a stale retry never overwrites newer subscription state', async () => {
    // The hazard introduced by leaving unresolved events unprocessed:
    // an old event becomes attributable LATER and re-drives on top of
    // state that has since moved on. Sequence: an activation arrives
    // unattributable → a cancel lands → the activation is retried and
    // now resolves. Without the guard it upserts `active` over the
    // cancel and hands entitlement back.
    const orphan = paddleSubscriptionActivated({
      eventId: 'evt_stale_activate',
      subscriptionId: 'sub_stale_1',
      customerId: 'ctm_stale_1',
      customData: {}, // no attribution yet
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(orphan), orphan)).toEqual({
      kind: 'unresolved',
      reason: 'unattributable',
    });

    // Attribution becomes possible, and a REAL activation + cancel land.
    const seed = paddleTransactionCompleted({
      workspaceId,
      customerId: 'ctm_stale_1',
      subscriptionId: 'sub_stale_1',
      eventId: 'evt_stale_txn',
    });
    await service.process('paddle', paddle.mapWebhookEvent(seed), seed);

    const canceled = paddleSubscriptionActivated({
      eventId: 'evt_stale_cancel',
      subscriptionId: 'sub_stale_1',
      customerId: 'ctm_stale_1',
      customData: {},
      status: 'canceled',
      eventType: 'subscription.canceled',
    });
    await service.process('paddle', paddle.mapWebhookEvent(canceled), canceled);

    const [afterCancel] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(afterCancel!.tier).toBe('free');

    // Provider retries the ORIGINAL activation. It now resolves — and
    // must be refused as stale rather than resurrecting the sub.
    const retry = await service.process('paddle', paddle.mapWebhookEvent(orphan), orphan);
    expect(retry).toEqual({ kind: 'ignored' });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('free');
    const [subRow] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, 'sub_stale_1'));
    expect(subRow!.status).toBe('canceled');
  });

  it('a stranded activation still lands when its seeding transaction arrived LATER', async () => {
    // Production ordering, and the case the staleness guard must NOT
    // eat: the activation is stranded first, and the transaction that
    // makes it attributable arrives afterwards. A payment event shares
    // the subscription id but writes no subscription state, so it can
    // never count as "newer state" — otherwise the retry that finally
    // resolves is discarded and the payment is lost a second time.
    const stranded = paddleSubscriptionActivated({
      eventId: 'evt_late_seed_activate',
      subscriptionId: 'sub_late_seed',
      customerId: 'ctm_late_seed',
      customData: {}, // provider echoed no attribution
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(stranded), stranded)).toEqual({
      kind: 'unresolved',
      reason: 'unattributable',
    });

    const seed = paddleTransactionCompleted({
      workspaceId,
      customerId: 'ctm_late_seed',
      subscriptionId: 'sub_late_seed',
      eventId: 'evt_late_seed_txn',
    });
    await service.process('paddle', paddle.mapWebhookEvent(seed), seed);

    // The provider retries the original activation. It must APPLY.
    const retry = await service.process('paddle', paddle.mapWebhookEvent(stranded), stranded);
    expect(retry.kind).toBe('processed');

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('a completed transaction seeds billing_customers so a later subscription attributes', async () => {
    // The failure mode this closes: Paddle does not reliably echo
    // checkout custom_data onto the SUBSCRIPTION entity. With no
    // customer mapping, such an activation is unattributable and the
    // paid workspace never flips.
    const txn = paddleTransactionCompleted({
      workspaceId,
      customerId: 'ctm_seed_1',
      subscriptionId: 'sub_seed_1',
      eventId: 'evt_txn_seed',
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(txn), txn)).toEqual({
      kind: 'processed',
      effect: 'payment:succeeded',
    });

    const activate = paddleSubscriptionActivated({
      eventId: 'evt_seed_activate',
      subscriptionId: 'sub_seed_1',
      customerId: 'ctm_seed_1',
      customData: {}, // provider echoed NO attribution
    });
    const outcome = await service.process('paddle', paddle.mapWebhookEvent(activate), activate);
    expect(outcome.kind).toBe('processed');

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
  });

  it('later events on a known subscription resolve the workspace WITHOUT payload attribution', async () => {
    const activate = paddleSubscriptionActivated({ workspaceId, eventId: 'evt_attr_1' });
    await service.process('paddle', paddle.mapWebhookEvent(activate), activate);

    // Same subscription, no custom_data this time (Paddle update events
    // may omit it) — must resolve via the existing subscriptions row.
    const update = paddleSubscriptionActivated({
      workspaceId: undefined as unknown as string,
      eventId: 'evt_attr_2',
      eventType: 'subscription.updated',
      status: 'past_due',
    });
    (update.data as { custom_data: unknown }).custom_data = null;
    await service.process('paddle', paddle.mapWebhookEvent(update), update);

    const [sub] = await db.select().from(subscriptions);
    expect(sub!.status).toBe('past_due');
    expect(sub!.workspaceId).toBe(workspaceId);
  });

  it('D7 — persists the projection, never Paddle PII (customer / billing_details / address)', async () => {
    const fixture = paddleSubscriptionActivated({ workspaceId, eventId: 'evt_pii_paddle_1' });
    const data = fixture.data as Record<string, unknown>;
    // Real Paddle bodies expand the customer + payment method — exactly
    // the PII the projection must drop.
    data.customer = {
      id: 'ctm_01paddle000001',
      name: 'Pat Example',
      email: 'pat@example.com',
      address: { first_line: '1 Market St', postal_code: '94105', country_code: 'US' },
    };
    data.billing_details = {
      payment_method: { card: { last4: '4242', name: 'Pat Example', expiry_year: 2030 } },
    };

    const event = paddle.mapWebhookEvent(fixture);
    await service.process('paddle', event, fixture);

    const [row] = await db.select().from(subscriptionEvents);
    // The stored row is EXACTLY the projection — nothing of the raw body.
    expect(row!.payload).toEqual(projectWebhookPayload(event, fixture));
    const keys = collectKeysDeep(row!.payload);
    for (const banned of PII_KEYS) {
      expect(keys).not.toContain(banned);
    }
    // The allowlisted billing metadata survives.
    expect(row!.payload).toMatchObject({
      kind: 'subscription',
      provider_event_id: 'evt_pii_paddle_1',
      event_type: 'subscription.activated',
      provider_subscription_id: 'sub_01paddle000001',
      provider_customer_id: 'ctm_01paddle000001',
      provider_price_id: TEST_PRICE_IDS.paddle.plus_monthly,
      status: 'active',
      provider_status: 'active',
      occurred_at: '2026-06-11T10:00:00.000000Z',
      period_start: '2026-06-11T10:00:00.000000Z',
      current_period_end: '2026-07-11T10:00:00.000000Z',
      workspace_id: workspaceId,
    });
  });

  it('D7 — persists the projection, never Razorpay PII (payment entity email / contact / card)', async () => {
    const fixture = razorpaySubscriptionEvent({ workspaceId, event: 'subscription.charged' });
    // subscription.charged delivers the payment entity alongside the
    // subscription — email/contact/card live there on real bodies.
    (fixture.payload as Record<string, unknown>).payment = {
      entity: {
        id: 'pay_rzp00000000001',
        amount: 1900000,
        currency: 'INR',
        email: 'pat@example.in',
        contact: '+919999999999',
        card: { last4: '1111', name: 'Pat Example', network: 'Visa' },
      },
    };

    const event = razorpay.mapWebhookEvent({ ...fixture, __eventId: 'evt_pii_rzp_1' });
    await service.process('razorpay', event, fixture);

    const [row] = await db.select().from(subscriptionEvents);
    expect(row!.payload).toEqual(projectWebhookPayload(event, fixture));
    const keys = collectKeysDeep(row!.payload);
    for (const banned of PII_KEYS) {
      expect(keys).not.toContain(banned);
    }
    expect(row!.payload).toMatchObject({
      kind: 'subscription',
      provider_event_id: 'evt_pii_rzp_1',
      event_type: 'subscription.charged',
      provider_subscription_id: 'sub_rzp00000000001',
      provider_customer_id: 'cust_rzp0000000001',
      provider_price_id: TEST_PRICE_IDS.razorpay.pro_annual,
      status: 'active',
      provider_status: 'active',
      occurred_at: 1781430100,
      period_start: 1781430000,
      workspace_id: workspaceId,
    });
  });
});
