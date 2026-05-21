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
    labelIds: text('label_ids').array().notNull().default(sql`'{}'::text[]`),
    /** Derived from the presence of the UNREAD label — D7 read state. */
    isUnread: boolean('is_unread').notNull(),
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
    /** Partial index — the per-sender unread count is a hot Senders query. */
    unreadIdx: index('mail_messages_account_sender_unread_idx')
      .on(table.mailboxAccountId, table.senderKey)
      .where(sql`${table.isUnread} = true`),
  }),
);

export type MailMessage = typeof mailMessages.$inferSelect;
export type NewMailMessage = typeof mailMessages.$inferInsert;
