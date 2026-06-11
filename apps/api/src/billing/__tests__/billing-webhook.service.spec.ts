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
import { BillingWebhookService } from '../billing-webhook.service.js';
import { PaddleAdapter } from '../paddle.adapter.js';
import { RazorpayAdapter } from '../razorpay.adapter.js';
import {
  paddleAdjustmentCreated,
  paddleSubscriptionActivated,
  paddleTransactionCompleted,
  razorpaySubscriptionEvent,
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

const paddle = new PaddleAdapter({} as NodeJS.ProcessEnv);
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
      payload: fixture,
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
    expect(outcome).toEqual({ kind: 'ignored' });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('free');
    // Both events recorded + processed (audit trail, no retry loop).
    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(2);
    expect(eventRows.every((r) => r.processedAt !== null)).toBe(true);
  });

  it('unattributable events (no sub, no customer, bad workspace id) are recorded, never applied', async () => {
    const forged = paddleSubscriptionActivated({
      workspaceId: '99999999-9999-4999-8999-999999999999', // not a real workspace
      eventId: 'evt_forged_1',
      subscriptionId: 'sub_forged_1',
      customerId: 'ctm_forged_1',
    });
    const outcome = await service.process('paddle', paddle.mapWebhookEvent(forged), forged);
    expect(outcome).toEqual({ kind: 'ignored' });
    expect(await db.select().from(subscriptions)).toHaveLength(0);
    const eventRows = await db.select().from(subscriptionEvents);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.processedAt).not.toBeNull();
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
});
