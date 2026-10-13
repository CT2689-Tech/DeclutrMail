import { entitlementGrants, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog } from '../billing-catalog.js';
import { BillingWebhookService } from '../billing-webhook.service.js';
import { PaddleAdapter } from '../paddle.adapter.js';
import {
  ordinaryRefundPolicy,
  paddleAdjustmentCreated,
  paddleAdjustmentUpdated,
  paddleTransactionCompleted,
  TEST_PADDLE_WEBHOOK_SECRET,
} from './fixtures.js';

const PASS_PRICE = 'pri_pass_test';

const paddle = new PaddleAdapter({
  PADDLE_WEBHOOK_SECRET: TEST_PADDLE_WEBHOOK_SECRET,
} as unknown as NodeJS.ProcessEnv);

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
}

describe('Backlog Pass grants', () => {
  let db: DrizzleDb;
  let service: BillingWebhookService;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new BillingWebhookService(
      db,
      new BillingCatalog([], 0, PASS_PRICE),
      new AutopilotReadService(db),
      ordinaryRefundPolicy,
    );
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Pass WS' })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    await db.insert(users).values({ workspaceId, email: 'owner@example.test' });
  });

  function completed(transactionId: string, priceId = PASS_PRICE) {
    return paddleTransactionCompleted({
      eventId: `evt_${transactionId}`,
      subscriptionId: null,
      workspaceId,
      transactionId,
      priceIds: [priceId],
    });
  }

  it('grants Plus from a one-off transaction and ignores a replay', async () => {
    const fixture = completed('txn_pass_1');
    const event = paddle.mapWebhookEvent(fixture);
    expect(await service.process('paddle', event, fixture)).toEqual({
      kind: 'processed',
      effect: 'pass:granted',
    });
    expect(await service.process('paddle', event, fixture)).toEqual({ kind: 'duplicate' });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws!.tier).toBe('plus');
    const grants = await db.select().from(entitlementGrants);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ source: 'pass', provider: 'paddle', tier: 'plus' });
    expect(grants[0]!.expiresAt).not.toBeNull();
  });

  it('grants Plus from the India Pass price id', async () => {
    vi.stubEnv('PADDLE_LIVE_INDIA_PASS_PRICE_ID', 'pri_india_pass');
    vi.stubEnv('PADDLE_SANDBOX_INDIA_PASS_PRICE_ID', 'pri_india_pass');
    try {
      const fixture = completed('txn_pass_in', 'pri_india_pass');
      expect(await service.process('paddle', paddle.mapWebhookEvent(fixture), fixture)).toEqual({
        kind: 'processed',
        effect: 'pass:granted',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('extends a live Pass and leaves a comp row alone', async () => {
    await db.insert(entitlementGrants).values({
      email: 'owner@example.test',
      tier: 'plus',
      reason: 'advisor',
      grantedBy: 'founder',
      source: 'comp',
    });
    const first = completed('txn_pass_a');
    expect((await service.process('paddle', paddle.mapWebhookEvent(first), first)).kind).toBe(
      'processed',
    );
    const before = await db
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.providerTransactionId, 'txn_pass_a'));
    const second = completed('txn_pass_b');
    expect(await service.process('paddle', paddle.mapWebhookEvent(second), second)).toEqual({
      kind: 'processed',
      effect: 'pass:extended',
    });
    const grants = await db.select().from(entitlementGrants);
    expect(grants.filter((row) => row.source === 'comp')).toHaveLength(1);
    expect(grants.filter((row) => row.source === 'pass')).toHaveLength(2);
    const extended = grants.find((row) => row.providerTransactionId === 'txn_pass_b');
    expect(extended!.expiresAt!.getTime()).toBeGreaterThan(before[0]!.expiresAt!.getTime());
  });

  it('grants from the price id when price custom_data is null', async () => {
    const fixture = paddleTransactionCompleted({
      eventId: 'evt_null_price_custom_data',
      subscriptionId: null,
      workspaceId,
      transactionId: 'txn_null_custom',
      priceIds: [PASS_PRICE],
      priceCustomData: null,
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(fixture), fixture)).toEqual({
      kind: 'processed',
      effect: 'pass:granted',
    });
    expect(await db.select().from(entitlementGrants)).toHaveLength(1);
  });

  it('does not grant from price custom_data when the price id is not the Pass', async () => {
    const fixture = paddleTransactionCompleted({
      eventId: 'evt_custom_data_is_not_the_pass',
      subscriptionId: null,
      workspaceId,
      transactionId: 'txn_custom_data_only',
      priceIds: ['pri_not_in_catalog'],
      priceCustomData: { plan_code: 'pass_onetime', version: '2026-10' },
    });
    expect(await service.process('paddle', paddle.mapWebhookEvent(fixture), fixture)).toEqual({
      kind: 'unresolved',
      reason: 'unknown_price',
    });
    expect(await db.select().from(entitlementGrants)).toHaveLength(0);
  });

  it('leaves an unknown one-off price unprocessed', async () => {
    const fixture = completed('txn_unknown', 'pri_not_in_catalog');
    const event = paddle.mapWebhookEvent(fixture);
    expect(await service.process('paddle', event, fixture)).toEqual({
      kind: 'unresolved',
      reason: 'unknown_price',
    });
    expect(await db.select().from(entitlementGrants)).toHaveLength(0);
  });

  it('revokes a Pass on an approved refund and on a chargeback', async () => {
    const purchase = completed('txn_refund_me');
    await service.process('paddle', paddle.mapWebhookEvent(purchase), purchase);
    const pending = paddleAdjustmentCreated({
      eventId: 'evt_pending_refund',
      action: 'refund',
      subscriptionId: null,
      adjustmentType: 'full',
      status: 'pending_approval',
      transactionId: 'txn_refund_me',
    });
    expect(paddle.mapWebhookEvent(pending).kind).toBe('ignored');

    const refund = paddleAdjustmentUpdated({
      eventId: 'evt_approved_refund',
      status: 'approved',
      action: 'refund',
      subscriptionId: null,
      adjustmentType: 'full',
    });
    const refundBody = {
      ...refund,
      data: { ...(refund.data as Record<string, unknown>), transaction_id: 'txn_refund_me' },
    };
    expect(
      await service.process('paddle', paddle.mapWebhookEvent(refundBody), refundBody),
    ).toMatchObject({
      kind: 'processed',
      effect: 'pass_revoked:refund',
    });
    const [afterRefund] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(afterRefund!.tier).toBe('free');

    const again = completed('txn_chargeback_me');
    await service.process('paddle', paddle.mapWebhookEvent(again), again);
    const chargeback = paddleAdjustmentCreated({
      eventId: 'evt_chargeback',
      action: 'chargeback',
      subscriptionId: null,
      transactionId: 'txn_chargeback_me',
    });
    expect(
      await service.process('paddle', paddle.mapWebhookEvent(chargeback), chargeback),
    ).toMatchObject({ kind: 'processed', effect: 'pass_revoked:chargeback' });
  });
});
