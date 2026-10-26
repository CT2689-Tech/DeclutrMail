import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  billingCheckoutAttempts,
  entitlementGrants,
  pendingCheckouts,
  subscriptions,
  workspaces,
  type BillingCheckoutAttemptRow,
} from '@declutrmail/db';
import type { CheckoutAttempt } from '@declutrmail/shared/contracts';
import { AppException } from '../common/app-exception.js';
import type { DrizzleDb } from '../db/db.module.js';
import type { PaddleAdapter } from './paddle.adapter.js';
import type { BillingWebhookService } from './billing-webhook.service.js';
import type { NormalizedBillingEvent } from './billing-provider.interface.js';

export const durableCheckoutEnabled = () =>
  process.env.BILLING_CHECKOUT_ATTEMPTS_ENABLED === 'true';
export const checkoutCancellationEnabled = () =>
  process.env.BILLING_CHECKOUT_CANCEL_ENABLED === 'true';
const unresolved = ['creating', 'open', 'payment_in_progress', 'stopping', 'paid', 'unknown'];

export async function lockCheckoutWorkspace(db: Pick<DrizzleDb, 'select'>, workspaceId: string) {
  await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
}
export async function findCheckoutAttempt(
  db: Pick<DrizzleDb, 'select'>,
  workspaceId: string,
  id?: string,
) {
  const [row] = await db
    .select()
    .from(billingCheckoutAttempts)
    .where(
      and(
        eq(billingCheckoutAttempts.workspaceId, workspaceId),
        id
          ? eq(billingCheckoutAttempts.id, id)
          : inArray(billingCheckoutAttempts.state, unresolved),
      ),
    )
    .orderBy(desc(billingCheckoutAttempts.createdAt))
    .limit(1);
  return row ?? null;
}
export function checkoutAttemptView(row: BillingCheckoutAttemptRow): CheckoutAttempt {
  return {
    id: row.id,
    version: row.version,
    state: row.state as CheckoutAttempt['state'],
    tier: row.tier as CheckoutAttempt['tier'],
    cycle: row.cycle as CheckoutAttempt['cycle'],
    offer: row.offer === 'pass_onetime' ? row.offer : null,
    createdAt: row.createdAt.toISOString(),
    canResume: row.state === 'open' && row.providerTransactionId !== null && row.paidAt === null,
    canCancel:
      checkoutCancellationEnabled() &&
      (row.state === 'open' || row.state === 'stopping') &&
      row.paidAt === null,
  };
}

/** Only server-verified transaction identity can record a new purchase. */
export async function recordCheckoutPayment(
  db: DrizzleDb,
  event: Extract<NormalizedBillingEvent, { kind: 'payment' }>,
): Promise<boolean> {
  if (!event.checkoutAttemptId) return true; // Separate, retained legacy path.
  if (!event.workspaceId || !event.providerTransactionId) return false;
  return db.transaction(async (tx) => {
    await lockCheckoutWorkspace(tx, event.workspaceId!);
    const row = await findCheckoutAttempt(tx, event.workspaceId!, event.checkoutAttemptId!);
    // Recurring transactions may inherit the original signed custom_data.
    // They belong to an established subscription, never to a second purchase
    // on the original attempt. Keep that attempt's exact binding unchanged.
    if (
      row?.state === 'fulfilled' &&
      row.offer === null &&
      row.providerTransactionId !== event.providerTransactionId &&
      row.providerSubscriptionId &&
      row.providerSubscriptionId === event.providerSubscriptionId
    ) {
      const [known] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, 'paddle'),
            eq(subscriptions.providerSubscriptionId, row.providerSubscriptionId),
            eq(subscriptions.workspaceId, event.workspaceId!),
          ),
        )
        .limit(1);
      return !!known;
    }
    if (
      !row ||
      row.provider !== 'paddle' ||
      row.currencyCode !== event.checkoutCurrencyCode ||
      event.checkoutItemsValid !== true ||
      event.checkoutPriceIds?.length !== 1 ||
      event.checkoutPriceIds[0] !== row.providerPriceId ||
      (row.providerTransactionId !== null &&
        row.providerTransactionId !== event.providerTransactionId)
    )
      return false;
    if (
      row.providerSubscriptionId &&
      event.providerSubscriptionId &&
      row.providerSubscriptionId !== event.providerSubscriptionId
    )
      return false;
    const subscriptionId = event.providerSubscriptionId ?? row.providerSubscriptionId;
    if ((row.offer === null && !subscriptionId) || (row.offer === 'pass_onetime' && subscriptionId))
      return false;
    if (row.state === 'fulfilled') return true;
    // A late payment on an older purchase disarms any newer unpaid checkout.
    await tx
      .update(billingCheckoutAttempts)
      .set({
        state: 'unknown',
        updatedAt: new Date(),
        version: sql`${billingCheckoutAttempts.version} + 1`,
      })
      .where(
        and(
          eq(billingCheckoutAttempts.workspaceId, event.workspaceId!),
          sql`${billingCheckoutAttempts.id} <> ${row.id}::uuid`,
          inArray(billingCheckoutAttempts.state, ['creating', 'open', 'payment_in_progress']),
          isNull(billingCheckoutAttempts.paidAt),
        ),
      );
    await tx
      .update(billingCheckoutAttempts)
      .set({
        providerTransactionId: event.providerTransactionId,
        providerSubscriptionId: subscriptionId,
        state: 'paid',
        paidAt: row.paidAt ?? new Date(),
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(
        and(
          eq(billingCheckoutAttempts.id, row.id),
          eq(billingCheckoutAttempts.version, row.version),
        ),
      );
    return true;
  });
}

