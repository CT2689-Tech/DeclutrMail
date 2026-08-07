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

import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { mailMessages } from './schema/mail-messages';

/**
 * How far a sender action reaches (ADR-0028).
 *
 *   - `inbox_only` — messages currently carrying INBOX. Every verb's
 *     original semantic, and still the only legal reach for everything
 *     except Delete (`action_jobs_reach_verb_check`).
 *   - `all_mail`   — inbox + archived: everything the mailbox holds for
 *     the sender EXCEPT Trash, Spam, Drafts and Chat. Mirrors what a
 *     Gmail `from:` search covers, which is what "delete everything from
 *     this sender" means to a user whose filters skip the inbox.
 *
 * REQUIRED (no default) on `senderActionWhere`: reach decides a
 * destructive verb's blast radius, so every caller states it in source.
 */
export type SenderActionReach = 'inbox_only' | 'all_mail';

/**
 * Labels `all_mail` must never touch. TRASH/SPAM are already on their
 * way out or never wanted; DRAFT/CHAT are not "mail from this sender"
 * in any user's mental model. Kept as one array so the predicate and
 * its tests share the exact list.
 */
export const ALL_MAIL_EXCLUDED_LABELS = ['TRASH', 'SPAM', 'DRAFT', 'CHAT'] as const;

export interface SenderInboxActionScope {
  mailboxAccountId: string;
  /** One or more sha256 sender keys. */
  senderKeys: readonly string[];
  /** Only messages older than N days; null/undefined = whole inbox. */
  olderThanDays?: number | null | undefined;
}

export interface SenderActionScope extends SenderInboxActionScope {
  reach: SenderActionReach;
}

/**
 * WHERE clause for the sender-action message set — see module doc.
 * Reach-explicit variant (ADR-0028); `senderInboxActionWhere` below
 * remains the inbox-only spelling for the callers whose reach is fixed
 * by design (previews' inbox buckets, Autopilot, bulk).
 */
export function senderActionWhere(scope: SenderActionScope): SQL {
  const { mailboxAccountId, senderKeys, olderThanDays, reach } = scope;
  const predicates: SQL[] = [
    eq(mailMessages.mailboxAccountId, mailboxAccountId),
    senderKeys.length === 1
      ? eq(mailMessages.senderKey, senderKeys[0]!)
      : inArray(mailMessages.senderKey, [...senderKeys]),
    eq(mailMessages.isOutbound, false),
    reachWhere(reach),
  ];
  if (olderThanDays !== null && olderThanDays !== undefined) {
    predicates.push(
      sql`${mailMessages.internalDate} <= now() - (${olderThanDays} || ' days')::interval`,
    );
  }
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(...predicates)!;
}

/**
 * The reach half of the predicate, factored out so the correlated
 * `senderHasActionableMail` below cannot drift from `senderActionWhere`.
 */
function reachWhere(reach: SenderActionReach): SQL {
  return reach === 'inbox_only'
    ? sql`'INBOX' = ANY(${mailMessages.labelIds})`
    : // Overlap operator against the exclusion list; `label_ids` is
      // NOT NULL (default '{}') so the NOT can never trip on NULL.
      sql`NOT (${mailMessages.labelIds} && ${sql.raw(allMailExcludedArrayLiteral())})`;
}

/**
 * Correlated `EXISTS` — "this sender has mail an action could move".
 *
 * Same message set as {@link senderActionWhere}, but keyed to an OUTER
 * query's sender-key column instead of a value list, so a sender listing
 * can drop rows whose action would move nothing BEFORE its LIMIT.
 *
 * That ordering matters. A pool that ranks by indexed volume and then
 * hands its rows to a consumer filtering on inbox volume can fill every
 * slot with rows the consumer discards — no error, just an empty result.
 * Onboarding's Step 5 rendered blank on a 98k mailbox for exactly that
 * reason.
 */
export function senderHasActionableMail(
  mailboxAccountId: string,
  senderKeyColumn: AnyColumn,
  reach: SenderActionReach = 'inbox_only',
): SQL {
  return sql`EXISTS (SELECT 1 FROM ${mailMessages} WHERE ${and(
    eq(mailMessages.mailboxAccountId, mailboxAccountId),
    eq(mailMessages.isOutbound, false),
    reachWhere(reach),
    sql`${mailMessages.senderKey} = ${senderKeyColumn}`,
  )})`;
}

/** WHERE clause for the inbox-only sender-action message set. */
export function senderInboxActionWhere(scope: SenderInboxActionScope): SQL {
  return senderActionWhere({ ...scope, reach: 'inbox_only' });
}

/**
 * `ARRAY['TRASH',…]::text[]` literal. Static, sourced from the const
 * above (system label ids — no user data), so `sql.raw` is safe and the
 * planner sees a plain array literal.
 */
function allMailExcludedArrayLiteral(): string {
  return `ARRAY[${ALL_MAIL_EXCLUDED_LABELS.map((l) => `'${l}'`).join(',')}]::text[]`;
}
