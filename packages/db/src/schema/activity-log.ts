import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Activity log — append-only record of decisions taken on senders.
 *
 * Powers the Decision history section at the bottom of Sender Detail
 * (D39): `WHERE sender_key = ? ORDER BY occurred_at DESC`, 25 per page.
 *
 * `source` records how the decision was made (an in-app Triage pass, a
 * manual action, an Autopilot rule, or the Screener). `action` is the
 * canonical verb applied (D227). `affected_count` is the number of
 * messages the decision moved — the "47 emails" in the history row.
 *
 * `sender_key` is nullable so the log can also carry account-scoped
 * entries that are not tied to a single sender.
 *
 * Append-only — no `updated_at`, no row mutation.
 *
 * No body data; no privacy concerns.
 */

export const activitySource = pgEnum('activity_source', [
  'triage',
  'manual',
  'autopilot',
  'screener',
]);

export const activityAction = pgEnum('activity_action', [
  'keep',
  'archive',
  'unsubscribe',
  'later',
]);

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — null for account-scoped entries. */
    senderKey: text('sender_key'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    source: activitySource('source').notNull(),
    action: activityAction('action').notNull(),
    affectedCount: integer('affected_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    senderHistoryIdx: index('activity_log_account_sender_occurred_idx').on(
      table.mailboxAccountId,
      table.senderKey,
      table.occurredAt,
    ),
  }),
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
