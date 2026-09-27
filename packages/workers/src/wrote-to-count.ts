import { mailMessages, senders } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';
import { sqlTextArray } from './sql-text-array.js';

/**
 * Recompute `senders.wrote_to_count` for the given senders of one mailbox.
 *
 * Counts DISTINCT outbound `mail_messages.id` ADDRESSED to each sender —
 * `recipient_emails` (To + Cc) matched against `senders.email` on the D12
 * normalized form (mig 0063, F010). Same statement as 0063's backfill, so
 * the migration, the initial sync, the incremental sync and the non-mail
 * purge all converge on one derived state.
 *
 * Zero FIRST. The rule credits strictly fewer senders than the
 * thread-membership join it replaced, so a sender that loses all its
 * evidence must fall to 0; an `UPDATE ... FROM` alone never reaches a row
 * with no matching group and would leave the stale count standing forever.
 * Both statements always run together: the zero-first pass on its own
 * would blank the counts it was scoped to.
 *
 * SCOPED, never the whole mailbox. A full-mailbox zero was the 4.5s / 1 GB
 * production cost when every incremental push rewrote every sender row and
 * then seq-scanned `mail_messages` to rebuild. An empty `senderKeys` does
 * nothing.
 */
export async function recomputeWroteToCount(
  tx: OutboxTx,
  mailboxAccountId: string,
  senderKeys: readonly string[],
): Promise<void> {
  if (senderKeys.length === 0) return;
  const keyArray = sqlTextArray(senderKeys);
  await tx.execute(sql`
    UPDATE ${senders} AS s
    SET ${sql.identifier('wrote_to_count')} = 0
    WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND s.${sql.identifier('sender_key')} = ANY(${keyArray})
      AND s.${sql.identifier('wrote_to_count')} <> 0
  `);
  await tx.execute(sql`
    UPDATE ${senders} AS s
    SET ${sql.identifier('wrote_to_count')} = sub.cnt
    FROM (
      SELECT
        m.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
        s2.${sql.identifier('sender_key')} AS sender_key,
        COUNT(DISTINCT m.${sql.identifier('id')})::integer AS cnt
      FROM ${mailMessages} AS m
      CROSS JOIN LATERAL unnest(m.${sql.identifier('recipient_emails')}) AS r(addr)
      JOIN ${senders} AS s2
        ON s2.${sql.identifier('mailbox_account_id')} = m.${sql.identifier('mailbox_account_id')}
       AND dm_normalize_email(s2.${sql.identifier('email')}::text) = dm_normalize_email(r.addr)
       AND s2.${sql.identifier('sender_key')} = ANY(${keyArray})
      WHERE m.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND m.${sql.identifier('is_outbound')} = true
      GROUP BY m.${sql.identifier('mailbox_account_id')}, s2.${sql.identifier('sender_key')}
    ) AS sub
    WHERE s.${sql.identifier('mailbox_account_id')} = sub.mailbox_account_id
      AND s.${sql.identifier('sender_key')} = sub.sender_key
  `);
}