/** Confirm this purchase's own artifact, independently of the highest entitlement. */
export async function fulfillCheckoutAttempt(
  db: DrizzleDb,
  workspaceId: string,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockCheckoutWorkspace(tx, workspaceId);
    const row = await findCheckoutAttempt(tx, workspaceId, id);
    if (!row || !row.paidAt || row.state === 'fulfilled' || row.state === 'stopped') return;
    let fulfilled = false;
    if (row.offer === 'pass_onetime') {
      const [grant] = await tx
        .select({ id: entitlementGrants.id })
        .from(entitlementGrants)
        .where(
          and(
            eq(entitlementGrants.provider, 'paddle'),
            eq(entitlementGrants.providerTransactionId, row.providerTransactionId!),
            eq(entitlementGrants.source, 'pass'),
          ),
        )
        .limit(1);
      fulfilled = !!grant;
    } else if (row.providerSubscriptionId) {
      const [sub] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.workspaceId, workspaceId),
            eq(subscriptions.provider, 'paddle'),
            eq(subscriptions.providerSubscriptionId, row.providerSubscriptionId),
            eq(subscriptions.providerPriceId, row.providerPriceId),
            inArray(subscriptions.status, ['active', 'past_due']),
            or(
              isNull(subscriptions.entitlementEndsAt),
              sql`${subscriptions.entitlementEndsAt} > now()`,
            ),
          ),
        )
        .limit(1);
      fulfilled = !!sub;
    }
    if (!fulfilled) return;
    await tx
      .update(billingCheckoutAttempts)
      .set({
        state: 'fulfilled',
        fulfilledAt: new Date(),
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(
        and(
          eq(billingCheckoutAttempts.id, row.id),
          eq(billingCheckoutAttempts.version, row.version),
        ),
      );
  });
}

