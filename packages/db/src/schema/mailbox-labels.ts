import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { mailboxAccounts } from './mailbox-accounts';

/**
 * Gmail label id → name, per mailbox (mig 0064, F012).
 *
 * WHY IT EXISTS. Gmail exposes exactly one engagement bit — the absence
 * of the `UNREAD` label — and any tool with API access can write it. We
 * already store `label_ids`, but an id like `Label_117` is opaque, so a
 * third-party sweeper's label was indistinguishable from any other. On
 * the founder's mailbox one such label carries 20,819 of the 75,689
 * messages we count as read: 27.5% of the read signal, manufactured.
 *
 * `sweeper_vendor` is DERIVED, never user-set: resolved from the
 * maintained list in `@declutrmail/shared/senders` at write time and
 * recomputed on every sync, so an update to that list reaches stored
 * rows instead of stranding them. `null` on every ordinary label.
 *
 * D7 / D228 — a label NAME is a Gmail field, newly fetched here via one
 * `users.labels.list` call per sync. It is registered in
 * `gmail-data-inventory.ts` (`gmail-label-names`). It is mailbox
 * metadata the user chose or a tool created; no body, no attachment, no
 * non-allowlisted header.
 *
 * Scoped per mailbox and cascade-deleted with it — a label id means
 * nothing outside the mailbox that issued it.
 */
export const mailboxLabels = pgTable(
  'mailbox_labels',
  {
    mailboxAccountId: uuid('mailbox_account_id')
      .notNull()
      .references(() => mailboxAccounts.id, { onDelete: 'cascade' }),
    /** Gmail's label id — matches the values in `mail_messages.label_ids`. */
    labelId: text('label_id').notNull(),
    /**
     * Display name as Gmail returns it. Case is preserved: Gmail label
     * names are case-sensitive and the casing may be the user's own.
     */
    name: text('name').notNull(),
    /**
     * Which known third-party sweeper this label belongs to
     * (`SWEEPER_VENDORS[].id`), or `null` for every ordinary label.
     */
    sweeperVendor: text('sweeper_vendor'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.mailboxAccountId, table.labelId] }),
    /**
     * The read-rate exclusion asks one question per mailbox — "which
     * label ids belong to a sweeper". Partial, because that is a handful
     * of rows out of a few hundred.
     */
    sweeperIdx: index('mailbox_labels_sweeper_idx')
      .on(table.mailboxAccountId, table.labelId)
      .where(sql`${table.sweeperVendor} IS NOT NULL`),
  }),
);

export type MailboxLabel = typeof mailboxLabels.$inferSelect;
export type NewMailboxLabel = typeof mailboxLabels.$inferInsert;
