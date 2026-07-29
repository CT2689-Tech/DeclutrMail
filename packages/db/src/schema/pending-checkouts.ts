import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

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
 * Metadata only — provider + tier + cycle + timestamps. No payment
 * details, no provider session ids (D7 posture: store the minimum that
 * serves the surface).
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