/** Provider I/O precedes locked, versioned state changes and the canonical projector. */
export async function reconcileCheckoutAttempt(
  db: DrizzleDb,
  paddle: PaddleAdapter,
  webhook: BillingWebhookService,
  workspaceId: string,
  id: string,
): Promise<CheckoutAttempt> {
  let row = await findCheckoutAttempt(db, workspaceId, id);
  if (!row) throw new AppException({ code: 'NOT_FOUND' });
  if (row.state === 'fulfilled') return checkoutAttemptView(row);
  const checkClaim = await db
    .update(billingCheckoutAttempts)
    .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(billingCheckoutAttempts.id, id),
        eq(billingCheckoutAttempts.workspaceId, workspaceId),
        or(
          isNull(billingCheckoutAttempts.lastCheckedAt),
          sql`${billingCheckoutAttempts.lastCheckedAt} < now() - interval '10 seconds'`,
        ),
      ),
    )
    .returning();
  if (!checkClaim.length)
    return checkoutAttemptView((await findCheckoutAttempt(db, workspaceId, id))!);
  if (!row.providerTransactionId) {
    const recovered = await paddle.recoverCheckoutAttempt(row);
    if (!recovered) return checkoutAttemptView(row);
    await db
      .update(billingCheckoutAttempts)
      .set({ providerTransactionId: recovered, updatedAt: new Date(), version: row.version + 1 })
      .where(
        and(
          eq(billingCheckoutAttempts.id, row.id),
          eq(billingCheckoutAttempts.version, row.version),
          isNull(billingCheckoutAttempts.providerTransactionId),
        ),
      );
    row = (await findCheckoutAttempt(db, workspaceId, id))!;
  }
  const facts = row.providerTransactionId
    ? await paddle.readCheckoutAttempt(row.providerTransactionId, row)
    : null;
  if (!facts) {
    if (!row.paidAt && row.state !== 'stopped' && row.state !== 'stopping')
      await db
        .update(billingCheckoutAttempts)
        .set({ state: 'unknown', version: row.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(billingCheckoutAttempts.id, id),
            eq(billingCheckoutAttempts.version, row.version),
            isNull(billingCheckoutAttempts.paidAt),
          ),
        );
    return checkoutAttemptView((await findCheckoutAttempt(db, workspaceId, id))!);
  }
  if (facts.state === 'completed') {
    const event: Extract<NormalizedBillingEvent, { kind: 'payment' }> = {
      kind: 'payment',
      eventType: 'reconciliation.checkout_completed',
      providerEventId: `recon:checkout:${facts.transactionId}:completed`,
      outcome: 'succeeded',
      workspaceId,
      checkoutAttemptId: id,
      providerTransactionId: facts.transactionId,
      providerSubscriptionId: facts.subscriptionId,
      providerCustomerId: facts.customerId,
      checkoutPriceIds: [row.providerPriceId],
      checkoutCurrencyCode: row.currencyCode,
      checkoutItemsValid: true,
      ...(row.offer === 'pass_onetime' ? { oneTimePriceIds: [row.providerPriceId] } : {}),
    };
    const projected = await webhook.process('paddle', event, {});
    if (projected.kind === 'unresolved')
      return checkoutAttemptView((await findCheckoutAttempt(db, workspaceId, id))!);
    if (facts.subscriptionId && row.offer === null) {
      const result = await paddle.fetchSubscription(facts.subscriptionId);
      if (
        result.kind === 'found' &&
        (!result.subscription.workspaceId || result.subscription.workspaceId === workspaceId) &&
        result.subscription.providerPriceId === row.providerPriceId
      ) {
        await webhook.process(
          'paddle',
          {
            kind: 'subscription',
            eventType: 'reconciliation.checkout_subscription',
            providerEventId: `recon:checkout:${facts.transactionId}:subscription:${result.subscription.status}`,
            subscription: { ...result.subscription, workspaceId },
          },
          { occurred_at: new Date().toISOString() },
        );
      }
    }
    await fulfillCheckoutAttempt(db, workspaceId, id);
  } else {
    await db.transaction(async (tx) => {
      await lockCheckoutWorkspace(tx, workspaceId);
      const current = await findCheckoutAttempt(tx, workspaceId, id);
      if (
        !current ||
        current.version !== row!.version ||
        current.paidAt ||
        current.state === 'fulfilled' ||
        current.state === 'stopped'
      )
        return;
      const next =
        facts.state === 'stopped'
          ? 'stopped'
          : facts.state === 'paid'
            ? 'paid'
            : facts.state === 'in_flight'
              ? 'payment_in_progress'
              : 'open';
      if (next === current.state || (current.state === 'stopping' && next === 'open')) return;
      await tx
        .update(billingCheckoutAttempts)
        .set({
          state: next,
          updatedAt: new Date(),
          version: current.version + 1,
          ...(facts.state === 'paid'
            ? { paidAt: new Date(), providerSubscriptionId: facts.subscriptionId }
            : {}),
          ...(facts.state === 'stopped' ? { stoppedAt: new Date() } : {}),
        })
        .where(
          and(
            eq(billingCheckoutAttempts.id, id),
            eq(billingCheckoutAttempts.version, current.version),
          ),
        );
    });
  }
  return checkoutAttemptView((await findCheckoutAttempt(db, workspaceId, id))!);
}

/** Legacy slots remain support-visible; an expired local deadline is not provider revocation. */
export async function assertNoLegacyCheckout(db: Pick<DrizzleDb, 'select'>, workspaceId: string) {
  const [claim] = await db
    .select({ workspaceId: pendingCheckouts.workspaceId })
    .from(pendingCheckouts)
    .where(eq(pendingCheckouts.workspaceId, workspaceId))
    .limit(1);
  if (claim) throw new AppException({ code: 'CHECKOUT_IN_FLIGHT' });
}
