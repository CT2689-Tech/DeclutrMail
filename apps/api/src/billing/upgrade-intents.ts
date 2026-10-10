import { subscriptionEvents } from '@declutrmail/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDb } from '../db/db.module.js';
import type { PaddleUpgradeState } from './upgrade-refund.types.js';

export const UPGRADE_EVENTS = [
  'local.upgrade_requested',
  'local.upgrade_confirmed',
  'local.upgrade_attempt_closed',
  'local.upgrade_transaction_bound',
  'local.upgrade_failed',
  'local.upgrade_restore_started',
  'local.upgrade_restore_completed',
  'local.upgrade_refund_held',
  'local.upgrade_review_resolved',
  'local.upgrade_mutation_requested',
  'local.upgrade_mutation_completed',
  'local.upgrade_mutation_failed',
] as const;
type Store = Pick<DrizzleDb, 'select' | 'insert'>;
const instant = z.iso.datetime({ offset: true });
const snapshotSchema = z.object({
  priceId: z.string(),
  periodStart: instant,
  periodEnd: instant,
  nextBilledAt: instant.nullable(),
  updatedAt: instant,
  scheduledAction: z.string().nullable(),
  scheduledAt: instant.nullable(),
  discountId: z.string().nullable(),
  discountEndsAt: instant.nullable(),
});
export const UpgradeIntentSchema = z.object({
  intent_id: z.uuid(),
  provider_subscription_id: z.string(),
  requested_at: instant,
  from_tier: z.enum(['plus', 'pro']),
  from_cycle: z.enum(['monthly', 'annual']),
  to_tier: z.enum(['plus', 'pro']),
  to_cycle: z.enum(['monthly', 'annual']),
  to_price_id: z.string(),
  local_revision: instant,
  prior: snapshotSchema,
});
export type UpgradeIntent = z.infer<typeof UpgradeIntentSchema>;

/** Explicit projection; never persist the normalized attribution/custom data. */
export function upgradeSnapshot(s: PaddleUpgradeState): z.infer<typeof snapshotSchema> {
  return {
    priceId: s.priceId,
    periodStart: new Date(s.periodStart).toISOString(),
    periodEnd: new Date(s.periodEnd).toISOString(),
    nextBilledAt: s.nextBilledAt ? new Date(s.nextBilledAt).toISOString() : null,
    updatedAt: new Date(s.updatedAt).toISOString(),
    scheduledAction: s.scheduledAction,
    scheduledAt: s.scheduledAt ? new Date(s.scheduledAt).toISOString() : null,
    discountId: s.discountId,
    discountEndsAt: s.discountEndsAt ? new Date(s.discountEndsAt).toISOString() : null,
  };
}

export async function upgradeRecords(db: Store, subscriptionId: string) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.provider, 'paddle'),
        inArray(subscriptionEvents.eventType, [...UPGRADE_EVENTS]),
        sql`${subscriptionEvents.payload}->>'provider_subscription_id' = ${subscriptionId}`,
      ),
    )
    .orderBy(subscriptionEvents.arrivalSeq);
}

export async function appendUpgradeRecord(
  tx: Store,
  subscriptionId: string,
  eventType: (typeof UPGRADE_EVENTS)[number],
  key: string,
  payload: Record<string, unknown>,
) {
  const inserted = await tx
    .insert(subscriptionEvents)
    .values({
      provider: 'paddle',
      providerEventId: `${eventType}:${key}`,
      eventType,
      payload: { ...payload, provider_subscription_id: subscriptionId },
      processedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: subscriptionEvents.id });
  return inserted.length === 1;
}

/** A timeout/restore/review stays a barrier until positive completion or a
 * scoped support resolution. Cancellation remains available to stop billing. */
