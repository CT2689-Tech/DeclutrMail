import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { billingProvider } from './billing-customers';
import { billingCycle } from './subscriptions';
import { workspaces, workspaceTier } from './workspaces';

/**
 * Pending checkout — the server-side half of the double-charge guard
 * (0051; B7 / 2026-07-20 followups; decision 1 2026-07-28).
 *
 * Between the provider's `checkout.completed` and the webhook grant
 * there is no `subscriptions` row, so nothing server-side could tell a
 * SECOND device that a payment is in flight — laptop-pays /
 * phone-opens-/billing showed live checkout CTAs. The FE's
 * localStorage + Web Locks guard is same-browser only; this row is the
 * cross-device truth, exposed as `pendingCheckout` on
 * `GET /api/billing/subscription`.
 *
 * One row per workspace (PK), refreshed on checkout re-open. Cleared
 * by the webhook grant (the tier flip supersedes it) or the
 * reconciler's expiry sweep. `expires_at` is a display/lock horizon,
 * not a payment fact — an expired row means "we no longer claim a
 * checkout is in flight", never "the payment failed".
 *
 * Metadata only — provider + tier + cycle + timestamps + the
 * provider-side subscription id when the server itself created it
 * (`provider_ref`, D249). No payment details. The original "no provider
 * session ids" posture is amended, not violated: the reconciler
 * (billing-reconciliation.service.ts) is a legitimate consumer that
 * needs to ask the provider "what happened to THIS checkout" exactly,
 * and a subscription id is not a payment credential. Razorpay populates
 * it (its createCheckout mints the subscription server-side, before
 * payment); Paddle's overlay creates the transaction client-side, so it
 * stays NULL there and reconciliation falls back to customer search.
 */
export const pendingCheckouts = pgTable(
  'pending_checkouts',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: billingProvider('provider').notNull(),
    tier: workspaceTier('tier').notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    /** Provider subscription id when known at claim time (D249). */
    providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => ({
    /** Reconciler expiry sweep — `WHERE expires_at < now()`. */
    expiresIdx: index('pending_checkouts_expires_idx').on(table.expiresAt),
  }),
);

export type PendingCheckout = typeof pendingCheckouts.$inferSelect;
export type NewPendingCheckout = typeof pendingCheckouts.$inferInsert;
