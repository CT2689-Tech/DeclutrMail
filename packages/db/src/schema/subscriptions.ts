import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { billingProvider } from './billing-customers';
import { workspaces, workspaceTier } from './workspaces';

/**
 * Subscriptions — provider-normalized subscription state per workspace
 * (D117, D118, D126).
 *
 * One row per provider-side subscription. Webhook handlers (Paddle /
 * Razorpay, normalized behind the shared `BillingProvider` interface
 * per D117) upsert on `(provider, provider_subscription_id)` and flip
 * `workspaces.tier` in the same transaction.
 *
 * `tier` reuses the `workspace_tier` enum so the subscription's
 * entitlement and the workspace's resolved tier can never diverge in
 * vocabulary. D117's cross-provider plan codes (`pro_annual`, …) are
 * fully encoded by `(tier, billing_cycle, founding_member)`;
 * `provider_price_id` carries the provider-side price/plan identifier
 * (Paddle `pri_…` / Razorpay `plan_…`) for webhook reconciliation.
 *
 * `status` per D117 [CODEX PATCH 2026-05-18]: NO `trialing` value —
 * D121 locked the no-trial mechanic; subscriptions are paid from day 1.
 *
 * D118 lifecycle columns:
 *   - Pause:  `status = 'paused'`, `pause_until = now() + 30 days`.
 *     Pro features lock during pause.
 *   - Cancel: `cancel_at_period_end = true`, `status` stays 'active'
 *     until period end, then flips to 'canceled'.
 *
 * `current_period_end` is nullable — providers null the billing period
 * on terminal cancellation (e.g. Paddle's `current_billing_period`),
 * and the D232 deletion math reads undo_journal, not this column.
 *
 * `founding_member` (D126) — this subscription is on the
 * `pro_annual_founding` price lock ($129/yr, first 250). Mirrored to
 * `workspaces.founding_member` by the billing service; recorded here
 * so the price-locked subscription survives provider migrations.
 *
 * No body data; no privacy concerns.
 */

/** D117 statuses; `trialing` excluded per CODEX PATCH (D121 no-trial). */
export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'paused',
]);

/** D117 plan codes split monthly/annual. */
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'annual']);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: billingProvider('provider').notNull(),
    /** Provider-side subscription id (Paddle `sub_…` / Razorpay `sub_…`). */
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    /** Entitlement this subscription grants — same enum as `workspaces.tier`. */
    tier: workspaceTier('tier').notNull(),
    status: subscriptionStatus('status').notNull(),
    /** Provider-side price/plan identifier (Paddle `pri_…` / Razorpay `plan_…`). */
    providerPriceId: text('provider_price_id').notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    /** Null on terminal cancellation (provider nulls the billing period). */
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** D118 pause offer — set with `status='paused'`; null otherwise. */
    pauseUntil: timestamp('pause_until', { withTimezone: true, mode: 'date' }),
    /** D126 — on the founding-member price lock (`pro_annual_founding`). */
    foundingMember: boolean('founding_member').notNull().default(false),
    /**
     * D120 paid-plan downgrade scheduled for the current period end.
     * Paddle swaps its catalog item immediately, so these server-owned
     * fields keep the old entitlement authoritative until renewal.
     */
    scheduledTier: workspaceTier('scheduled_tier'),
    scheduledBillingCycle: billingCycle('scheduled_billing_cycle'),
    scheduledProviderPriceId: text('scheduled_provider_price_id'),
    scheduledChangeAt: timestamp('scheduled_change_at', { withTimezone: true, mode: 'date' }),
    scheduledChangeState: text('scheduled_change_state', {
      enum: ['pending_provider', 'scheduled', 'restoring_current'],
    }),
    scheduledChangeRequestedAt: timestamp('scheduled_change_requested_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** Webhook upsert key — a provider subscription maps to exactly one row. */
    providerSubscriptionUniq: uniqueIndex('subscriptions_provider_subscription_uniq').on(
      table.provider,
      table.providerSubscriptionId,
    ),
    /** "Current subscription for this workspace" read path (billing screen, tier gate). */
    workspaceIdx: index('subscriptions_workspace_id_idx').on(table.workspaceId),
    /** Mirrors migration 0048 — scheduled-change state machine vocabulary. */
    scheduledChangeStateCheck: check(
      'subscriptions_scheduled_change_state_check',
      sql`${table.scheduledChangeState} IS NULL OR ${table.scheduledChangeState} IN ('pending_provider', 'scheduled', 'restoring_current')`,
    ),
    /** Mirrors migration 0048 — the six scheduled-change columns are all-or-nothing. */
    scheduledChangeCompleteCheck: check(
      'subscriptions_scheduled_change_complete_check',
      sql`(${table.scheduledChangeState} IS NULL AND ${table.scheduledTier} IS NULL AND ${table.scheduledBillingCycle} IS NULL AND ${table.scheduledProviderPriceId} IS NULL AND ${table.scheduledChangeAt} IS NULL AND ${table.scheduledChangeRequestedAt} IS NULL) OR (${table.scheduledChangeState} IS NOT NULL AND ${table.scheduledTier} IS NOT NULL AND ${table.scheduledBillingCycle} IS NOT NULL AND ${table.scheduledProviderPriceId} IS NOT NULL AND ${table.scheduledChangeAt} IS NOT NULL AND ${table.scheduledChangeRequestedAt} IS NOT NULL)`,
    ),
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
