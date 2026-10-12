import { sql } from 'drizzle-orm';

/**
 * Drop the cached Inbox Report for one mailbox.
 *
 * The cache row is replaced on the next read. Incremental sync does not
 * write a succeeded `sync_runs` row, and archive/delete change mail
 * without one, so those writers delete the row themselves.
 */
export async function invalidateInboxReportCache(
  db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  mailboxAccountId: string,
): Promise<void> {
  await db.execute(
    sql`delete from "inbox_report_cache" where "mailbox_account_id" = ${mailboxAccountId}`,
  );
}
