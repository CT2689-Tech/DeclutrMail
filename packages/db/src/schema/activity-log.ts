import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { automationRules } from './automation-rules';
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
  // ADR-0019 + ADR-0020 (2026-06-03) — Delete verb added per spec v1.2
  // Decision 1. Activity-log entry created when Delete worker
  // completes the Gmail messages.trash mutation. DB enum mirror
  // migration is packages/db/migrations/0021_delete_action_kinds.sql.
  'delete',
  // D43 — VIP and Protect toggles are recorded as separate audit
  // entries. Snake_case spelling follows D43's literal enum strings.
  // Written by the senders policy write path (SendersPolicyService);
  // affected_count is always 0 (a standing-policy flip moves no mail).
  // DB enum mirror migration is
  // packages/db/migrations/0028_activity_action_vip_protect.sql.
  'marked_vip',
  'unmarked_vip',
  'marked_protected',
  'unmarked_protected',
  // Founder decision 2026-07-08 — the unsubscribe OUTCOME row, written
  // when the brand's RFC 8058 endpoint accepts the unsubscribe. Kept
  // distinct from 'unsubscribe' (the intent/decision row) so the
  // Activity timeline renders the confirmation separately from the
  // click and D56 filters can distinguish the two. Not a K/A/U/L/D
  // canonical verb (D227) — an outcome record, not a user action.
  // DB enum mirror migration is packages/db/migrations/
  // 0031_activity_action_unsubscribe_confirmed.sql. The producer lands
  // in the activity-suite PR (value ships ahead of it — 0024 staging
  // precedent).
  'unsubscribe_confirmed',
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
    /**
     * Rule attribution for `source = 'autopilot'` rows (D58, D104).
     * D58's undo confirm sheet offers "Also disable the rule that
     * triggered this?" — that needs a resolvable reference, so this is
     * an FK to `automation_rules`, not a jsonb blob. Null for
     * non-autopilot rows. `onDelete: 'set null'` — activity is
     * append-only audit and outlives a deleted rule.
     */
    ruleId: uuid('rule_id').references(() => automationRules.id, {
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
    /**
     * Rule → activity rows (D104 audit history) + keeps a rule DELETE's
     * `SET NULL` fan-out off a sequential scan. Partial — only
     * autopilot-attributed rows carry a rule_id.
     */
    ruleIdIdx: index('activity_log_rule_id_idx')
      .on(table.ruleId)
      .where(sql`${table.ruleId} IS NOT NULL`),
  }),
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
