import { sql } from 'drizzle-orm';
import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Cached Inbox Report aggregate for one mailbox.
 *
 * The payload is the computed report: counts, sums, and the sender ids
 * the fix set needs. It holds no subject, snippet, body, or per-message
 * row. A newer succeeded sync run replaces it on the next read.
 */
export const inboxReportCache = pgTable('inbox_report_cache', {
  mailboxAccountId: uuid('mailbox_account_id')
    .primaryKey()
    .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  sourceSyncRunId: uuid('source_sync_run_id'),
  generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
});
