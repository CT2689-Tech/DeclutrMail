import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Sender policies — standing per-sender decisions and modifiers (D42).
 *
 * A row exists once the user has made a standing decision about a
 * sender. Senders with no row are engine-default.
 *
 * `policy_type` is the standing verdict — the four canonical verbs of
 * D227 (Keep / Archive / Unsubscribe / Later).
 *
 * `is_vip` and `is_protected` are the two distinct standing modifiers of
 * D42. Both override the engine verdict to Keep when true:
 *   - VIP      — elevational: badge + always in Brief.
 *   - Protect  — defensive: silent guard, no badge, not in Brief.
 * They are independent — a sender can be neither, either, or both.
 *
 * `protection_reason` + `protection_set_at` (D22) record HOW protection
 * was granted — the decision engine reads `(is_protected, protection_reason)`
 * as cascade rule #1 (D21 Phase A) and the value drives the audit copy
 * ("Protected because you marked them VIP"). NULL when `is_protected =
 * false`; populated whenever `is_protected` flips true.
 *
 * `(mailbox_account_id, sender_key)` is unique — one policy row per
 * sender per mailbox.
 *
 * No body data; no privacy concerns.
 */

export const senderPolicyType = pgEnum('sender_policy_type', [
  'keep',
  'archive',
  'unsubscribe',
  'later',
]);

/**
 * Provenance of a `is_protected=true` flag (D22).
 *
 * Three sources, used by the cascade audit copy:
 *   - `user_defined`     — explicit Always-Keep toggle on Sender Detail.
 *   - `engagement_based` — derived from D21 Phase A rules (replied,
 *                          starred, high read rate, long relationship).
 *   - `vip`              — auto-applied when `is_vip` flips true.
 *
 * No `ml_predicted` value — D222 bans ML category prediction; protection
 * is always observed (engagement) or user-set, never inferred.
 */
export const protectionReason = pgEnum('protection_reason', [
  'user_defined',
  'engagement_based',
  'vip',
]);

/**
 * Unsubscribe execution status (D9 Wave 2, migration 0029).
 *
 * Tracks the RFC 8058 one-click execution outcome for a sender whose
 * intent was recorded with `policy_type = 'unsubscribe'`:
 *   - `pending`   — execution job queued / in flight.
 *   - `done`      — target answered 2xx; unsubscribed.
 *   - `failed`    — terminal: target 4xx/5xx, blocked URL, or network
 *                   retries exhausted. Never auto-retried past that.
 *   - `ambiguous` — target answered 3xx; redirects are not followed
 *                   (SSRF posture), so the outcome is unknown.
 *
 * NULL = no tracked execution (mailto-manual per D230, method 'none',
 * or a policy row that predates the pipeline). No undo linkage (D58) —
 * a delivered network unsubscribe is one-way by design.
 */
export const unsubStatus = pgEnum('unsub_status', ['pending', 'done', 'failed', 'ambiguous']);

export const senderPolicies = pgTable(
  'sender_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    policyType: senderPolicyType('policy_type').notNull().default('keep'),
    isVip: boolean('is_vip').notNull().default(false),
    isProtected: boolean('is_protected').notNull().default(false),
    /**
     * Why protection is set (D22). Populated whenever `is_protected = true`.
     *
     * MAY be non-NULL while `is_protected = false` — the
     * **user-agency-wins memory pin**: when the user manually demotes
     * an `engagement_based`-protected row, the worker leaves
     * `protection_reason='engagement_based'` so the next sync skips
     * re-protect (initial-sync.worker.ts:660-705,
     * incremental-sync.worker.ts §3, schema/senders.ts:133-142,
     * MISTAKES.md 2026-06-05 🔴-3).
     *
     * **DB INVARIANT** (migration 0023): a one-way CHECK enforces the
     * only impossible-by-code state:
     *
     *     CHECK (NOT is_protected OR protection_reason IS NOT NULL)
     *
     * "If protected, reason MUST be recorded." The biconditional
     * (`is_protected = (reason IS NOT NULL)`) is intentionally NOT
     * enforced because it would forbid the memory-pin state.
     */
    protectionReason: protectionReason('protection_reason'),
    /** When `is_protected` last flipped true. NULL when not protected. */
    protectionSetAt: timestamp('protection_set_at', { withTimezone: true, mode: 'date' }),
    /**
     * RFC 8058 one-click execution outcome (migration 0029). See the
     * `unsub_status` enum doc. Written 'pending' when an unsubscribe
     * intent is recorded for a `one_click` sender; flipped to its
     * terminal value by `UnsubExecutionWorker`. NULL for mailto/none
     * senders (D230 manual path — no claimed outcome).
     */
    unsubStatus: unsubStatus('unsub_status'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    senderUniq: uniqueIndex('sender_policies_account_sender_key_uniq').on(
      table.mailboxAccountId,
      table.senderKey,
    ),
  }),
);

export type SenderPolicy = typeof senderPolicies.$inferSelect;
export type NewSenderPolicy = typeof senderPolicies.$inferInsert;
