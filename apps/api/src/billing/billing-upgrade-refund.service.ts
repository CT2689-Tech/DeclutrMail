import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { subscriptions, subscriptionEvents } from '@declutrmail/db';
import type { BillingCycle, PurchasableTier } from '@declutrmail/shared/contracts';
import { and, eq } from 'drizzle-orm';
import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { BillingCatalog } from './billing-catalog.js';
import { PaddleAdapter } from './paddle.adapter.js';
import {
  appendUpgradeRecord,
  hasUnresolvedUpgrade,
  intentEvidence,
  upgradeSnapshot,
  upgradeRecords,
  type UpgradeIntent,
} from './upgrade-intents.js';
import type {
  PaddleUpgradeState,
  PaddleRefundTransaction,
  RefundEvent,
  UpgradeRefundDecision,
  UpgradeRefundPolicy,
} from './upgrade-refund.types.js';
import { lockSubscription } from './subscription-lock.js';

type UpgradeSource = {
  id: string;
  workspaceId: string;
  providerSubscriptionId: string;
  providerPriceId: string;
  tier: string;
  billingCycle: BillingCycle;
  updatedAt: Date;
  currentPeriodEnd: Date | null;
};
const sameInstant = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);
const sameDiscount = (a: PaddleUpgradeState, b: UpgradeIntent['prior']) =>
  a.discountId === b.discountId && sameInstant(a.discountEndsAt, b.discountEndsAt);

/** A single exact target debit and optional original-plan credit. Reject
 * add-ons, mixed items, quantity changes, or different proration periods. */
export function matchesUpgradeCharge(
  transaction: PaddleRefundTransaction,
  intent: UpgradeIntent,
  target: UpgradeIntent['prior'],
  end: string,
): boolean {
  if (
    transaction.upgradeIntentId !== intent.intent_id ||
    transaction.upgradePriceId !== intent.to_price_id ||
    transaction.origin !== 'subscription_update' ||
    transaction.status !== 'completed' ||
    !transaction.positiveCharge ||
    !transaction.createdAt ||
    Date.parse(transaction.createdAt) < Date.parse(intent.requested_at) ||
    Date.parse(transaction.createdAt) > Date.parse(end) ||
    !transaction.lines ||
    transaction.lines.length < 1 ||
    transaction.lines.length > 2
  )
    return false;
  let debit = 0,
    credit = 0;
  for (const line of transaction.lines) {
    if (
      !/^\d+(\.\d+)?$/.test(line.rate) ||
      Number(line.rate) <= 0 ||
      Number(line.rate) > 1 ||
      Date.parse(line.periodStart) < Date.parse(intent.requested_at) ||
      Date.parse(line.periodStart) > Date.parse(end)
    )
      return false;
    if (
      line.priceId === intent.to_price_id &&
      line.quantity === 1 &&
      BigInt(line.total) > 0n &&
      sameInstant(line.periodEnd, target.periodEnd)
    )
      debit++;
    else if (
      line.priceId === intent.prior.priceId &&
      Math.abs(line.quantity) === 1 &&
      BigInt(line.total) < 0n &&
      sameInstant(line.periodEnd, intent.prior.periodEnd)
    )
      credit++;
    else return false;
  }
  return debit === 1 && credit <= 1;
}

@Injectable()
export class BillingUpgradeRefundService implements UpgradeRefundPolicy {
  private readonly logger = new Logger(BillingUpgradeRefundService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalog: BillingCatalog,
    private readonly paddle: PaddleAdapter,
  ) {}

  async assertNoPending(subscriptionId: string, db: DrizzleDb = this.db): Promise<void> {
    if (db === this.db && (await hasUnresolvedUpgrade(db, subscriptionId)))
      await this.observeCompletedTransaction(subscriptionId);
    if (await hasUnresolvedUpgrade(db, subscriptionId))
      throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
  }

