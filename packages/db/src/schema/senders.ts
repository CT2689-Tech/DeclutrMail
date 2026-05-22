import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types.js';
import { mailboxAccounts } from './mailbox-accounts.js';

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
    gmailCategory: gmailCategory('gmail_category').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
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
  }),
);

export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
