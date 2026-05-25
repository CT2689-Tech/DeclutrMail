import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';
import { undoJournal } from './undo-journal';

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
 * `undo_token` is the optional join to `undo_journal` (D35, D58, D232).
 * Set when the activity row was a destructive action that issued an
 * undo token at mutation time; null for non-destructive Keep entries
 * and historical rows that predate the journal. The FK uses
 * `onDelete: 'set null'` because journal rows are pruned on expiry by
 * the cleanup worker — the activity row outlives the undo window.
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
  // D88: user clicks "Mark resolved" on a followup row. Not a K/A/U/L
  // canonical verb — the action is feature-specific ("I resolved this
  // followup outside email — Slack, phone, in-person"). Hyphenated form
  // mirrors `undo_action_kind`'s `apply-rule` precedent for non-verb
  // feature-specific actions.
  'followup-dismiss',
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
    /**
     * Optional FK to the undo token issued for this row's action (D35,
     * D58, D232). Null for Keep actions (no-op to undo) and rows that
     * predate the journal. `onDelete: 'set null'` so journal expiry
     * (the cleanup worker pruning expired tokens) does not cascade-
     * delete the historical activity row.
     */
    undoToken: uuid('undo_token').references(() => undoJournal.token, {
      onDelete: 'set null',
    }),
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
    /** Activity-row → undo lookup (D58 "Undo" affordance per row). */
    undoTokenIdx: index('activity_log_undo_token_idx').on(table.undoToken),
  }),
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
