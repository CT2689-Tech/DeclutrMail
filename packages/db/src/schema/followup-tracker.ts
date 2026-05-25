import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { mailboxAccounts } from './mailbox-accounts';
import { workspaces } from './workspaces';

/**
 * Followup tracker — D84, D85, D87, D88.
 *
 * One row per user-sent thread that has NOT yet been replied to.
 *
 * The Followups feature surfaces "threads where YOU sent a message and
 * the recipient hasn't replied", so the user can chase up high-value
 * correspondence. Direction of interest is OUTBOUND — the user is the
 * sender, the recipient is the one we're waiting on. (Contrast: the
 * Senders / Triage features look at INBOUND mail and decide what to do
 * with it.)
 *
 * `FollowupCheckWorker` (a future PR) is a 6h cron that scans recent
 * sent messages and upserts here. The check applies D86's exclusion
 * rules — bulk recipients (>5 addresses), mailing-list patterns,
 * threads to senders the user has marked Archive/Unsubscribe in
 * DeclutrMail, auto-response threads, promotional senders, and threads
 * where any later message is from the recipient (already replied).
 *
 * Status enum (D87):
 *   - `awaiting`  — no reply yet; surfaces in the Followups list
 *   - `replied`   — recipient has responded; row stays for audit, hidden
 *                   from the active list
 *   - `dismissed` — user clicked "Mark resolved" per D88; same as
 *                   replied for display purposes but distinct
 *                   provenance (logged to Activity per D88)
 *
 * Priority (D85) is computed at API request time from `sent_at`:
 *   - High:   sent_at > 7 days ago
 *   - Medium: 3–7 days ago
 *   - Low:    1–3 days ago
 * Stored as a generated column? No — D85 specifies "Re-computed at API
 * request time from `mail_messages.sent_at`" so the value is always
 * fresh. The read service derives the bucket inline.
 *
 * Privacy (D7, D228):
 *   - `subject` is on the storage allowlist (D7)
 *   - `recipient_email` is metadata (To header — D7 amended allowlist
 *     post-2026-05-22 ADR-0004)
 *   - `recipient_display_name` is metadata (parsed from the To header)
 *   - `provider_thread_id` is Gmail's identifier; metadata only
 *   - NO body content, NO snippet, NO attachments
 *
 * Indexing:
 *   - UNIQUE `(mailbox_account_id, provider_thread_id)` — per D87, the
 *     dedup key for the upsert worker. One row per thread per mailbox.
 *   - `(mailbox_account_id, status, sent_at DESC)` partial WHERE
 *     `status = 'awaiting'` — the hot read path on the Followups
 *     screen lists awaiting threads sorted by age. Partial keeps the
 *     index footprint bounded by the active backlog rather than the
 *     full historical record.
 */

export const followupStatus = pgEnum('followup_status', ['awaiting', 'replied', 'dismissed']);

export const followupTracker = pgTable(
  'followup_tracker',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalized from `mailbox_accounts.workspace_id` so future
     * per-workspace queries (cross-mailbox audit) do not need an extra
     * join. ON DELETE CASCADE so workspace removal is clean.
     */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** Gmail thread id — the dedup anchor (D87 unique key). */
    providerThreadId: text('provider_thread_id').notNull(),
    /** citext so casing variants don't split identity. */
    recipientEmail: citext('recipient_email').notNull(),
    /** Display name from the To header; may be empty for bare addresses. */
    recipientDisplayName: text('recipient_display_name').notNull().default(''),
    /** Allowlisted by D7 (metadata only — not body). */
    subject: text('subject').notNull().default(''),
    /**
     * When the user sent the thread's first / most-recent outbound
     * message we're waiting on. Drives D85's priority bucket and the
     * UI's relative-time display.
     */
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull(),
    /**
     * Wall-clock when the FollowupCheckWorker last evaluated this
     * thread. Lets the worker prefer threads it hasn't touched in
     * a while when the backlog is large.
     */
    lastCheckAt: timestamp('last_check_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    status: followupStatus('status').notNull().default('awaiting'),
    /**
     * Set when the user clicks "Mark resolved" (D88). NULL while
     * `status = 'awaiting' | 'replied'`. The dismissal logs an
     * `activity_log` row separately (D88).
     */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** D87 — one row per (mailbox, thread). Worker upserts on this key. */
    mailboxThreadUniq: uniqueIndex('followup_tracker_mailbox_thread_uniq').on(
      table.mailboxAccountId,
      table.providerThreadId,
    ),
    /**
     * Partial index for the awaiting-list read path. The Followups
     * screen reads `WHERE mailbox_account_id = $1 AND status =
     * 'awaiting' ORDER BY sent_at DESC` — this index covers the
     * predicate + sort without touching the full table.
     */
    awaitingIdx: index('followup_tracker_awaiting_idx')
      .on(table.mailboxAccountId, table.sentAt)
      .where(sql`${table.status} = 'awaiting'`),
  }),
);

export type FollowupTracker = typeof followupTracker.$inferSelect;
export type NewFollowupTracker = typeof followupTracker.$inferInsert;
export type FollowupStatus = (typeof followupStatus.enumValues)[number];