export async function hasUnresolvedUpgrade(db: Store, subscriptionId: string): Promise<boolean> {
  const pending = new Set<string>();
  const terminal = new Set<string>();
  for (const row of await upgradeRecords(db, subscriptionId)) {
    const p = row.payload as Record<string, unknown>;
    const isRefund =
      [
        'local.upgrade_restore_started',
        'local.upgrade_restore_completed',
        'local.upgrade_refund_held',
      ].includes(row.eventType) ||
      (row.eventType === 'local.upgrade_review_resolved' && typeof p.adjustment_id === 'string');
    const key =
      isRefund && typeof p.adjustment_id === 'string'
        ? `refund:${p.adjustment_id}`
        : !isRefund && typeof p.intent_id === 'string'
          ? `upgrade:${p.intent_id}`
          : null;
    if (!key || terminal.has(key)) continue;
    if (
      [
        'local.upgrade_requested',
        'local.upgrade_restore_started',
        'local.upgrade_refund_held',
        'local.upgrade_mutation_requested',
      ].includes(row.eventType)
    )
      pending.add(key);
    if (
      [
        'local.upgrade_confirmed',
        'local.upgrade_failed',
        'local.upgrade_restore_completed',
        'local.upgrade_mutation_completed',
        'local.upgrade_mutation_failed',
      ].includes(row.eventType)
    )
      pending.delete(key);
    if (
      [
        'local.upgrade_failed',
        'local.upgrade_restore_completed',
        'local.upgrade_mutation_completed',
        'local.upgrade_mutation_failed',
      ].includes(row.eventType)
    )
      terminal.add(key);
    if (
      row.eventType === 'local.upgrade_review_resolved' &&
      p.provider_reviewed === true &&
      typeof p.operator_id === 'string' &&
      p.operator_id.length > 0 &&
      typeof p.evidence_reference === 'string' &&
      p.evidence_reference.length > 0
    ) {
      pending.delete(key);
      terminal.add(key);
    }
  }
  return pending.size > 0;
}

export async function intentEvidence(db: Store, subscriptionId: string, intentId: string) {
  const rows = await upgradeRecords(db, subscriptionId);
  const request = rows.find(
    (r) =>
      r.eventType === 'local.upgrade_requested' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const parsed = UpgradeIntentSchema.safeParse(request?.payload);
  if (!parsed.success) return null;
  const confirmed = rows.find(
    (r) =>
      r.eventType === 'local.upgrade_confirmed' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const closed = rows.find(
    (r) =>
      r.eventType === 'local.upgrade_attempt_closed' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const closePayload = closed?.payload as Record<string, unknown> | undefined;
  const windowEnd = instant.safeParse(closePayload?.window_closed_at);
  const bound = rows.find(
    (r) =>
      r.eventType === 'local.upgrade_transaction_bound' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const transactionId = (bound?.payload as Record<string, unknown> | undefined)?.transaction_id;
  const target = snapshotSchema.safeParse(
    (confirmed?.payload as Record<string, unknown> | undefined)?.target ?? closePayload?.target,
  );
  const restored = rows.some(
    (r) =>
      r.eventType === 'local.upgrade_restore_completed' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const restoring = rows.some(
    (r) =>
      r.eventType === 'local.upgrade_restore_started' &&
      (r.payload as Record<string, unknown>).intent_id === intentId,
  );
  const newerUpgrade = rows.some(
    (r) =>
      r.eventType === 'local.upgrade_requested' &&
      r.arrivalSeq > request!.arrivalSeq &&
      !rows.some(
        (f) =>
          f.eventType === 'local.upgrade_failed' &&
          (f.payload as Record<string, unknown>).intent_id ===
            (r.payload as Record<string, unknown>).intent_id,
      ),
  );
  return {
    intent: parsed.data,
    target: target.success ? target.data : null,
    restored,
    restoring,
    newerUpgrade,
    windowEnd: windowEnd.success ? windowEnd.data : null,
    transactionId: typeof transactionId === 'string' ? transactionId : null,
  };
}
