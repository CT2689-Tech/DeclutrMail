import { subscriptionEvents, subscriptions, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../../db/db.module.js';
import {
  claimFoundingRedemption,
  FOUNDING_REDEEMED,
  foundingRedemptionCount,
  preserveWorkspaceFoundingRedemptions,
} from '../founding-redemptions.js';

describe('permanent Founding allocations', () => {
  let db: DrizzleDb;
  beforeEach(async () => {
    db = (await freshTestDb()) as unknown as DrizzleDb;
  });

  async function legacy(provider: 'paddle' | 'razorpay' = 'paddle', id = 'sub_legacy') {
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Synthetic Founding account' })
      .returning();
    await db.insert(subscriptions).values({
      workspaceId: ws!.id,
      provider,
      providerSubscriptionId: id,
      tier: 'pro',
      status: 'canceled',
      providerPriceId: 'synthetic_founding_price',
      billingCycle: 'annual',
      foundingMember: true,
    });
    return ws!.id;
  }

  it('keeps a refunded/canceled legacy seat through workspace cascade deletion', async () => {
    const workspaceId = await legacy();
    expect(await foundingRedemptionCount(db)).toBe(1);
    await db.transaction(async (tx) => {
      await preserveWorkspaceFoundingRedemptions(tx, workspaceId);
      await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
    });
    expect(await db.select().from(subscriptions)).toHaveLength(0);
    expect(await foundingRedemptionCount(db)).toBe(1);
    expect(await db.transaction((tx) => claimFoundingRedemption(tx, 'paddle', 'sub_new', 1))).toBe(
      false,
    );
    const [entry] = await db.select().from(subscriptionEvents);
    expect(entry).toMatchObject({
      eventType: FOUNDING_REDEEMED,
      payload: { provider_subscription_id: 'sub_legacy' },
    });
    expect(entry!.processedAt).not.toBeNull();
  });

  it('counts durable and legacy records once and replays cannot consume another seat', async () => {
    const workspaceId = await legacy();
    await db.transaction(async (tx) => {
      await preserveWorkspaceFoundingRedemptions(tx, workspaceId);
      await preserveWorkspaceFoundingRedemptions(tx, workspaceId);
      expect(await claimFoundingRedemption(tx, 'paddle', 'sub_legacy', 1, false)).toBe(true);
    });
    expect(await foundingRedemptionCount(db)).toBe(1);
    expect(await db.select().from(subscriptionEvents)).toHaveLength(1);
  });

  it('allocates across both providers under one cap and never reuses an old identity', async () => {
    expect(await db.transaction((tx) => claimFoundingRedemption(tx, 'paddle', 'same_ref', 2))).toBe(
      true,
    );
    expect(
      await db.transaction((tx) => claimFoundingRedemption(tx, 'razorpay', 'same_ref', 2)),
    ).toBe(true);
    expect(await foundingRedemptionCount(db)).toBe(2);
    expect(
      await db.transaction((tx) => claimFoundingRedemption(tx, 'paddle', 'rejoin_new_ref', 2)),
    ).toBe(false);
    expect(await db.transaction((tx) => claimFoundingRedemption(tx, 'paddle', 'same_ref', 2))).toBe(
      true,
    );
  });

  it('does not allocate on a terminal first observation, grant or zero-value payment event', async () => {
    expect(
      await db.transaction((tx) =>
        claimFoundingRedemption(tx, 'paddle', 'unpaid_terminal', 2, false),
      ),
    ).toBe(false);
    await db.insert(subscriptionEvents).values({
      provider: 'paddle',
      providerEventId: 'evt_payment_method',
      eventType: 'transaction.completed',
      payload: { provider_subscription_id: 'unpaid_terminal', total: '0' },
      processedAt: new Date(),
    });
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Complimentary Pro', tier: 'pro' })
      .returning();
    await db.transaction((tx) => preserveWorkspaceFoundingRedemptions(tx, ws!.id));
    expect(await foundingRedemptionCount(db)).toBe(0);
  });
});
