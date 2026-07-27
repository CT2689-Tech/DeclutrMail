// @declutrmail/db — shared action-pipeline predicates (D226).
//
// THE meaning of "mail from this sender in the inbox" for the action
// pipeline. The 2026-07-26 action-surface investigation (finding 5.5)
// found the single-sender composite preview filtering `is_outbound`
// while enqueue counting, the bulk preview and both workers did not —
// so self-sent / self-CC mail (Gmail stores SENT alongside INBOX) was
// excluded from the preview but moved at execution. Preview, enqueue
// counting, bulk preview, worker resolution and receipts must resolve
// the SAME message set, so the predicate lives once, here, where the
// API (apps/api) and the workers (packages/workers) both import from.
//
// The set: owned by the mailbox, keyed to the sender(s), currently
// carrying INBOX, INBOUND ONLY (`is_outbound = false` — mail the user
// sent is not what a decision about a sender is about), optionally
// narrowed to messages older than N days (`internal_date`, Gmail's
// authoritative arrival timestamp — the same column every preview
// bucket filters on).
//
// Deliberately NOT applied to the `messages` selector (explicit
// user-picked provider ids): that path freezes its exact set at
// enqueue, previews it as-is, and executes the frozen ids — it is
// internally consistent and expresses direct message-level intent.

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { mailMessages } from './schema/mail-messages';

export interface SenderInboxActionScope {
  mailboxAccountId: string;
  /** One or more sha256 sender keys. */
  senderKeys: readonly string[];
  /** Only messages older than N days; null/undefined = whole inbox. */
  olderThanDays?: number | null | undefined;
}

/** WHERE clause for the sender-action message set — see module doc. */
export function senderInboxActionWhere(scope: SenderInboxActionScope): SQL {
  const { mailboxAccountId, senderKeys, olderThanDays } = scope;
  const predicates: SQL[] = [
    eq(mailMessages.mailboxAccountId, mailboxAccountId),
    senderKeys.length === 1
      ? eq(mailMessages.senderKey, senderKeys[0]!)
      : inArray(mailMessages.senderKey, [...senderKeys]),
    eq(mailMessages.isOutbound, false),
    sql`'INBOX' = ANY(${mailMessages.labelIds})`,
  ];
  if (olderThanDays !== null && olderThanDays !== undefined) {
    predicates.push(
      sql`${mailMessages.internalDate} <= now() - (${olderThanDays} || ' days')::interval`,
    );
  }
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(...predicates)!;
}
