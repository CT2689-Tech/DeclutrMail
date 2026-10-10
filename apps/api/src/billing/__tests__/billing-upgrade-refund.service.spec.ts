import { randomUUID } from 'node:crypto';
import { subscriptions, subscriptionEvents, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { DrizzleDb } from '../../db/db.module.js';
import { BillingCatalog } from '../billing-catalog.js';
import {
  BillingUpgradeRefundService,
  matchesUpgradeCharge,
} from '../billing-upgrade-refund.service.js';
import { BillingWebhookService } from '../billing-webhook.service.js';
import {
  appendUpgradeRecord,
  hasUnresolvedUpgrade,
  upgradeSnapshot,
  type UpgradeIntent,
} from '../upgrade-intents.js';
import type {
  PaddleRefundTransaction,
  PaddleUpgradeState,
  RefundEvent,
} from '../upgrade-refund.types.js';

const now = '2026-10-10T12:00:00.000Z';
const requested = '2026-10-10T11:59:58.000Z';
const closed = '2026-10-10T11:59:59.000Z';
const end = '2026-11-09T12:00:00.000Z';
const catalog = new BillingCatalog([
  {
    planCode: 'plus_monthly',
    tierId: 'plus',
    cycle: 'monthly',
    founding: false,
    usdCents: 900,
    paddlePriceId: 'pri_base',
    razorpayPlanId: null,
  },
  {
    planCode: 'pro_monthly',
    tierId: 'pro',
    cycle: 'monthly',
    founding: false,
    usdCents: 1900,
    paddlePriceId: 'pri_target',
    razorpayPlanId: null,
  },
]);
let db: DrizzleDb, policy: BillingUpgradeRefundService, projector: BillingWebhookService;
let workspaceId: string,
  intent: UpgradeIntent,
  transaction: PaddleRefundTransaction,
  prior: PaddleUpgradeState,
  state: PaddleUpgradeState;
let paddle: {
  readRefundAdjustment: ReturnType<typeof vi.fn>;
  readRefundTransaction: ReturnType<typeof vi.fn>;
  readUpgradeState: ReturnType<typeof vi.fn>;
  providerCancellationFacts: ReturnType<typeof vi.fn>;
  restoreUpgradeStage: ReturnType<typeof vi.fn>;
  discoverUpgradeTransaction: ReturnType<typeof vi.fn>;
  changePlan: ReturnType<typeof vi.fn>;
};
const event = (id = 'adj_refund'): RefundEvent => ({
  kind: 'refund_settled',
  providerEventId: `evt_${id}`,
  eventType: 'adjustment.updated',
  providerSubscriptionId: 'sub_upgrade',
  refundReference: { adjustmentId: id, transactionId: 'txn_upgrade' },
});
async function seedEvidence(bind = true) {
  await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_requested', intent.intent_id, intent);
  await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_attempt_closed', intent.intent_id, {
    intent_id: intent.intent_id,
    target: upgradeSnapshot(state),
    window_closed_at: closed,
  });
  if (bind) {
    await appendUpgradeRecord(
      db,
      'sub_upgrade',
      'local.upgrade_transaction_bound',
      'transaction:txn_upgrade',
      { intent_id: intent.intent_id, transaction_id: 'txn_upgrade' },
    );
    await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_confirmed', intent.intent_id, {
      intent_id: intent.intent_id,
      target: upgradeSnapshot(state),
    });
  }
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  process.env.BILLING_UPGRADE_REFUND_RESTORE_ENABLED = 'true';
  db = (await freshTestDb()) as unknown as DrizzleDb;
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Synthetic refund policy', tier: 'pro' })
    .returning();
  workspaceId = ws!.id;
  await db.insert(users).values({ workspaceId, email: 'refund-policy@example.test' });
  await db.insert(subscriptions).values({
    workspaceId,
    provider: 'paddle',
    providerSubscriptionId: 'sub_upgrade',
    providerPriceId: 'pri_target',
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    currentPeriodEnd: new Date(end),
    updatedAt: new Date(now),
  });
  const normalized = {
    providerSubscriptionId: 'sub_upgrade',
    providerCustomerId: 'ctm_synthetic',
    providerPriceId: 'pri_base',
    status: 'active' as const,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    pauseUntil: null,
    workspaceId,
  };
  prior = {
    id: 'sub_upgrade',
    status: 'active',
    priceId: 'pri_base',
    periodStart: '2026-10-09T12:00:00.000Z',
    periodEnd: end,
    nextBilledAt: end,
    updatedAt: '2026-10-09T12:00:00.000Z',
    scheduledAction: null,
    scheduledAt: null,
    discountId: null,
    discountEndsAt: null,
    normalized,
  };
  state = {
    ...prior,
    priceId: 'pri_target',
    updatedAt: closed,
    normalized: { ...normalized, providerPriceId: 'pri_target' },
  };
  intent = {
    intent_id: randomUUID(),
    provider_subscription_id: 'sub_upgrade',
    requested_at: requested,
    from_tier: 'plus',
    from_cycle: 'monthly',
    to_tier: 'pro',
    to_cycle: 'monthly',
    to_price_id: 'pri_target',
    local_revision: now,
    prior: upgradeSnapshot(prior),
  };
  const proration = { rate: '0.9', periodStart: '2026-10-10T11:59:58.500Z', periodEnd: end };
  transaction = {
    id: 'txn_upgrade',
    subscriptionId: 'sub_upgrade',
    origin: 'subscription_update',
    status: 'completed',
    upgradeIntentId: intent.intent_id,
    upgradePriceId: 'pri_target',
    positiveCharge: true,
    createdAt: '2026-10-10T11:59:58.500Z',
    lines: [
      { ...proration, priceId: 'pri_target', quantity: 1, total: '1900' },
      { ...proration, priceId: 'pri_base', quantity: -1, total: '-900' },
    ],
  };
  paddle = {
    readRefundAdjustment: vi.fn().mockResolvedValue({ status: 'approved', full: true }),
    readRefundTransaction: vi.fn().mockImplementation(async () => transaction),
    readUpgradeState: vi.fn().mockImplementation(async () => state),
    providerCancellationFacts: vi
      .fn()
      .mockResolvedValue({ settled: null, refuted: { refund: false, chargeback: false } }),
    restoreUpgradeStage: vi.fn().mockImplementation(async (_id, _change, preview) => {
      if (!preview) state = { ...prior, updatedAt: '2026-10-10T12:00:00.100Z' };
      return { noBill: true, nextBilledAt: end };
    }),
    discoverUpgradeTransaction: vi.fn().mockImplementation(async () => transaction),
    changePlan: vi.fn(),
  };
  policy = new BillingUpgradeRefundService(db, catalog, paddle as never);
  projector = new BillingWebhookService(db, catalog, new AutopilotReadService(db), policy);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.BILLING_UPGRADE_REFUND_RESTORE_ENABLED;
  vi.restoreAllMocks();
});

