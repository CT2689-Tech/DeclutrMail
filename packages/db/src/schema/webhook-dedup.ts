import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Webhook dedup table (D8, D229 step 7).
 *
 * Pub/Sub delivers at-least-once: the same `messageId` can arrive
 * multiple times within Google's ack-deadline window (or after a
 * retry storm). DeclutrMail's Gmail push webhook MUST be idempotent
 * per messageId; this table is the durable dedup store backing the
 * `Authorization: Bearer`-verified handler.
 *
 * Contract:
 *   - `message_id` is the Pub/Sub envelope `message.messageId` —
 *     a globally-unique string assigned by Pub/Sub at publish time.
 *     PRIMARY KEY → an `INSERT ... ON CONFLICT DO NOTHING` is the
 *     atomic dedup gate. If the insert affects 0 rows, the message
 *     has already been processed; respond 200 (silent ack) and exit.
 *   - `mailbox_account_id` is the resolved mailbox at process time;
 *     nullable because the dedup row is written BEFORE the mailbox
 *     lookup in some paths (defense in depth — same messageId never
 *     re-enters the pipeline regardless of which mailbox it routed
 *     to).
 *   - `received_at` is `now()` at insert.
 *   - `expires_at` is `received_at + 24h`. A separate cleanup worker
 *     (deferred; not part of this PR) reaps rows past `expires_at`
 *     in batches. The 24h window comfortably exceeds Pub/Sub's
 *     maximum ack deadline (10 minutes) and Google's documented
 *     retry horizon for unacked messages.
 *
 * Index `webhook_dedup_expires_at_idx` powers the cleanup worker's
 * `WHERE expires_at < now()` scan without a sequential scan over
 * the entire table.
 *
 * Privacy (D7, D228): no message body, no headers, no Gmail content
 * — only the Pub/Sub envelope's opaque messageId and bookkeeping
 * timestamps.
 */
export const webhookDedup = pgTable(
  'webhook_dedup',
  {
    /** Pub/Sub `message.messageId`. PK → atomic dedup via ON CONFLICT. */
    messageId: text('message_id').primaryKey(),
    /** Resolved mailbox (nullable until lookup completes). */
    mailboxAccountId: uuid('mailbox_account_id').references(() => mailboxAccounts.id, {
      onDelete: 'cascade',
    }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** TTL — cleanup worker reaps rows past this timestamp. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index('webhook_dedup_expires_at_idx').on(table.expiresAt),
  }),
);

export type WebhookDedup = typeof webhookDedup.$inferSelect;
export type NewWebhookDedup = typeof webhookDedup.$inferInsert;
