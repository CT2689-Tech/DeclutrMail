import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
 * `is_protected` is the standing defensive modifier. It overrides the
 * engine verdict to Keep and prevents accidental bulk actions.
 *
 * `protection_reason` + `protection_set_at` (D22) record HOW protection
 * was granted — the decision engine reads `(is_protected, protection_reason)`
 * as cascade rule #1 (D21 Phase A) and the value drives the audit copy.
 * NULL when `is_protected =
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
 * Two sources, used by the cascade audit copy:
 *   - `user_defined`     — explicit Always-Keep toggle on Sender Detail.
 *   - `engagement_based` — derived from D21 Phase A rules (replied,
 *                          starred, high read rate, long relationship).
 *
 * No `ml_predicted` value — D222 bans ML category prediction; protection
 * is always observed (engagement) or user-set, never inferred.
 */
export const protectionReason = pgEnum('protection_reason', ['user_defined', 'engagement_based']);

/**
 * Truthful unsubscribe lifecycle (D9 Wave 2 + D245, migrations 0029/0037).
 *
 * Canonical values:
 *   - `requested`          — RFC 8058 execution queued / in flight.
 *   - `endpoint_accepted`  — target answered 2xx. This proves request
 *                            delivery/acceptance, NOT that mail stopped.
 *   - `failed`             — terminal 4xx/5xx, blocked URL, or exhausted
 *                            network retry.
 *   - `unconfirmed`        — target answered 3xx; redirects are not
 *                            followed, so the result is unknown.
 *   - `action_required`    — mailto channel; the user must send a draft.
 *   - `draft_opened`       — the compose affordance was opened.
 *   - `user_marked_sent`   — the user explicitly reports sending it;
 *                            delivery remains unverified.
 *   - `unavailable`        — the sender published no usable channel.
 *
 * `pending`, `done`, and `ambiguous` remain in the DB enum for additive
 * rollout compatibility. API read boundaries normalize them to
 * `requested`, `endpoint_accepted`, and `unconfirmed`; new writes never
 * emit the legacy values. NULL is reserved for policy rows that predate
 * lifecycle tracking. No undo linkage (D58).
 */
export const unsubStatus = pgEnum('unsub_status', [
  // Legacy values retained for rolling-deploy/backfill compatibility.
  'pending',
  'done',
  'failed',
  'ambiguous',
  // Canonical lifecycle values (0037).
  'requested',
  'endpoint_accepted',
  'unconfirmed',
  'action_required',
  'draft_opened',
  'user_marked_sent',
  'unavailable',
]);

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
     * Unsubscribe lifecycle (migrations 0029/0037). See `unsub_status`
     * above. New intents always write a method-specific initial state;
     * one-click results and explicit manual-mailto progress advance it.
     */
    unsubStatus: unsubStatus('unsub_status'),
    /**
     * Sender snooze wake time (D78/D79 — sender-level only at launch).
     * Non-null = current Later-labeled mail has a scheduled return.
     * Future arrivals are unchanged (D245); the hourly
     * `SnoozeRestoreWorker` wake-scan (`WHERE snoozed_until <= now()`)
     * restores the label's messages and nulls all three snooze columns.
     */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'date' }),
    /** When the snooze was set; null when not snoozed (D79). */
    snoozedAt: timestamp('snoozed_at', { withTimezone: true, mode: 'date' }),
    /** Optional user note shown on the Snoozed screen row (D79/D80). */
    snoozedReason: text('snoozed_reason'),
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
    /**
     * Hourly wake-scan (D79): `WHERE snoozed_until <= now()` across all
     * mailboxes. Partial — only actively-snoozed rows are indexed, so
     * the index stays tiny relative to the policy table.
     */
    snoozeWakeIdx: index('sender_policies_snooze_wake_idx')
      .on(table.snoozedUntil)
      .where(sql`${table.snoozedUntil} IS NOT NULL`),
  }),
);

export type SenderPolicy = typeof senderPolicies.$inferSelect;
export type NewSenderPolicy = typeof senderPolicies.$inferInsert;
