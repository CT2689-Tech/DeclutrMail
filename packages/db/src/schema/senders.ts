import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { mailboxAccounts } from './mailbox-accounts';

/**
 * Senders — one row per distinct sender within a mailbox account.
 *
 * The sender registry the Senders screen renders. Each row is keyed by
 * `sender_key` = sha256("v1|" + normalized_email) per D12 / ADR-0011 —
 * the hash is computed app-side by the sync worker and stored here as
 * hex text. A sender is one email address, not one domain.
 *
 * `gmail_category` is the sender's dominant Gmail category, taken from
 * Gmail's own CATEGORY_* labels on its messages. This is NOT a predicted
 * category — D222 bans category prediction; we only mirror the label
 * Gmail itself assigned.
 *
 * `first_seen_at` / `last_seen_at` are the earliest / latest
 * `internal_date` across this sender's messages — they drive the
 * relationship-age stat on the Senders screen. Both are maintained by
 * the `building_sender_index` sync stage (D224).
 *
 * No body data; D7 storage allowlist honored — only sender identity and
 * Gmail-assigned metadata.
 */

export const gmailCategory = pgEnum('gmail_category', [
  'primary',
  'promotions',
  'social',
  'updates',
  'forums',
]);

/**
 * Per-sender unsubscribe capability — derived by
 * `building_sender_index` from `mail_messages.unsubscribe_url` +
 * `unsubscribe_one_click` across the sender's messages (D9, RFC 8058):
 *   - `one_click` — at least one message carries the `One-Click` flag.
 *   - `mailto`    — has a List-Unsubscribe URL but no one-click capability.
 *   - `none`      — no `List-Unsubscribe` header seen.
 * Powers the D9 "auto-try RFC 8058 → mailto → fallback" path.
 */
export const gmailUnsubscribeMethod = pgEnum('gmail_unsubscribe_method', [
  'one_click',
  'mailto',
  'none',
]);

