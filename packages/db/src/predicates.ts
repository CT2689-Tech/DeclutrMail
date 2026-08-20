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

/**
 * SQL predicate: this message's READ state was not produced by a known
 * third-party sweeper (mig 0064, F012).
 *
 * Gmail exposes exactly one engagement bit — the absence of `UNREAD` —
 * and any tool with API access can write it. On the founder's mailbox one
 * sweeper's label carries 20,819 of the 75,689 messages we count as read:
 * 27.5% of the entire read signal, manufactured by a tool the user is not
 * currently using.
 *
 * APPLIED TO THE NUMERATOR ONLY. The message still counts toward volume —
 * it did arrive, and removing it from the denominator would shrink the
 * sender instead of correcting the rate, which is a different (and
 * invisible) lie.
 *
 * Lives here, beside `senderInboxActionWhere`, for the same reason that
 * one does: the live senders query and the `sender_timeseries` counter
 * reconcile must apply the IDENTICAL exclusion. The two disagreeing is
 * precisely the defect class F009 recorded, and a copied predicate is how
 * it comes back.
 *
 * WHY `mailboxScope` IS A REQUIRED ARGUMENT. This was a correlated
 * `NOT EXISTS` that read `mailbox_account_id` off the message row, and
 * the docstring claimed that "on a mailbox with no sweeper labels the
 * partial index has no rows, so this costs nothing". Measured on
 * production 2026-08-20, that is false: correlation forces one index
 * descent PER MESSAGE ROW whether or not it can match. In the
 * `sender_timeseries` reconcile it ran 75,761 times, returned zero rows
 * every single time, and accounted for 75,625 of the query's 156,529
 * shared buffers — 48% of the work, to answer a question whose answer
 * was a two-element array.
 *
 * Taking the mailbox as an explicit argument makes the subquery
 * UNCORRELATED, so Postgres evaluates it once as an InitPlan and tests
 * each row with an array overlap. Same reconcile query: 156,529 → 80,906
 * buffers, 7,378ms → 1,307ms, and the label lookup itself 75,625 → 2
 * buffers.
 *
 * PASS A CONSTANT, NOT A COLUMN REFERENCE. Handing this a column (e.g.
 * `senders.mailbox_account_id` from an enclosing row) re-correlates the
 * subquery and gives the old behaviour back, silently. Callers inside a
 * mailbox-scoped query already hold the id as a value — pass that.
 *
 * `coalesce(label_ids, '{}')` preserves the original NULL semantics:
 * `NOT EXISTS` was true for a NULL array (no rows can match), whereas a
 * bare `NULL && …` is NULL, which a `FILTER`/`WHERE` would drop. Prod
 * currently holds no NULL `label_ids`, so this guards a shape the column
 * still permits rather than one it exhibits.
 *
 * @param mailboxScope - the mailbox the enclosing query is scoped to, as
 *   a bound value. NOT a column reference — see above.
 * @param messageAlias - the `mail_messages` alias in the enclosing query.
 */
export function readStateNotSweeperMarked(
  mailboxScope: SQL | string,
  messageAlias: SQL | string = 'mail_messages',
): SQL {
  const alias = typeof messageAlias === 'string' ? sql.raw(messageAlias) : messageAlias;
  return sql`NOT (COALESCE(${alias}.label_ids, '{}') && ${sweeperLabelIds(mailboxScope)})`;
}

/**
 * The sweeper-owned label ids for one mailbox, as a single array.
 *
 * Uncorrelated by construction: it reads `mailboxScope` and nothing from
 * the outer row, so it is evaluated once per statement. Served by
 * `mailbox_labels_sweeper_idx`.
 */
function sweeperLabelIds(mailboxScope: SQL | string): SQL {
  return sql`(
    SELECT COALESCE(array_agg(sweeper_label.label_id), '{}')::text[]
    FROM mailbox_labels AS sweeper_label
    WHERE sweeper_label.mailbox_account_id = ${mailboxScope}
      AND sweeper_label.sweeper_vendor IS NOT NULL
  )`;
}

/**
 * The mirror image: this message's read state WAS produced by a sweeper.
 *
 * Powers the disclosure — "324 of 350 marked by Unroll.me" — so the
 * product can explain an odd-looking number instead of silently
 * compensating for it. Kept beside its complement so the two cannot
 * drift apart into describing different sets, and it takes the same
 * `mailboxScope` argument for the same reason.
 */
export function readStateSweeperMarked(
  mailboxScope: SQL | string,
  messageAlias: SQL | string = 'mail_messages',
): SQL {
  const alias = typeof messageAlias === 'string' ? sql.raw(messageAlias) : messageAlias;
  return sql`COALESCE(${alias}.label_ids, '{}') && ${sweeperLabelIds(mailboxScope)}`;
}
