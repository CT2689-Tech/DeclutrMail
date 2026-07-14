import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Durable request to erase one mailbox's indexed Gmail data while
 * retaining the `mailbox_accounts` identity stub for reconnect.
 *
 * `failed` is retryable: the deletion sweep claims pending, failed,
 * and stranded executing requests. The partial unique index therefore
 * treats all three as active and permits a new request only after the
 * prior one completed.
 */
export const mailboxDataDeletionStatus = pgEnum('mailbox_data_deletion_status', [
  'pending',
  'executing',
  'completed',
  'failed',
]);

export const mailboxDataDeletionRequests = pgTable(
  'mailbox_data_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    status: mailboxDataDeletionStatus('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    executedAt: timestamp('executed_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    /** Controlled error class/code only; never raw provider or caller text. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /** One retryable/in-flight erase per mailbox. */
    mailboxActiveUniq: uniqueIndex('mailbox_data_deletion_requests_mailbox_active_uniq')
      .on(table.mailboxAccountId)
      .where(sql`${table.status} IN ('pending', 'executing', 'failed')`),
    /** Sweep pending/failed requests and detect stranded executing rows. */
    statusUpdatedIdx: index('mailbox_data_deletion_requests_status_updated_idx').on(
      table.status,
      table.updatedAt,
    ),
  }),
);

export type MailboxDataDeletionRequest = typeof mailboxDataDeletionRequests.$inferSelect;
export type NewMailboxDataDeletionRequest = typeof mailboxDataDeletionRequests.$inferInsert;
export type MailboxDataDeletionStatus = (typeof mailboxDataDeletionStatus.enumValues)[number];