export const senders = pgTable(
  'senders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** sha256("v1|" + normalized_email), hex — D12 / ADR-0011. */
    senderKey: text('sender_key').notNull(),
    /** Display name from the From header; may be empty for bare addresses. */
    displayName: text('display_name').notNull().default(''),
    /** Normalized sender address — citext so casing never splits identity. */
    email: citext('email').notNull(),
    /** Domain part of `email` — drives the D41 Gmail domain search link. */
    domain: text('domain').notNull(),
    /**
     * Registrable domain (eTLD+1) of `domain` — GENERATED STORED from the
     * IMMUTABLE `dm_registrable_domain` SQL function (migration 0047, D247).
     * `mail.google.com` and `news.google.com` both resolve to `google.com`
     * so a brand's many subdomain/address rows collapse into ONE server-side
     * brand card. The SQL function is the single source of truth for eTLD+1.
     * Consumer providers (gmail.com, …) resolve to themselves and are
     * excluded from grouping at query time, not here.
     */
    registrableDomain: text('registrable_domain').generatedAlwaysAs(
      sql`dm_registrable_domain("domain")`,
    ),
    gmailCategory: gmailCategory('gmail_category').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    /**
     * Best unsubscribe method across this sender's messages
     * (`one_click > mailto > none`). NULL until `building_sender_index`
     * has run for the sender. Drives the D9 unsubscribe action's UX +
     * automation path.
     */
    unsubscribeMethod: gmailUnsubscribeMethod('unsubscribe_method'),
    /**
     * URL to use when the user invokes Unsubscribe — `https://...` for
     * one-click, `mailto:...` otherwise. NULL when no message has a
     * `List-Unsubscribe` header.
     */
    unsubscribeUrl: text('unsubscribe_url'),
    /**
     * Denormalised count of inbound (`is_outbound = false`) messages
     * synced from this sender, lifetime within retention (ADR-0014).
     * Maintained on two write paths:
     *   A. authoritatively on `InitialSyncWorker.buildSenderIndex`
     *      (full rebuild — closes drift atomically), and
     *   B. idempotently on incremental ingest via the message upsert's
     *      `(xmax = 0) AS inserted` signal (Slice 1 follow-up).
     * Reconciled nightly by `senders-counter-reconciliation` which emits
     * the `senders.counter_drift` metric (D159).
     *
     * Inbox state (archive / read / label) never changes this — counts
     * are "how many has this sender ever sent me", not "how many are
     * in inbox right now". `mode: 'number'` because counts are bounded
     * far below `Number.MAX_SAFE_INTEGER` (2^53) and the wire shape per
     * the senders list contract is a JSON number, not a `bigint` string.
     */
    totalReceived: bigint('total_received', { mode: 'number' }).notNull().default(0),
    /**
     * Denormalised count of OUTBOUND messages whose thread contains
     * ≥1 inbound message from this sender — the "user replied to this
     * sender" signal materialised for hot-path reads (Senders V2 spec
     * v1.3 §"Trust-canary CI fixture", compose-strip `you replied` axis,
     * score-cascade Rule 2 future fast path). Counts DISTINCT outbound
     * `mail_messages.id` per sender; equals
     * `SUM(sender_timeseries.reply_count)` across months so the two
     * denorms reconcile arithmetically.
     *
     * Maintained on two write paths (mirrors `totalReceived`):
     *   A. authoritatively on `InitialSyncWorker.buildSenderIndex`
     *      (full rebuild — closes drift atomically), and
     *   B. idempotently on incremental ingest by
     *      `IncrementalSyncWorker` (per-job upsert deltas).
     *
     * Automatic protection uses conservative, explainable evidence:
     * `replied_count >= 3`, a recent starred message, or at least three
     * recent Gmail-important messages. The exact basis is stored in
     * `sender_policies.protection_reason`. The flip is sticky — later
     * signal changes do NOT unprotect.
     *
     * User-agency-wins semantic (flow-completeness-auditor 2026-06-05
     * 🔴-3, founder-defaulted): the auto-protect UPSERT respects a
     * MANUAL demote of an automatically protected row. If the user
     * flips `is_protected=false`, the exact non-null reason remains as
     * a memory pin and subsequent syncs do NOT re-protect. Fresh
     * unprotected rows (NULL reason) still pick up strong evidence.
     * Encoded once in `automatic-protection.ts`.
     *
     * `mode: 'number'` because counts are bounded far below 2^53 and
     * the wire shape per the senders list contract is a JSON number,
     * not a `bigint` string.
     */
    repliedCount: integer('replied_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    senderKeyUniq: uniqueIndex('senders_account_sender_key_uniq').on(
      table.mailboxAccountId,
      table.senderKey,
    ),
    categoryIdx: index('senders_account_category_idx').on(
      table.mailboxAccountId,
      table.gmailCategory,
    ),
    /**
     * Supports the D247 brand-grouping aggregation: `GROUP BY
     * registrable_domain` within a mailbox account (server-side brand cards).
     */
    registrableDomainIdx: index('senders_account_registrable_domain_idx').on(
      table.mailboxAccountId,
      table.registrableDomain,
    ),
    /**
     * Keyset index for the default `Total ↓` sort on the Senders list
     * (ADR-0014 + `docs/api/senders-list-contract.md`). Direction
     * matches the cursor comparison `(total_received, id) <
     * (cursor.total, cursor.id)` so the planner stays on the index.
     */
    totalReceivedIdx: index('senders_account_total_received_idx').on(
      table.mailboxAccountId,
      table.totalReceived.desc(),
      table.id.desc(),
    ),
    /**
     * `deriveUnsubscribe` invariant (initial-sync.worker.ts, migration
     * 0032): `unsubscribe_method` + `unsubscribe_url` always agree on
     * scheme — one_click ⇒ https://, mailto ⇒ mailto:, none/NULL ⇒ NULL.
     *
     * A simple `CASE` (not an OR chain) because `unsubscribe_method` is
     * nullable: an OR of `method = 'one_click'` clauses evaluates to
     * NULL when `method IS NULL`, and Postgres passes a CHECK whose body
     * is NULL — so a `(NULL method, non-NULL url)` row would slip
     * through. `CASE` is total (every branch returns a real boolean);
     * NULL and 'none' both fall to the ELSE, which demands a NULL url.
     */
    unsubMethodUrlAligned: check(
      'senders_unsub_method_url_aligned_chk',
      sql`CASE ${table.unsubscribeMethod} WHEN 'one_click' THEN ${table.unsubscribeUrl} LIKE 'https://%' WHEN 'mailto' THEN ${table.unsubscribeUrl} LIKE 'mailto:%' ELSE ${table.unsubscribeUrl} IS NULL END`,
    ),
  }),
);

export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
