import { mailboxLabels } from '@declutrmail/db';
import { sweeperVendorForLabel } from '@declutrmail/shared/senders';
import { and, eq, notInArray, sql } from 'drizzle-orm';

import type { GmailMetadataClient } from './ports.js';
import type { OutboxTx } from './outbox-publisher.js';

/** What one label-sync pass did, for the `worker.succeeded` log line. */
export interface MailboxLabelSyncResult {
  /** Labels Gmail reported. */
  total: number;
  /** Of those, how many belong to a known third-party sweeper. */
  sweeper: number;
  /** Rows removed because the label no longer exists in Gmail. */
  pruned: number;
}

/**
 * Refresh `mailbox_labels` from `users.labels.list` (mig 0064, F012).
 *
 * One call per sync, 5 quota units. It exists so a manufactured read
 * signal can be NAMED: we store `label_ids`, so a sweeper's label reads
 * as `Label_117` and is indistinguishable from any other. On the
 * founder's mailbox that one label carries 27.5% of the messages we
 * count as read.
 *
 * `sweeper_vendor` is recomputed on EVERY pass rather than written once.
 * The vendor list is maintained in `@declutrmail/shared/senders`, and a
 * write-once column would strand existing rows on the list as it stood
 * the day they were created — so adding a vendor would silently apply
 * only to mailboxes connected afterwards.
 *
 * ## An absent listing is not an empty mailbox
 *
 * When the client cannot list labels (an older port implementation, a
 * test double), this returns `null` and touches nothing. Treating "we
 * did not ask" as "there are none" would delete every sweeper row, which
 * silently un-excludes the sweeper's marks and pushes its senders back
 * toward looking engaged — the null-becomes-zero mistake pointed at a
 * signal that feeds a destructive verb.
 *
 * Pruning is likewise scoped to a listing we actually received: rows
 * whose label id is absent from a non-empty response are gone from Gmail
 * (the user deleted the label) and would otherwise exclude read state
 * forever on an id that no longer exists.
 *
 * D7 / D228: label ids and names only. No body, no snippet, no header.
 */
export async function syncMailboxLabels(
  tx: OutboxTx,
  mailboxAccountId: string,
  client: GmailMetadataClient,
): Promise<MailboxLabelSyncResult | null> {
  if (!client.listLabels) return null;
  const labels = await client.listLabels();
  if (labels.length === 0) {
    // Gmail always returns the system labels (INBOX, SENT, …), so an
    // empty array is a malformed or failed response, never a mailbox
    // with no labels. Leave the table alone.
    return null;
  }

  const rows = labels.map((label) => ({
    mailboxAccountId,
    labelId: label.id,
    name: label.name,
    sweeperVendor: sweeperVendorForLabel(label.name)?.id ?? null,
  }));

  await tx
    .insert(mailboxLabels)
    .values(rows)
    .onConflictDoUpdate({
      target: [mailboxLabels.mailboxAccountId, mailboxLabels.labelId],
      set: {
        name: sql`excluded.name`,
        // Recomputed, not preserved — see the note above.
        sweeperVendor: sql`excluded.sweeper_vendor`,
        updatedAt: sql`now()`,
      },
    });

  const pruned = await tx
    .delete(mailboxLabels)
    .where(
      and(
        eq(mailboxLabels.mailboxAccountId, mailboxAccountId),
        notInArray(
          mailboxLabels.labelId,
          rows.map((r) => r.labelId),
        ),
      ),
    )
    .returning({ labelId: mailboxLabels.labelId });

  return {
    total: rows.length,
    sweeper: rows.filter((r) => r.sweeperVendor !== null).length,
    pruned: pruned.length,
  };
}
