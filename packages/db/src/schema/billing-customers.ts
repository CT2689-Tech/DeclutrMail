import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { workspaces } from './workspaces';

/**
 * Billing customers — one provider-side customer record per workspace
 * per provider (D117).
 *
 * D117 splits billing by region: Paddle is merchant-of-record for
 * non-India users; Razorpay handles India (UPI + Indian cards + INR
 * settlement). A workspace normally has exactly one row, but a
 * region/provider switch (user override in Settings → Account) creates
 * a second row rather than mutating provider identity — hence unique
 * on `(workspace_id, provider)`, not on `workspace_id` alone.
 *
 * Workspace-scoped (not user-scoped): the tier lives on
 * `workspaces.tier` (D17–D21) and billing flips it, so the customer
 * record hangs off the same tenant boundary. (D117's plan text predates
 * the workspace modeling of migration 0000; `users.billing_region`
 * still exists per D117 for signup-time detection + Settings override.)
 *
 * `(provider, provider_customer_id)` is unique — billing webhooks
 * resolve the workspace from the provider's customer id, so the lookup
 * is a single indexed seek and a provider id can never map to two
 * workspaces.
 *
 * No body data; no privacy concerns — provider ids and region only.
 */

/** D117 — Paddle (international, merchant-of-record) + Razorpay (India). */
export const billingProvider = pgEnum('billing_provider', ['paddle', 'razorpay']);

/**
 * D117 — billing region drives provider routing: 'india' → Razorpay,
 * 'international' → Paddle. Auto-detected from IP at signup; user can
 * override in Settings → Account.
 */
export const billingRegion = pgEnum('billing_region', ['international', 'india']);

export const billingCustomers = pgTable(
  'billing_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: billingProvider('provider').notNull(),
    /** Provider-side customer id (Paddle `ctm_…` / Razorpay `cust_…`). */
    providerCustomerId: text('provider_customer_id').notNull(),
    /** Region the customer record was created under (D117 routing). */
    region: billingRegion('region').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** One customer record per provider per workspace. */
    workspaceProviderUniq: uniqueIndex('billing_customers_workspace_provider_uniq').on(
      table.workspaceId,
      table.provider,
    ),
    /** Webhook hot path: resolve workspace from the provider's customer id. */
    providerCustomerUniq: uniqueIndex('billing_customers_provider_customer_uniq').on(
      table.provider,
      table.providerCustomerId,
    ),
  }),
);

export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type NewBillingCustomer = typeof billingCustomers.$inferInsert;