  async mutation(
    subscriptionId: string,
    revision: Date,
    operation: 'pause' | 'resume' | 'uncancel',
    action: () => Promise<unknown>,
  ): Promise<void> {
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', subscriptionId);
      await this.assertNoPending(subscriptionId, tx);
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, 'paddle'),
            eq(subscriptions.providerSubscriptionId, subscriptionId),
          ),
        );
      if (
        !current ||
        current.updatedAt.getTime() !== revision.getTime() ||
        current.cancelSource !== null ||
        current.scheduledChangeState !== null ||
        (operation === 'uncancel'
          ? !current.cancelAtPeriodEnd || !['active', 'past_due'].includes(current.status)
          : current.cancelAtPeriodEnd ||
            (operation === 'resume'
              ? current.status !== 'paused'
              : !['active', 'past_due'].includes(current.status)))
      )
        throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
      await appendUpgradeRecord(tx, subscriptionId, 'local.upgrade_mutation_requested', id, {
        intent_id: id,
        operation,
      });
    });
    try {
      await action();
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.details?.providerOutcome === 'definitive' ||
          error.code === 'BILLING_NOT_PROVISIONED')
      )
        await appendUpgradeRecord(this.db, subscriptionId, 'local.upgrade_mutation_failed', id, {
          intent_id: id,
        });
      throw error;
    }
    await appendUpgradeRecord(this.db, subscriptionId, 'local.upgrade_mutation_completed', id, {
      intent_id: id,
    });
  }

  async upgrade(
    source: UpgradeSource,
    target: { priceId: string; tier: PurchasableTier; cycle: BillingCycle },
  ): Promise<void> {
    const prior = await this.paddle.readUpgradeState(source.providerSubscriptionId);
    const sourceCatalog = this.catalog.resolveByPriceId('paddle', source.providerPriceId);
    if (
      (source.tier !== 'plus' && source.tier !== 'pro') ||
      sourceCatalog?.tierId !== source.tier ||
      sourceCatalog.cycle !== source.billingCycle ||
      this.catalog.resolvePriceId('paddle', target.tier, target.cycle, false) !== target.priceId ||
      !prior ||
      prior.status !== 'active' ||
      prior.scheduledAction !== null ||
      prior.priceId !== source.providerPriceId ||
      !sameInstant(prior.periodEnd, source.currentPeriodEnd?.toISOString() ?? null) ||
      !sameInstant(prior.nextBilledAt, prior.periodEnd) ||
      Date.parse(prior.periodEnd) - Date.now() <= 30 * 60_000
    )
      throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
    const now = new Date();
    const intent: UpgradeIntent = {
      intent_id: randomUUID(),
      provider_subscription_id: source.providerSubscriptionId,
      requested_at: now.toISOString(),
      from_tier: source.tier,
      from_cycle: source.billingCycle,
      to_tier: target.tier,
      to_cycle: target.cycle,
      to_price_id: target.priceId,
      local_revision: source.updatedAt.toISOString(),
      prior: upgradeSnapshot(prior),
    };
    await this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', source.providerSubscriptionId);
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, source.id));
      if (
        !current ||
        current.workspaceId !== source.workspaceId ||
        current.updatedAt.getTime() !== source.updatedAt.getTime() ||
        current.status !== 'active' ||
        current.cancelAtPeriodEnd ||
        current.cancelSource !== null ||
        current.scheduledChangeState !== null ||
        (await hasUnresolvedUpgrade(tx, source.providerSubscriptionId))
      )
        throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
      await appendUpgradeRecord(
        tx,
        source.providerSubscriptionId,
        'local.upgrade_requested',
        intent.intent_id,
        intent,
      );
    });
    try {
      // No retry of a charged operation after an ambiguous response.
      await this.paddle.changePlan(source.providerSubscriptionId, target.priceId, {
        kind: 'immediate_prorated',
        upgradeIntent: { id: intent.intent_id, workspaceId: source.workspaceId },
      });
    } catch (error) {
      if (error instanceof AppException && error.details?.providerOutcome === 'definitive')
        await appendUpgradeRecord(
          this.db,
          source.providerSubscriptionId,
          'local.upgrade_failed',
          intent.intent_id,
          { intent_id: intent.intent_id },
        );
      throw error;
    }
    const confirmed = await this.paddle.readUpgradeState(source.providerSubscriptionId);
    if (
      !confirmed ||
      confirmed.priceId !== target.priceId ||
      confirmed.status !== 'active' ||
      !sameDiscount(confirmed, intent.prior)
    )
      throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
    // Freeze discovery during this successful operation, before any future
    // inherited custom-data transaction can be considered.
    await appendUpgradeRecord(
      this.db,
      source.providerSubscriptionId,
      'local.upgrade_attempt_closed',
      intent.intent_id,
      {
        intent_id: intent.intent_id,
        target: upgradeSnapshot(confirmed),
        window_closed_at: new Date().toISOString(),
      },
    );
    if (!(await this.confirmPendingUpgrade(source.providerSubscriptionId, intent.intent_id)))
      throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
  }

  /** Read-only provider recovery triggered after the operation or a verified
   * completed transaction. It never widens the original discovery window. */
  async confirmPendingUpgrade(subscriptionId: string, intentId: string): Promise<boolean> {
    const evidence = await intentEvidence(this.db, subscriptionId, intentId);
    if (!evidence?.target || !evidence.windowEnd || evidence.newerUpgrade) return false;
    if (evidence.transactionId) return true;
    const transaction = await this.paddle.discoverUpgradeTransaction(
      subscriptionId,
      intentId,
      evidence.intent.requested_at,
      evidence.windowEnd,
    );
    if (
      !transaction ||
      !matchesUpgradeCharge(transaction, evidence.intent, evidence.target, evidence.windowEnd)
    )
      return false;
    return this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', subscriptionId);
      const fresh = await intentEvidence(tx, subscriptionId, intentId);
      if (
        !fresh ||
        fresh.newerUpgrade ||
        (fresh.transactionId && fresh.transactionId !== transaction.id)
      )
        return false;
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, 'paddle'),
            eq(subscriptions.providerSubscriptionId, subscriptionId),
          ),
        );
      if (
        !current ||
        current.status !== 'active' ||
        current.cancelSource !== null ||
        current.cancelAtPeriodEnd ||
        current.scheduledChangeState !== null
      )
        return false;
      const inserted = await appendUpgradeRecord(
        tx,
        subscriptionId,
        'local.upgrade_transaction_bound',
        `transaction:${transaction.id}`,
        { intent_id: intentId, transaction_id: transaction.id },
      );
      if (!inserted) {
        const [owner] = await tx
          .select()
          .from(subscriptionEvents)
          .where(
            and(
              eq(subscriptionEvents.provider, 'paddle'),
              eq(
                subscriptionEvents.providerEventId,
                `local.upgrade_transaction_bound:transaction:${transaction.id}`,
              ),
            ),
          );
        if ((owner?.payload as Record<string, unknown> | undefined)?.intent_id !== intentId)
          return false;
      }
      await appendUpgradeRecord(tx, subscriptionId, 'local.upgrade_confirmed', intentId, {
        intent_id: intentId,
        target: fresh.target,
        transaction_id: transaction.id,
      });
      return true;
    });
  }

  async observeCompletedTransaction(subscriptionId: string): Promise<void> {
    const rows = await upgradeRecords(this.db, subscriptionId);
    for (const row of rows.filter((r) => r.eventType === 'local.upgrade_attempt_closed')) {
      const id = (row.payload as Record<string, unknown>).intent_id;
      if (typeof id === 'string') await this.confirmPendingUpgrade(subscriptionId, id);
    }
  }

  private async hold(
    event: RefundEvent,
    reason: string,
    intentId?: string,
  ): Promise<UpgradeRefundDecision> {
    const adjustment = event.refundReference?.adjustmentId ?? event.providerEventId;
    const completed = await this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', event.providerSubscriptionId);
      if (intentId && (await intentEvidence(tx, event.providerSubscriptionId, intentId))?.restored)
        return true;
      await appendUpgradeRecord(
        tx,
        event.providerSubscriptionId,
        'local.upgrade_refund_held',
        adjustment,
        { adjustment_id: adjustment, reason, ...(intentId ? { intent_id: intentId } : {}) },
      );
      return false;
    });
    if (completed) return { kind: 'inert', reason: 'already_restored' };
    this.logger.warn(
      `billing.upgrade_refund.review_required sub=${event.providerSubscriptionId} adjustment=${adjustment} reason=${reason}`,
    );
    return { kind: 'hold', reason };
  }

  async resolve(event: RefundEvent): Promise<UpgradeRefundDecision> {
    if (!event.refundReference) return this.hold(event, 'missing_transaction_reference');
    const [adjustment, transaction] = await Promise.all([
      this.paddle.readRefundAdjustment(event.refundReference, event.providerSubscriptionId),
      this.paddle.readRefundTransaction(event.refundReference.transactionId),
    ]);
    if (!adjustment || !transaction || transaction.subscriptionId !== event.providerSubscriptionId)
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    if (!transaction.positiveCharge || transaction.status !== 'completed')
      return { kind: 'inert', reason: 'unpaid_transaction' };
    if (['web', 'api', 'subscription_recurring'].includes(transaction.origin))
      return { kind: 'ordinary' };
    if (transaction.origin !== 'subscription_update')
      return this.hold(event, 'unknown_transaction_origin');
    if (adjustment.full === null)
      return this.hold(event, 'unknown_refund_coverage', transaction.upgradeIntentId ?? undefined);
    if (!adjustment.full) return { kind: 'inert', reason: 'partial_refund' };
    // Upgrade requests and rejections never revoke the paid base plan.
    if (adjustment.status !== 'approved') return { kind: 'inert', reason: adjustment.status };
    if (
      !transaction.upgradeIntentId ||
      !transaction.upgradePriceId ||
      !transaction.positiveCharge ||
      transaction.status !== 'completed'
    )
      return this.hold(event, 'uncorrelated_upgrade_transaction');
    const evidence = await intentEvidence(
      this.db,
      event.providerSubscriptionId,
      transaction.upgradeIntentId,
    );
    if (
      !evidence ||
      !evidence.target ||
      !evidence.windowEnd ||
      evidence.intent.to_price_id !== transaction.upgradePriceId
    )
      return this.hold(event, 'missing_prior_plan_evidence', transaction.upgradeIntentId);
    const { intent, target } = evidence;
    if (
      evidence.transactionId !== transaction.id ||
      !matchesUpgradeCharge(transaction, intent, target, evidence.windowEnd)
    )
      return this.hold(event, 'transaction_not_bound');
    if (evidence.restored) return { kind: 'inert', reason: 'already_restored' };
    if (evidence.newerUpgrade) return this.hold(event, 'later_plan_change', intent.intent_id);
    if (Date.parse(intent.prior.periodEnd) - Date.now() <= 30 * 60_000)
      return this.hold(event, 'prior_period_ended_or_near_renewal', intent.intent_id);
    const [local] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, 'paddle'),
          eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
        ),
      );
    if (
      !local ||
      local.provider !== 'paddle' ||
      local.status !== 'active' ||
      local.cancelSource !== null ||
      local.cancelAtPeriodEnd ||
      local.scheduledChangeState !== null
    )
      return this.hold(event, 'local_stop_or_plan_change', intent.intent_id);
    const current = await this.paddle.readUpgradeState(event.providerSubscriptionId);
    if (
      !current ||
      current.status !== 'active' ||
      current.scheduledAction !== null ||
      !sameDiscount(current, intent.prior)
    )
      return this.hold(event, 'provider_stop_or_discount_change', intent.intent_id);
    const alreadyRestored =
      current.priceId === intent.prior.priceId &&
      sameInstant(current.periodEnd, intent.prior.periodEnd) &&
      sameInstant(current.nextBilledAt, intent.prior.nextBilledAt);
    const targetUnchanged =
      current.priceId === target.priceId &&
      sameInstant(current.periodStart, target.periodStart) &&
      sameInstant(current.periodEnd, target.periodEnd) &&
      sameInstant(current.nextBilledAt, target.nextBilledAt);
    if (
      !targetUnchanged &&
      !(evidence.restoring && (alreadyRestored || current.priceId === intent.prior.priceId))
    )
      return this.hold(event, 'intervening_renewal_or_change', intent.intent_id);
    const facts = await this.paddle.providerCancellationFacts(event.providerSubscriptionId);
    if (!facts || facts.settled !== null)
      return this.hold(event, 'other_refund_or_chargeback', intent.intent_id);
    // Safe delivery may ship before cutover. Automatic financial writes remain
    // disabled until sandbox rehearsal and explicit live cutover approval.
    if (process.env.BILLING_UPGRADE_REFUND_RESTORE_ENABLED !== 'true')
      return this.hold(event, 'awaiting_verified_cutover', intent.intent_id);
    const claimed = await this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', event.providerSubscriptionId);
      const latest = await intentEvidence(tx, event.providerSubscriptionId, intent.intent_id);
      if (latest?.restored) return false;
      if (latest?.restoring) return false;
      const [fresh] = await tx.select().from(subscriptions).where(eq(subscriptions.id, local.id));
      if (
        !fresh ||
        fresh.updatedAt.getTime() !== local.updatedAt.getTime() ||
        fresh.status !== 'active' ||
        fresh.cancelAtPeriodEnd ||
        fresh.cancelSource !== null ||
        fresh.scheduledChangeState !== null
      )
        throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
      return appendUpgradeRecord(
        tx,
        event.providerSubscriptionId,
        'local.upgrade_restore_started',
        intent.intent_id,
        {
          intent_id: intent.intent_id,
          adjustment_id: event.refundReference!.adjustmentId,
          transaction_id: event.refundReference!.transactionId,
        },
      );
    });
    // A concurrent caller never owns a second outbound write. Recovery is
    // allowed only when the provider already positively confirms restoration.
    if (!claimed && !alreadyRestored) throw new AppException({ code: 'PLAN_CHANGE_PENDING' });
    if (!alreadyRestored) {
      // Automatic restoration uses one item update only when preview proves
      // the original renewal is retained. Cross-cycle date repairs require
      // support until their separate financial write path is rehearsed.
      const preview = await this.paddle.restoreUpgradeStage(
        event.providerSubscriptionId,
        { priceId: intent.prior.priceId },
        true,
      );
      if (!preview.noBill || !sameInstant(preview.nextBilledAt, intent.prior.nextBilledAt))
        return this.hold(event, 'original_renewal_requires_support', intent.intent_id);
      const beforeWrite = await this.paddle.readUpgradeState(event.providerSubscriptionId);
      if (
        !beforeWrite ||
        beforeWrite.updatedAt !== current.updatedAt ||
        beforeWrite.status !== 'active' ||
        beforeWrite.scheduledAction !== null
      )
        return this.hold(event, 'provider_changed_before_restore', intent.intent_id);
      const [beforeLocal] = await this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, local.id));
      const beforeFacts = await this.paddle.providerCancellationFacts(event.providerSubscriptionId);
      if (
        !beforeLocal ||
        beforeLocal.updatedAt.getTime() !== local.updatedAt.getTime() ||
        beforeLocal.status !== 'active' ||
        beforeLocal.cancelSource !== null ||
        beforeLocal.cancelAtPeriodEnd ||
        beforeLocal.scheduledChangeState !== null ||
        !beforeFacts ||
        beforeFacts.settled !== null
      )
        return this.hold(event, 'stop_changed_before_restore', intent.intent_id);
      await this.paddle.restoreUpgradeStage(
        event.providerSubscriptionId,
        { priceId: intent.prior.priceId },
        false,
      );
    }
    const restored = await this.paddle.readUpgradeState(event.providerSubscriptionId);
    if (
      !restored ||
      restored.status !== 'active' ||
      restored.scheduledAction !== null ||
      restored.priceId !== intent.prior.priceId ||
      !sameInstant(restored.nextBilledAt, intent.prior.nextBilledAt) ||
      !sameInstant(restored.periodEnd, intent.prior.periodEnd) ||
      !sameDiscount(restored, intent.prior)
    )
      return this.hold(event, 'restoration_unconfirmed', intent.intent_id);
    // The canonical projector owns entitlement; completion is recorded only
    // after it confirms the prior plan under its subscription lock.
    return {
      kind: 'restored',
      subscription: restored.normalized,
      confirmedAt: restored.updatedAt,
      adjustmentId: event.refundReference.adjustmentId,
      intentId: intent.intent_id,
    };
  }

  /** A provider webhook may have already projected the prior plan with a
   * later event timestamp. Positively verify the canonical state and record
   * completion instead of treating an ignored/duplicate synthetic row as proof. */
  async confirmProjectedRestoration(
    decision: Extract<UpgradeRefundDecision, { kind: 'restored' }>,
  ): Promise<boolean> {
    const id = decision.subscription.providerSubscriptionId;
    return this.db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', id);
      const evidence = await intentEvidence(tx, id, decision.intentId);
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(eq(subscriptions.provider, 'paddle'), eq(subscriptions.providerSubscriptionId, id)),
        );
      if (
        !evidence ||
        !evidence.restoring ||
        evidence.newerUpgrade ||
        !current ||
        current.status !== 'active' ||
        current.cancelSource !== null ||
        current.cancelAtPeriodEnd ||
        current.scheduledChangeState !== null ||
        current.providerPriceId !== evidence.intent.prior.priceId ||
        current.tier !== evidence.intent.from_tier ||
        current.billingCycle !== evidence.intent.from_cycle ||
        !sameInstant(
          current.currentPeriodEnd?.toISOString() ?? null,
          evidence.intent.prior.periodEnd,
        )
      )
        return false;
      await appendUpgradeRecord(tx, id, 'local.upgrade_restore_completed', decision.intentId, {
        intent_id: decision.intentId,
        adjustment_id: decision.adjustmentId,
      });
      return true;
    });
  }
}
