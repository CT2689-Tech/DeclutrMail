import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Undo journal (D35, D58, D232).
 *
 * Per-action durable record that powers:
 *   - the persistent undo tray (D35) — list active tokens per mailbox
 *   - the Activity-row "Undo" affordance (D58) — single-action revert
 *   - the account-deletion grace window (D232) — `max(now+7d, MAX(expires_at))`
 *
 * `token` is the primary key AND the value returned to the client at
 * mutation time. Issuing a fresh random UUID makes the URL space
 * unguessable; using it as the PK lets `POST /undo/:token` look up the
 * row in one indexed seek without exposing internal ids.
 *
 * `action_kind` is a CLOSED string union (Postgres enum) — matches the
 * destructive verbs from D227 (Archive / Unsubscribe / Later) plus
 * `apply-rule` for Autopilot rule applications (D99). "Keep" is
 * non-destructive and intentionally NOT a journal entry (nothing to
 * undo).
 *
 * `payload` carries enough state to reverse the mutation:
 *   { message_ids: string[], prior_labels: string[], … }
 * Privacy posture (D7, D228): message_ids and label ids are Gmail
 * identifiers, NOT body content. Storage allowlist is unchanged — undo
 * payloads never carry subject text, snippets, or anything outside the
 * existing `mail_messages` columns.
 *
 * Lifecycle columns:
 *   - `created_at`   — issued at mutation time
 *   - `expires_at`   — undo window closes (default 7d per D232; Pro
 *                       tier extends to 30d via app-side override on
 *                       insert — D81)
 *   - `executed_at`  — when the revert was triggered (POST /undo/:token)
 *   - `reverted_at`  — when the revert SUCCEEDED. Setting this is the
 *                      idempotency lock (atomic UPDATE … WHERE
 *                      reverted_at IS NULL RETURNING). Once set, the
 *                      handler returns the recorded result.
 *
 * Indexes:
 *   - `(mailbox_account_id, expires_at)`           — expiry sweeps AND
 *     active-token queries (the worker reads expired rows; the tray
 *     reads non-expired ones). One composite serves both.
 *   - `(mailbox_account_id, action_kind, created_at DESC)` — tray
 *     listing per D35 grouped by verb, newest first.
 *
 * Append-only by design except for the two terminal timestamps
 * (`executed_at`, `reverted_at`). Never UPDATEd for any other reason.
 *
 * No body data; D7 / D228 unchanged.
 */

export const undoActionKind = pgEnum('undo_action_kind', [
  'archive',
  'unsubscribe',
  'later',
  'apply-rule',
]);

export const undoJournal = pgTable(
  'undo_journal',
  {
    /** Random UUID — returned to client at mutation time; the URL token. */
    token: uuid('token').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    actionKind: undoActionKind('action_kind').notNull(),
    /**
     * Sufficient state to reverse the mutation: `message_ids[]`,
     * `prior_labels[]`, etc. Never body content (D7). Shape varies per
     * `action_kind` and is validated by the undo service.
     */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Default 7 days per D232. Pro-tier (D81 30-day undo) callers pass
     * an explicit `expires_at` on insert; the default keeps Free-tier
     * correct without app-side coordination.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    /** Set on POST /undo/:token entry (request received). */
    executedAt: timestamp('executed_at', { withTimezone: true, mode: 'date' }),
    /**
     * Set on revert success. The atomic
     * `UPDATE … WHERE reverted_at IS NULL RETURNING` IS the idempotency
     * lock: a second request whose UPDATE returns zero rows returns the
     * stored result instead of double-reverting.
     */
    revertedAt: timestamp('reverted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    /**
     * Powers BOTH directions on `expires_at`:
     *   - worker cleanup: `WHERE expires_at < now() - interval '1 day'`
     *   - active-tokens query: `WHERE expires_at > now()` (per mailbox)
     *   - D232 deletion read: `MAX(expires_at)` per mailbox
     */
    expiryIdx: index('undo_journal_account_expires_idx').on(
      table.mailboxAccountId,
      table.expiresAt,
    ),
    /** Persistent undo tray (D35) — newest-first list per verb. */
    trayIdx: index('undo_journal_account_action_created_idx').on(
      table.mailboxAccountId,
      table.actionKind,
      table.createdAt,
    ),
  }),
);

export type UndoJournalEntry = typeof undoJournal.$inferSelect;
export type NewUndoJournalEntry = typeof undoJournal.$inferInsert;
/**
 * Closed string union derived from the `undo_action_kind` pg_enum
 * (the source of truth). Replaces hand-rolled mirrors at the API
 * undo service / FE wire layers — adding a verb requires touching
 * the migration + this enum, which is the contract we want.
 */
export type UndoActionKind = (typeof undoActionKind.enumValues)[number];
