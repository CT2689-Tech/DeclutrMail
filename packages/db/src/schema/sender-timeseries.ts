import { sql } from 'drizzle-orm';
import { date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts.js';

/**
 * Sender timeseries — per-sender, per-month message rollup.
 *
 * Powers the volume sparkline and read-rate stats on the Senders screen
 * and the volume/open charts on Sender Detail (D39). Rows are
 * (re)computed by the `building_sender_index` sync stage (D224) and
 * updated incrementally by the history-sync worker.
 *
 * Composite primary key `(mailbox_account_id, sender_key, year_month)` —
 * one row per sender per calendar month. `year_month` is the first day
 * of the month.
 *
 * NAMING NOTE — the D-plan's draft schema named the read column `opens`.
 * The Gmail API exposes no message-open events; the only signal is the
 * UNREAD label. `read_count` is the count of that month's messages
 * WITHOUT the UNREAD label — a read proxy, not open tracking. The
 * rename is flagged in the PR body as a D-candidate for ratification.
 *
 * `reply_count` is the number of replies the user sent to this sender
 * that month (Sent-folder derived). The column exists now; it is
 * populated once Sent sync lands — defaults to 0 until then.
 */

export const senderTimeseries = pgTable(
  'sender_timeseries',
  {
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    /** First day of the calendar month this row aggregates. */
    yearMonth: date('year_month', { mode: 'string' }).notNull(),
    /** Messages received from this sender in the month. */
    volume: integer('volume').notNull().default(0),
    /** Messages received in the month WITHOUT the UNREAD label (read proxy). */
    readCount: integer('read_count').notNull().default(0),
    /** Replies the user sent to this sender in the month (Sent-derived). */
    replyCount: integer('reply_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.mailboxAccountId, table.senderKey, table.yearMonth],
    }),
  }),
);

export type SenderTimeseries = typeof senderTimeseries.$inferSelect;
export type NewSenderTimeseries = typeof senderTimeseries.$inferInsert;
