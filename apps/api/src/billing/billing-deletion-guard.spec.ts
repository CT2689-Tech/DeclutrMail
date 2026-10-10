import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import {
  billingCustomers,
  pendingCheckouts,
  subscriptionEvents,
  subscriptions,
  users,
  workspaces,
} from '@declutrmail/db';
import { eq } from 'drizzle-orm';
import { BillingDeletionGuard } from './billing-deletion-guard.js';

let db: Awaited<ReturnType<typeof freshTestDb>>;
let userId: string;
let workspaceId: string;
let read: ReturnType<typeof vi.fn>;
let guard: BillingDeletionGuard;
async function subscription(provider: 'paddle' | 'razorpay' = 'paddle') {
  await db.insert(subscriptions).values({
    workspaceId,
    provider,
    providerSubscriptionId: 'sub_old',
    providerPriceId: 'pri_plus',
    tier: 'plus',
    billingCycle: 'monthly',
    status: 'canceled',
    cancelSource: 'refund',
  });
}
async function attempt(provider: 'paddle' | 'razorpay' = 'paddle') {
  await db.insert(subscriptionEvents).values({
    provider,
    providerEventId: 'attempt_1',
    eventType: 'local.checkout_attempted',
    payload: { workspaceId },
    processedAt: new Date(),
  });
}
beforeEach(async () => {
  db = await freshTestDb();
  const [ws] = await db.insert(workspaces).values({ name: 'Deletion safety test' }).returning();
  workspaceId = ws!.id;
  const [user] = await db
    .insert(users)
    .values({ workspaceId, email: 'billing-delete@example.test' })
    .returning();
  userId = user!.id;
  read = vi.fn().mockResolvedValue('stopped');
  guard = new BillingDeletionGuard(
    db as never,
    { deletionBillingState: read } as never,
    { deletionBillingState: read } as never,
  );
});
describe('provider-confirmed deletion safety', () => {
  it('allows a never-billed Free or complimentary workspace without provider calls', async () => {
    await db.update(workspaces).set({ tier: 'pro' }).where(eq(workspaces.id, workspaceId));
    await expect(guard.assertStopped(userId)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['billable', 'unknown', 'error'])(
    'blocks locally canceled refund rows when provider is %s',
    async (state) => {
      await subscription();
      if (state === 'error') read.mockRejectedValue(new Error('unavailable'));
      else read.mockResolvedValue(state);
      await expect(guard.assertStopped(userId)).rejects.toMatchObject({
        code: state === 'billable' ? 'DELETION_BILLING_BLOCKED' : 'DELETION_BILLING_UNVERIFIED',
      });
    },
  );
  it('reads every old subscription, not just the latest', async () => {
    await subscription();
    await db.insert(subscriptions).values({
      workspaceId,
      provider: 'razorpay',
      providerSubscriptionId: 'sub_new',
      providerPriceId: 'plan_plus',
      tier: 'plus',
      billingCycle: 'monthly',
      status: 'canceled',
    });
    await guard.assertStopped(userId);
    expect(read.mock.calls.map(([ref]) => ref).sort()).toEqual(['sub_new', 'sub_old']);
  });
  it('does not treat a paid webhook or removal of a claim as resolving an unknown overlay', async () => {
    await attempt();
    await subscription();
    await expect(guard.assertStopped(userId)).rejects.toMatchObject({
      code: 'DELETION_BILLING_UNVERIFIED',
    });
  });
  it('can verify a retained Razorpay artifact after the claim was released', async () => {
    await attempt('razorpay');
    await db.insert(subscriptionEvents).values({
      provider: 'razorpay',
      providerEventId: 'artifact_1',
      eventType: 'local.checkout_artifact',
      payload: { workspaceId, attemptId: 'attempt_1', providerRef: 'sub_orphan' },
      processedAt: new Date(),
    });
    await guard.assertStopped(userId);
    expect(read).toHaveBeenCalledWith('sub_orphan');
    read.mockResolvedValue('billable');
    await expect(guard.assertStopped(userId)).rejects.toMatchObject({
      code: 'DELETION_BILLING_BLOCKED',
    });
  });
  it.each(['workspace', 'customer'])(
    'blocks a recorded but unapplied provider subscription attributed by %s',
    async (attribution) => {
      if (attribution === 'customer')
        await db.insert(billingCustomers).values({
          workspaceId,
          provider: 'paddle',
          providerCustomerId: 'ctm_known',
          region: 'international',
        });
      await db.insert(subscriptionEvents).values({
        provider: 'paddle',
        providerEventId: 'evt_unapplied',
        eventType: 'subscription.activated',
        payload: {
          kind: 'subscription',
          provider_subscription_id: 'sub_unapplied',
          workspace_id: attribution === 'workspace' ? workspaceId : null,
          provider_customer_id: 'ctm_known',
        },
      });
      read.mockResolvedValue('billable');
      await expect(guard.assertStopped(userId)).rejects.toMatchObject({
        code: 'DELETION_BILLING_BLOCKED',
      });
      expect(read).toHaveBeenCalledWith('sub_unapplied');
    },
  );

  it('support resolution cannot hide a known artifact or a later reviewed reference', async () => {
    await attempt('razorpay');
    await db.insert(subscriptionEvents).values([
      {
        provider: 'razorpay',
        providerEventId: 'artifact_1',
        eventType: 'local.checkout_artifact',
        payload: { workspaceId, attemptId: 'attempt_1', providerRef: 'sub_known' },
        processedAt: new Date(),
      },
      {
        provider: 'razorpay',
        providerEventId: 'resolution_1',
        eventType: 'local.checkout_attempt_resolved',
        payload: {
          workspaceId,
          attemptId: 'attempt_1',
          resolution: 'provider-reviewed',
          operatorId: 'staff-1',
          evidenceReference: 'CASE-1',
          providerRefs: [],
        },
        processedAt: new Date(),
      },
      {
        provider: 'razorpay',
        providerEventId: 'resolution_2',
        eventType: 'local.checkout_attempt_resolved',
        payload: {
          workspaceId,
          attemptId: 'attempt_1',
          resolution: 'provider-reviewed',
          operatorId: 'staff-1',
          evidenceReference: 'CASE-2',
          providerRefs: ['sub_later'],
        },
        processedAt: new Date(),
      },
    ]);
    await guard.assertStopped(userId);
    expect(read).toHaveBeenCalledWith('sub_known');
    expect(read).toHaveBeenCalledWith('sub_later');
    read.mockResolvedValue('billable');
    await expect(guard.assertStopped(userId)).rejects.toMatchObject({
      code: 'DELETION_BILLING_BLOCKED',
    });
  });

  it('rejects evidence changed while provider HTTP was outside the transaction', async () => {
    await subscription();
    read.mockImplementation(async () => {
      await db.insert(pendingCheckouts).values({
        workspaceId,
        provider: 'paddle',
        tier: 'plus',
        billingCycle: 'monthly',
        expiresAt: new Date(),
      });
      return 'stopped';
    });
    const destructive = vi.fn();
    await expect(guard.withVerifiedStopped(userId, destructive)).rejects.toMatchObject({
      code: 'DELETION_BILLING_UNVERIFIED',
    });
    expect(destructive).not.toHaveBeenCalled();
  });
});
