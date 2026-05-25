import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { automationRules } from './automation-rules';
import { mailboxAccounts } from './mailbox-accounts';
import { undoJournal } from './undo-journal';

/**
 * Rule match log — every time an Autopilot rule matched a sender,
 * regardless of whether the match resulted in an action.
 *
 * D101 last-run summary, D104 observe-mode pending-suggestions tab,
 * and the audit history are all read out of this table.
 *
 * Two modes (`mode_at_match`):
 *
 *   `observe` — the rule was in Observe mode when it matched. The row
 *               sits in the pending-suggestions buffer until the user
 *               approves or dismisses it, or the 7-day Observe window
 *               elapses and the rule auto-promotes to Active (matches
 *               written during Observe stay logged for audit).
 *
 *   `active`  — the rule was in Active mode; the apply worker emitted
 *               an action intent through the existing undo + outbox
 *               path. `intent_token` references the resulting
 *               `undo_journal` row, and `resolution` is auto-set to
 *               `approved` since the action already fired.
 *
 * Resolution lifecycle (`resolution`):
 *
 *   `pending`   — Observe-mode default. The match sits in the
 *                 pending-suggestions read path.
 *   `approved`  — user clicked "Apply" on the suggestion (Observe), OR
 *                 the rule was Active and the action auto-fired.
 *   `dismissed` — user clicked "Dismiss" on the suggestion. Stays
 *                 logged for the audit history; excluded from the
 *                 pending-suggestions read path.
 *
 * `intent_token` is non-null iff an undo-journal row was created for
 * the resulting action. Observe-mode pending rows have a NULL token.
 * Once an Observe row is approved, the apply worker writes the
 * undo-journal row and updates the match row to set
 * `(resolution='approved', intent_applied=true, intent_token=<uuid>)`.
 *
 * `confidence` snapshots the engine confidence at match time so the
 * audit copy can render it later without re-querying triage_decisions.
 *
 * `reason` is the human-readable label for which branch of the rule
 * matched — e.g. "Engine verdict=Archive at 0.93 confidence (rule
 * threshold 0.85)". Feeds the suggestion card UI and the audit list.
 *
 * Indexing:
 *
 *   - `(mailbox_account_id, matched_at DESC) WHERE mode_at_match='observe'
 *     AND resolution='pending'` partial — the hot pending-suggestions
 *     read path on the Autopilot screen.
 *
 *   - `(rule_id, matched_at DESC)` — "recently affected senders for
 *     this rule" (D101 last-N mini-list).
 *
 *   - `(mailbox_account_id, matched_at DESC)` — per-mailbox audit
 *     query: full history of Autopilot matches.
 *
 * Privacy (D7, D228): metadata only — `sender_key` is the sha256 of
 * the normalized email, never the email or message body itself. No
 * snippet, no subject, no headers.
 */

/** Snapshot of rule.mode at match time. */
export const autopilotMatchMode = pgEnum('autopilot_match_mode', ['observe', 'active']);

/** D104 — user decision on the buffered suggestion. */
export const autopilotMatchResolution = pgEnum('autopilot_match_resolution', [
  'pending',
  'approved',
  'dismissed',
]);

export const ruleMatchLog = pgTable(
  'rule_match_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the rule for read-path index efficiency — the
     * pending-suggestions query reads by mailbox first, then time.
     */
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    modeAtMatch: autopilotMatchMode('mode_at_match').notNull(),
    /**
     * Engine confidence at match time. Stored verbatim so audit copy
     * does not need to back-join triage_decisions, whose row may have
     * been re-scored since.
     */
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    /** Human-readable branch label — surfaces in audit copy + suggestion card. */
    reason: text('reason').notNull(),
    /**
     * Has an action intent been emitted for this match? Active-mode
     * rows: true on insert. Observe-mode rows: false until user clicks
     * Apply (then flips true with `intent_token` populated).
     */
    intentApplied: boolean('intent_applied').notNull().default(false),
    /**
     * Undo-journal token for the emitted action, NULL when no action
     * was emitted (Observe-mode pending or dismissed). `ON DELETE SET
     * NULL` so journal expiry does not cascade-delete the audit row.
     */
    intentToken: uuid('intent_token').references(() => undoJournal.token, {
      onDelete: 'set null',
    }),
    resolution: autopilotMatchResolution('resolution').notNull().default('pending'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    /**
     * D104 pending-suggestions hot path. Partial index keeps the scan
     * footprint bounded by the unresolved Observe-mode backlog.
     */
    observePendingIdx: index('rule_match_log_observe_pending_idx')
      .on(table.mailboxAccountId, table.matchedAt)
      .where(sql`${table.modeAtMatch} = 'observe' AND ${table.resolution} = 'pending'`),
    /** "Recently affected senders" for a rule (D101 last-N mini-list). */
    ruleMatchedIdx: index('rule_match_log_rule_matched_idx').on(table.ruleId, table.matchedAt),
    /** Per-mailbox audit history. */
    mailboxMatchedIdx: index('rule_match_log_mailbox_matched_idx').on(
      table.mailboxAccountId,
      table.matchedAt,
    ),
  }),
);

export type RuleMatchLog = typeof ruleMatchLog.$inferSelect;
export type NewRuleMatchLog = typeof ruleMatchLog.$inferInsert;
export type AutopilotMatchMode = (typeof autopilotMatchMode.enumValues)[number];
export type AutopilotMatchResolution = (typeof autopilotMatchResolution.enumValues)[number];
