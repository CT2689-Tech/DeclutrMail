import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Append-only product funnel (D159). Props are a closed scalar set.
 * Never email addresses, subjects, snippets, or tokens.
 * OpsRetentionWorker deletes rows older than 13 months.
 */
export const productEventName = pgEnum('product_event_name', [
  'signup_completed',
  'signin_provider',
  'gmail_connected',
  'first_sync_ready',
  'first_sync_failed_terminal',
  'free_cap_hit',
  'checkout_created',
  'purchase_confirmed',
  'email_link_clicked',
]);

const PROP_KEYS = [
  'kind',
  'plan',
  'requested_bucket',
  'duration_s',
  'emails',
  'template',
  'mode',
  'error_class',
  'provider',
  'mailbox_id',
] as const;

export const productEvents = pgTable(
  'product_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Nulled on account deletion. The event row stays for the retention window. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: productEventName('event').notNull(),
    props: jsonb('props').$type<Record<string, string | number | boolean>>().notNull().default({}),
  },
  (table) => ({
    occurredAtIdx: index('product_events_occurred_at_idx').on(table.occurredAt.desc()),
    eventOccurredIdx: index('product_events_event_occurred_idx').on(
      table.event,
      table.occurredAt.desc(),
    ),
    userIdx: index('product_events_user_id_idx').on(table.userId),
    propsCheck: check(
      'product_events_props_chk',
      sql`jsonb_typeof(${table.props}) = 'object' AND (${table.props} - ARRAY[${sql.raw(
        PROP_KEYS.map((key) => `'${key}'`).join(', '),
      )}]::text[]) = '{}'::jsonb AND strpos(${table.props}::text, '@') = 0`,
    ),
  }),
);

export type ProductEventRow = typeof productEvents.$inferSelect;
export type NewProductEventRow = typeof productEvents.$inferInsert;
