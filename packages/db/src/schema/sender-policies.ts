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
     * Why protection is set (D22). NULL when `is_protected = false`;
     * callers ensure non-null whenever `is_protected = true` (no DB
     * CHECK — kept additive for the migration; the engine code path
     * never sets one without the other).
     */
    protectionReason: protectionReason('protection_reason'),
    /** When `is_protected` last flipped true. NULL when not protected. */
    protectionSetAt: timestamp('protection_set_at', { withTimezone: true, mode: 'date' }),
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
