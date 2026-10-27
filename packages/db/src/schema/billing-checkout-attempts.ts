import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/** Durable purchase identity. No credentials, customer details or payment instruments. */
export const billingCheckoutAttempts = pgTable(
  'billing_checkout_attempts',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('paddle'),
    tier: text('tier').notNull(),
    cycle: text('cycle').notNull(),
    offer: text('offer'),
    providerPriceId: text('provider_price_id').notNull(),
    currencyCode: text('currency_code').notNull(),
    providerTransactionId: text('provider_transaction_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    state: text('state').notNull().default('creating'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true, mode: 'date' }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('billing_checkout_attempts_workspace_idx').on(t.workspaceId, t.createdAt),
    index('billing_checkout_attempts_subscription_idx').on(t.provider, t.providerSubscriptionId),
    index('billing_checkout_attempts_recovery_idx')
      .on(t.updatedAt)
      .where(
        sql`${t.state} IN ('creating','open','payment_in_progress','stopping','paid','unknown')`,
      ),
    uniqueIndex('billing_checkout_attempts_transaction_key').on(
      t.provider,
      t.providerTransactionId,
    ),
    uniqueIndex('billing_checkout_attempts_one_unresolved')
      .on(t.workspaceId)
      .where(sql`${t.state} IN ('creating', 'open', 'payment_in_progress', 'stopping', 'unknown')`),
    check(
      'billing_checkout_attempts_state_check',
      sql`${t.state} IN ('creating','open','payment_in_progress','stopping','paid','fulfilled','stopped','unknown')`,
    ),
    check(
      'billing_checkout_attempts_purchase_check',
      sql`${t.provider} = 'paddle' AND ${t.tier} IN ('plus','pro') AND ${t.cycle} IN ('monthly','annual') AND (${t.offer} IS NULL OR ${t.offer} = 'pass_onetime') AND ${t.currencyCode} IN ('USD','INR')`,
    ),
  ],
);
export type BillingCheckoutAttemptRow = typeof billingCheckoutAttempts.$inferSelect;