describe('upgrade-only refund policy through canonical projection', () => {
  it.each([false, null])(
    'keeps ordinary refunds on the legacy policy despite strict upgrade coverage %j',
    async (full) => {
      transaction.origin = 'web';
      paddle.readRefundAdjustment.mockResolvedValue({ status: 'approved', full });
      expect(await policy.resolve(event())).toEqual({ kind: 'ordinary' });
      expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
    },
  );
  it('holds missing upgrade refund coverage without attempting a restoration', async () => {
    await seedEvidence();
    paddle.readRefundAdjustment.mockResolvedValue({ status: 'approved', full: null });
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'unknown_refund_coverage',
    });
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(true);
    expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
  });
  it('restores only the base plan and original paid-through date, then deduplicates', async () => {
    await seedEvidence();
    const result = await projector.process('paddle', event(), { occurred_at: now });
    expect(result.kind).toBe('processed');
    const [sub] = await db.select().from(subscriptions);
    const [ws] = await db.select().from(workspaces);
    expect(sub).toMatchObject({
      tier: 'plus',
      status: 'active',
      providerPriceId: 'pri_base',
      cancelAtPeriodEnd: false,
      cancelSource: null,
      currentPeriodEnd: new Date(end),
    });
    expect(ws!.tier).toBe('plus');
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(false);
    expect(paddle.restoreUpgradeStage.mock.calls.filter((c) => c[2] === false)).toHaveLength(1);
    expect((await projector.process('paddle', event(), { occurred_at: now })).kind).toBe(
      'duplicate',
    );
    const audit = await db.select().from(subscriptionEvents);
    expect(audit.filter((r) => r.eventType === 'local.upgrade_restore_completed')).toHaveLength(1);
    expect(audit.find((r) => r.providerEventId === 'evt_adj_refund')!.payload).toMatchObject({
      kind: 'refund_settled',
    });
    expect(audit.filter((r) => r.eventType === 'local.upgrade_refund_classified')).toHaveLength(1);
    expect(
      audit.find((r) => r.eventType === 'local.upgrade_refund_classified')!.payload,
    ).toMatchObject({
      kind: 'upgrade_refund_audit',
      original_event_id: 'evt_adj_refund',
      refund_classification: 'restored',
    });
  });
  it('records completion when a later-timestamp provider webhook wins projection first', async () => {
    await seedEvidence();
    paddle.restoreUpgradeStage.mockImplementation(async (_id, _change, preview) => {
      if (!preview) {
        state = { ...prior, updatedAt: '2026-10-10T12:00:00.100Z' };
        await projector.process(
          'paddle',
          {
            kind: 'subscription',
            providerEventId: 'evt_provider_restore',
            eventType: 'subscription.updated',
            subscription: state.normalized,
          },
          { occurred_at: '2026-10-10T12:00:00.200Z' },
        );
      }
      return { noBill: true, nextBilledAt: end };
    });
    expect((await projector.process('paddle', event(), { occurred_at: now })).kind).toBe(
      'processed',
    );
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(false);
    expect(
      (await db.select().from(subscriptionEvents)).filter(
        (r) => r.eventType === 'local.upgrade_restore_completed',
      ),
    ).toHaveLength(1);
    expect((await projector.process('paddle', event(), { occurred_at: now })).kind).toBe(
      'duplicate',
    );
  });
  it.each(['pending_approval', 'rejected'])(
    'does not change base access or suppress delayed cancellation for %s',
    async (status) => {
      await seedEvidence();
      paddle.readRefundAdjustment.mockResolvedValue({ status, full: true });
      const refund: RefundEvent =
        status === 'rejected'
          ? { ...event(), kind: 'cancellation_revoked', reason: 'refund_rejected' }
          : { ...event(), kind: 'cancellation_scheduled', reason: 'refund' };
      await projector.process('paddle', refund, { occurred_at: '2026-10-10T12:01:00.000Z' });
      expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
      const [before] = await db.select().from(subscriptions);
      expect(before!.cancelSource).toBeNull();
      const cancellation = await projector.process(
        'paddle',
        {
          kind: 'subscription',
          providerEventId: 'evt_delayed_cancel',
          eventType: 'subscription.canceled',
          subscription: { ...state.normalized, status: 'canceled', currentPeriodEnd: null },
        },
        { occurred_at: '2026-10-10T12:00:30.000Z' },
      );
      expect(cancellation.kind).toBe('processed');
      const [after] = await db.select().from(subscriptions);
      expect(after!.status).toBe('canceled');
    },
  );
  it('never binds an inherited token from the first later refund', async () => {
    await seedEvidence(false);
    transaction = { ...transaction, id: 'txn_later' };
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'transaction_not_bound',
    });
    expect(paddle.discoverUpgradeTransaction).not.toHaveBeenCalled();
    expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
  });
  it.each(['chargeback', 'refund'])('does not restore across settled %s', async (reason) => {
    await seedEvidence();
    paddle.providerCancellationFacts.mockResolvedValue({
      settled: reason,
      refuted: { refund: false, chargeback: false },
    });
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'other_refund_or_chargeback',
    });
    expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
  });
  it('keeps customer cancellation and never writes after local stop during preview', async () => {
    await seedEvidence();
    paddle.restoreUpgradeStage.mockImplementation(async () => {
      await db
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscriptions.providerSubscriptionId, 'sub_upgrade'));
      return { noBill: true, nextBilledAt: end };
    });
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'stop_changed_before_restore',
    });
    expect(paddle.restoreUpgradeStage.mock.calls.every((c) => c[2] === true)).toBe(true);
  });
  it('holds renewal-changing restoration before a provider write', async () => {
    await seedEvidence();
    paddle.restoreUpgradeStage.mockResolvedValue({
      noBill: true,
      nextBilledAt: '2026-11-10T12:00:00.000Z',
    });
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'original_renewal_requires_support',
    });
    expect(paddle.restoreUpgradeStage).toHaveBeenCalledTimes(1);
  });
  it('ships disabled automatic writes until verified cutover', async () => {
    await seedEvidence();
    delete process.env.BILLING_UPGRADE_REFUND_RESTORE_ENABLED;
    expect(await policy.resolve(event())).toMatchObject({
      kind: 'hold',
      reason: 'awaiting_verified_cutover',
    });
    expect(paddle.restoreUpgradeStage).not.toHaveBeenCalled();
  });
  it('gives exactly one concurrent delivery the outbound restore claim', async () => {
    await seedEvidence();
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    paddle.restoreUpgradeStage.mockImplementation(async (_id, _change, preview) => {
      if (preview) {
        entered();
        await blocked;
      } else state = { ...prior, updatedAt: '2026-10-10T12:00:00.100Z' };
      return { noBill: true, nextBilledAt: end };
    });
    const first = policy.resolve(event());
    await started;
    await expect(policy.resolve(event('adj_reconcile'))).rejects.toMatchObject({
      code: 'PLAN_CHANGE_PENDING',
    });
    release();
    expect(await first).toMatchObject({ kind: 'restored' });
    expect(paddle.restoreUpgradeStage.mock.calls.filter((c) => c[2] === false)).toHaveLength(1);
  });
  it('binds the original complete transaction once and releases the pending upgrade', async () => {
    await seedEvidence(false);
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(true);
    expect(await policy.confirmPendingUpgrade('sub_upgrade', intent.intent_id)).toBe(true);
    expect(await policy.confirmPendingUpgrade('sub_upgrade', intent.intent_id)).toBe(true);
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(false);
    expect(
      (await db.select().from(subscriptionEvents)).filter(
        (r) => r.eventType === 'local.upgrade_transaction_bound',
      ),
    ).toHaveLength(1);
    expect(paddle.discoverUpgradeTransaction).toHaveBeenCalledWith(
      'sub_upgrade',
      intent.intent_id,
      requested,
      closed,
    );
  });
  it('keeps a refund review pending after delayed confirmation of its original upgrade', async () => {
    await seedEvidence(false);
    await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_refund_held', 'adj_refund', {
      intent_id: intent.intent_id,
      adjustment_id: 'adj_refund',
    });
    expect(await policy.confirmPendingUpgrade('sub_upgrade', intent.intent_id)).toBe(true);
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(true);
    await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_review_resolved', 'wrong_scope', {
      intent_id: intent.intent_id,
      provider_reviewed: true,
      operator_id: 'synthetic_operator',
      evidence_reference: 'synthetic_review',
    });
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(true);
    await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_restore_completed', 'adj_refund', {
      intent_id: intent.intent_id,
      adjustment_id: 'adj_refund',
    });
    await appendUpgradeRecord(db, 'sub_upgrade', 'local.upgrade_refund_held', 'late_hold', {
      intent_id: intent.intent_id,
      adjustment_id: 'adj_refund',
    });
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(false);
  });
  it.each(['mixed', 'quantity', 'period', 'later'])('rejects %s charge evidence', async (kind) => {
    await seedEvidence(false);
    const bad = structuredClone(transaction);
    if (kind === 'mixed') bad.lines!.push({ ...bad.lines![0]!, priceId: 'pri_addon' });
    if (kind === 'quantity') bad.lines![0]!.quantity = 2;
    if (kind === 'period') bad.lines![0]!.periodEnd = '2026-12-10T12:00:00.000Z';
    if (kind === 'later') bad.createdAt = '2026-10-10T12:01:00.000Z';
    expect(matchesUpgradeCharge(bad, intent, upgradeSnapshot(state), closed)).toBe(false);
    paddle.discoverUpgradeTransaction.mockResolvedValue(bad);
    expect(await policy.confirmPendingUpgrade('sub_upgrade', intent.intent_id)).toBe(false);
    expect(await hasUnresolvedUpgrade(db, 'sub_upgrade')).toBe(true);
  });
  it('does not let a mutation pass a newly committed pending intent', async () => {
    await seedEvidence(false);
    const [sub] = await db.select().from(subscriptions);
    const action = vi.fn();
    await expect(
      policy.mutation('sub_upgrade', sub!.updatedAt, 'pause', action),
    ).rejects.toMatchObject({ code: 'PLAN_CHANGE_PENDING' });
    expect(action).not.toHaveBeenCalled();
  });
});
