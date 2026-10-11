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

/**
 * Props are an object of allowlisted keys. Each present value is a
 * scalar on a closed list or a short pattern. Nested objects, arrays,
 * and free text (a subject, snippet, or token) fail the check.
 * No subqueries: Postgres rejects them inside CHECK.
 */
const PROPS_VALUE_CHECKS = [
  `("props"->'kind' IS NULL OR (jsonb_typeof("props"->'kind') = 'string' AND "props"->>'kind' IN ('gmail', 'workspace')))`,
  `("props"->'plan' IS NULL OR (jsonb_typeof("props"->'plan') = 'string' AND "props"->>'plan' ~ '^[A-Za-z0-9._+-]{1,64}$'))`,
  `("props"->'requested_bucket' IS NULL OR (jsonb_typeof("props"->'requested_bucket') = 'string' AND "props"->>'requested_bucket' IN ('1', '2-10', '11-100', '101-1000', '1001+')))`,
  `("props"->'duration_s' IS NULL OR (jsonb_typeof("props"->'duration_s') = 'number' AND ("props"->>'duration_s')::numeric IN (0, 30, 60, 120, 300, 600, 1800, 3600, 7200)))`,
  `("props"->'emails' IS NULL OR (jsonb_typeof("props"->'emails') = 'number' AND ("props"->>'emails')::numeric IN (0, 100, 1000, 10000, 50000, 100000)))`,
  `("props"->'template' IS NULL OR (jsonb_typeof("props"->'template') = 'string' AND "props"->>'template' IN ('sync_complete', 'sync_reminder_24h', 'lapse', 'weekly', 'weekly_detail', 'sync_failed', 'gmail_reconnect', 'deletion_scheduled')))`,
  `("props"->'mode' IS NULL OR (jsonb_typeof("props"->'mode') = 'string' AND "props"->>'mode' IN ('login', 'connect', 'reconnect')))`,
  `("props"->'error_class' IS NULL OR (jsonb_typeof("props"->'error_class') = 'string' AND "props"->>'error_class' ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'))`,
  `("props"->'provider' IS NULL OR (jsonb_typeof("props"->'provider') = 'string' AND "props"->>'provider' = 'google'))`,
  `("props"->'mailbox_id' IS NULL OR (jsonb_typeof("props"->'mailbox_id') = 'string' AND "props"->>'mailbox_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))`,
].join('\n    AND ');

export const PRODUCT_EVENT_PROPS_CHECK_SQL = `jsonb_typeof("props") = 'object'
    AND ("props" - ARRAY[${PROP_KEYS.map((key) => `'${key}'`).join(', ')}]::text[]) = '{}'::jsonb
    AND strpos("props"::text, '@') = 0
    AND ${PROPS_VALUE_CHECKS}`;

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
    propsCheck: check('product_events_props_chk', sql.raw(PRODUCT_EVENT_PROPS_CHECK_SQL)),
  }),
);

export type ProductEventRow = typeof productEvents.$inferSelect;
export type NewProductEventRow = typeof productEvents.$inferInsert;
