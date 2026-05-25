import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Mail messages — the metadata mirror of a connected Gmail mailbox.
 *
 * PRIVACY — D7 / D228. This table stores ONLY the storage allowlist:
 *   - sender identity (via `sender_key` → senders.email / display name)
 *   - `subject`
 *   - `snippet` (Gmail's own short preview)
 *   - dates (`internal_date`)
 *   - Gmail `label_ids`
 *   - read/unread state (`is_unread`)
 *
 * It NEVER stores: full message bodies (HTML or plain text), attachments,
 * inline images, raw MIME, attachment sizes/filenames, message
 * `sizeEstimate`, or any header outside the allowlist. The sync worker
 * fetches Gmail messages with `format=metadata` — bodies are never
 * fetched, preserving the "Full bodies fetched: 0" trust artifact.
 *
 * `provider_message_id` is Gmail's message id — it powers the D41
 * open-in-Gmail deep link and is the dedup key for at-least-once
 * Pub/Sub delivery (D229). `(mailbox_account_id, provider_message_id)`
 * is unique so a redelivered history event cannot double-insert.
 *
 * `sender_key` is denormalized here (not a FK) because a message may be
 * ingested before its `senders` row is materialized by the
 * `building_sender_index` stage (D224). It carries the same D12 hash.
 *
 * D7 ALLOWLIST AMENDMENT (2026-05-22, ADR-0004). Columns added:
 *   - `is_outbound` — derived from `label_ids.includes('SENT')`. Lets
 *     `building_sender_index` filter to inbound; outbound messages still
 *     store full metadata for future reply-attribution (D9 area) so no
 *     re-sync is needed when that engine lands.
 *   - `recipient_emails` — To + Cc parsed and combined; populated for
 *     OUTBOUND only. Reserved for the future Sent-sync / reply-attribution
 *     engine. The `To`/`Cc` headers are on the amended allowlist.
 *   - `unsubscribe_url` / `unsubscribe_mailto_url` /
 *     `unsubscribe_one_click` — `List-Unsubscribe` +
 *     `List-Unsubscribe-Post` parsed by CHANNEL (Codex iter 5 fix; D9,
 *     RFC 8058). The HTTPS URL and the mailto URL are kept in
 *     separate columns so `building_sender_index` can detect "this
 *     sender had a mailto channel" independently of "this sender had
 *     a usable HTTPS channel" — the prior single-column shape
 *     misclassified plain-HTTPS senders as `method='mailto'` while
 *     persisting a `https://` URL (a sender-table mismatch).
 */

export const mailMessages = pgTable(
  'mail_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** Gmail message id — D41 deep link + Pub/Sub dedup key. */
    providerMessageId: text('provider_message_id').notNull(),
    /** Gmail thread id — message grouping; not a body or header. */
    providerThreadId: text('provider_thread_id').notNull(),
    /** sha256("v1|" + normalized_email), hex — matches senders.sender_key. */
    senderKey: text('sender_key').notNull(),
    subject: text('subject').notNull().default(''),
    /**
     * Gmail's own snippet — explicitly allowlisted by D7. Capped at
     * varchar(300) so the privacy boundary is enforced by the column
     * type: a body cannot be smuggled in even via a buggy sync worker.
     * Gmail's API snippet is ~160-200 chars; 300 is generous headroom.
     */
    snippet: varchar('snippet', { length: 300 }).notNull().default(''),
    internalDate: timestamp('internal_date', { withTimezone: true, mode: 'date' }).notNull(),
    /** Gmail label ids (INBOX, CATEGORY_*, UNREAD, …). */
    labelIds: text('label_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Derived from the presence of the UNREAD label — D7 read state. */
    isUnread: boolean('is_unread').notNull(),
    /**
     * Derived from `label_ids.includes('SENT')` at fetch time. Outbound
     * messages are stored (for future reply attribution) but excluded
     * from `building_sender_index` — their `From` is the user themself,
     * not a third-party sender.
     *
     * Deliberately UNINDEXED. `building_sender_index` selects with
     * `WHERE mailbox_account_id = ? AND is_outbound = false` — the
     * predicate matches the inbound MAJORITY (~70–90% of rows), so a
     * partial index would pay a write-amplification tax per INSERT for
     * essentially no read win. The existing `(mailbox_account_id, …)`
     * indexes prefix-match the mailbox filter; the planner heap-filters
     * `is_outbound` from there. Reviewed + intentional (D150 pattern is
     * for SELECTIVE predicates, e.g. `is_unread = true`).
     */
    isOutbound: boolean('is_outbound').notNull().default(false),
    /**
     * To + Cc emails parsed and combined. NULL for inbound; reserved for
     * the future Sent-sync / reply-attribution engine on outbound
     * messages (D9 area). Header allowlist amendment per ADR-0004.
     */
    recipientEmails: text('recipient_emails').array(),
    /**
     * `https://...` URL parsed from `List-Unsubscribe`. NULL when the
     * header is absent or carries only a mailto/insecure URL. Cleartext
     * `http://` is dropped (RFC 8058 §3 — downgrade-vulnerable).
     * Required to be HTTPS when `unsubscribe_one_click=true`. Header
     * allowlist amendment per ADR-0004; powers D9.
     */
    unsubscribeUrl: text('unsubscribe_url'),
    /**
     * `mailto:` URL parsed from `List-Unsubscribe`. NULL when the
     * header is absent or carries only an HTTPS form. Kept in its own
     * column so `building_sender_index` can detect a mailto channel
     * independently of the HTTPS channel (Codex iter 5 fix).
     */
    unsubscribeMailtoUrl: text('unsubscribe_mailto_url'),
    /**
     * Derived from `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
     * AND the presence of an HTTPS URL (RFC 8058 — mailto-only senders
     * can never be one-click). Header allowlist amendment per
     * ADR-0004.
     */
    unsubscribeOneClick: boolean('unsubscribe_one_click').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    providerMessageUniq: uniqueIndex('mail_messages_account_provider_message_uniq').on(
      table.mailboxAccountId,
      table.providerMessageId,
    ),
    senderDateIdx: index('mail_messages_account_sender_date_idx').on(
      table.mailboxAccountId,
      table.senderKey,
      table.internalDate,
    ),
    accountDateIdx: index('mail_messages_account_date_idx').on(
      table.mailboxAccountId,
      table.internalDate,
    ),
    /**
     * Keyset pagination index for `building_sender_index` (Codex iter 5,
     * 2026-05-22). The stage streams the mailbox's stored messages with
     * `WHERE mailbox_account_id = ? AND id > ? ORDER BY id LIMIT ?` to
     * cap in-process memory; without this composite index, each page
     * triggered a heap scan + sort over the whole mailbox. The id PK
     * is a UUID v4 (random) — index access is sequential by storage
     * order, not chronological, which is fine: aggregates fold in any
     * order.
     */
    accountIdIdx: index('mail_messages_account_id_idx').on(table.mailboxAccountId, table.id),
    /** Partial index — the per-sender unread count is a hot Senders query. */
    unreadIdx: index('mail_messages_account_sender_unread_idx')
      .on(table.mailboxAccountId, table.senderKey)
      .where(sql`${table.isUnread} = true`),
    /**
     * Thread-grouped lookup index — needed by `FollowupCheckWorker`
     * (D87) for its `DISTINCT ON (provider_thread_id) ... ORDER BY
     * provider_thread_id, internal_date DESC` CTE and its
     * `flipReplied` EXISTS subquery (selective on
     * `provider_thread_id`). The existing
     * `mail_messages_account_date_idx` cannot satisfy either pattern
     * — its sort order is by date, not thread. Added in migration
     * 0011 as a performance fix-up for the followup check worker;
     * future thread-grouped read paths (e.g. Senders detail thread
     * view) reuse the same index.
     */
    accountThreadDateIdx: index('mail_messages_account_thread_date_idx').on(
      table.mailboxAccountId,
      table.providerThreadId,
      table.internalDate,
    ),
  }),
);

export type MailMessage = typeof mailMessages.$inferSelect;
export type NewMailMessage = typeof mailMessages.$inferInsert;
