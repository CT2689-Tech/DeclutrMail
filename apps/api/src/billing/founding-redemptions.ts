import { subscriptionEvents, subscriptions } from '@declutrmail/db';
import type { BillingProviderId } from '@declutrmail/shared/contracts';
import { and, eq, sql } from 'drizzle-orm';

import type { DrizzleDb } from '../db/db.module.js';

/** October 10 policy: an allocated paid Founding seat is never returned.
 * The append-only billing stream has no cascading workspace/user foreign key.
 * Store only provider subscription identity, without customer/account data.
 */
export const FOUNDING_REDEEMED = 'local.founding_redeemed';
export const FOUNDING_LOCK_KEY = 117_126;
type BillingStore = Pick<DrizzleDb, 'select' | 'insert' | 'execute'>;

const redemptionId = (id: string) => `local:founding-redeemed:${id}`;

export async function recordFoundingRedemption(
  tx: BillingStore,
  provider: BillingProviderId,
  providerSubscriptionId: string,
): Promise<void> {
  await tx
    .insert(subscriptionEvents)
    .values({
      provider,
      providerEventId: redemptionId(providerSubscriptionId),
      eventType: FOUNDING_REDEEMED,
      payload: { provider_subscription_id: providerSubscriptionId },
      processedAt: new Date(),
    })
    .onConflictDoNothing();
}

/** Include surviving legacy allocations until every one has been preserved.
 * Union by provider/subscription, so a legacy row and its ledger entry count once.
 */
export async function foundingRedemptionCount(db: BillingStore): Promise<number> {
  // One statement/snapshot: concurrent legacy preservation + deletion must
  // not fall between a ledger read and a subscription read and hide a seat.
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(sql`(
    SELECT ${subscriptionEvents.provider} AS provider,
           ${subscriptionEvents.providerEventId} AS identity
      FROM ${subscriptionEvents} WHERE ${subscriptionEvents.eventType} = ${FOUNDING_REDEEMED}
    UNION
    SELECT ${subscriptions.provider}, 'local:founding-redeemed:' || ${subscriptions.providerSubscriptionId}
      FROM ${subscriptions} WHERE ${subscriptions.foundingMember} = true
  ) AS redemptions`);
  return row?.count ?? 0;
}

export async function preserveWorkspaceFoundingRedemptions(
  tx: BillingStore,
  workspaceId: string,
): Promise<void> {
  const rows = await tx
    .select({ provider: subscriptions.provider, id: subscriptions.providerSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.foundingMember, true)));
  for (const row of rows) await recordFoundingRedemption(tx, row.provider, row.id);
}

/** Must run in the subscription write transaction. Replays keep their seat;
 * new identities serialize under the same global lock as the original cap.
 */
export async function claimFoundingRedemption(
  tx: BillingStore,
  provider: BillingProviderId,
  providerSubscriptionId: string,
  maximum: number,
  canAllocate = true,
): Promise<boolean> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`);
  const [durable] = await tx
    .select({ id: subscriptionEvents.id })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.provider, provider),
        eq(subscriptionEvents.providerEventId, redemptionId(providerSubscriptionId)),
      ),
    )
    .limit(1);
  const [legacy] = await tx
    .select({ founding: subscriptions.foundingMember })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.provider, provider),
        eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
      ),
    )
    .limit(1);
  if (durable || legacy?.founding) {
    await recordFoundingRedemption(tx, provider, providerSubscriptionId);
    return true;
  }
  if (!canAllocate || (await foundingRedemptionCount(tx)) >= maximum) return false;
  await recordFoundingRedemption(tx, provider, providerSubscriptionId);
  return true;
}
