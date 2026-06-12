import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Screener quarantine — the queue of first-time senders awaiting a
 * screen decision (D71–D76, table name per D72's plan text).
 *
 * One row per (mailbox, sender) enqueued when the sync/engine path
 * routes a truly unknown sender to the Screener (D21 Phase B, D75).
 * The row is the QUEUE state only — sender identity, sample subject,
 * first-seen, and message counts all come from joins on `senders` /
 * `mail_messages` via `sender_key` (D71 row content); duplicating them
 * here would just drift.
 *
 * `soft_quarantined` — D72's quarantine mode flag. Soft quarantine is
 * DB-only: the sender is flagged for review but Gmail is untouched
 * (no move, no label, no archive) until the user decides. Always true
 * at launch; the column exists so a future opt-in hard-quarantine mode
 * is a value flip, not a migration.
 *
 * `decided_at` — null while the sender sits in the queue; set when the
 * user makes the screen decision. The decision itself lands where
 * decisions already live: the chosen verb goes to `sender_policies`
 * and the audit row to `activity_log(source='screener')` — this table
 * never stores a verdict. ("Screen" stays an internal enum value per
 * D227; this table name references the Screener feature.)
 *
 * The partial index on pending rows serves the two hot reads: the
 * Screener queue listing and the sidebar badge count (D74), both
 * `WHERE mailbox_account_id = ? AND decided_at IS NULL`.
 *
 * No body data; D7/D228 honored — sender key and bookkeeping
 * timestamps only.
 */

export const screenerQuarantine = pgTable(
  'screener_quarantine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    /** D72 soft quarantine: flagged in-app only, Gmail untouched. */
    softQuarantined: boolean('soft_quarantined').notNull().default(true),
    /** Null = awaiting decision; set when the user screens the sender. */
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** One queue row per sender per mailbox. */
    accountSenderUniq: uniqueIndex('screener_quarantine_account_sender_uniq').on(
      table.mailboxAccountId,
      table.senderKey,
    ),
    /** Pending-queue listing + sidebar badge count (D74). */
    pendingIdx: index('screener_quarantine_pending_idx')
      .on(table.mailboxAccountId, table.createdAt)
      .where(sql`${table.decidedAt} IS NULL`),
  }),
);

export type ScreenerQuarantineEntry = typeof screenerQuarantine.$inferSelect;
export type NewScreenerQuarantineEntry = typeof screenerQuarantine.$inferInsert;
