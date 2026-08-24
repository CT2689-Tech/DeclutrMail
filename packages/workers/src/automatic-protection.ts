import { mailMessages, senderPolicies, senders } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';
import { sqlTextArray } from './sql-text-array.js';

/**
 * Which senders a sweep is allowed to move.
 *
 * `undefined` (or an absent `senderKeys`) means the whole mailbox — the
 * form the initial sync and the nightly sweep use, and the only form
 * that can re-evaluate the TIME-DEPENDENT rules below.
 *
 * A key list narrows every pass to those senders. Nothing else in the
 * mailbox is read or written, which turns the `sender_signals` aggregate
 * from a full inbound scan into an index range read on
 * `mail_messages(mailbox_account_id, sender_key, internal_date)`.
 */
export interface AutomaticProtectionScope {
  senderKeys?: readonly string[];
}

/**
 * Strong, explainable signals that may automatically protect a sender.
 *
 * The ordering is intentional: when more than one signal is present we
 * retain the clearest evidence for the user-facing explanation.
 *
 * - replied: TWO-WAY correspondence — at least three outbound messages
 *   ADDRESSED to this sender (their address in To/Cc) AND at least one
 *   message received FROM them. Both halves are load-bearing (F010): a
 *   bounce notifier has inbound but nothing addressed to it, and a
 *   sender you were merely CC'd alongside has neither. The enum value
 *   stays `replied` — it is an internal identifier, like the `screen`
 *   verdict, and never user-facing; the user-facing clause lives in
 *   `@declutrmail/shared/copy/protection` and says what we can prove.
 * - starred: at least one inbound message starred in the past year
 * - gmail_important: at least three inbound messages carrying Gmail's
 *   IMPORTANT label in the past year, AND the sender lives in Gmail's
 *   Primary category. Gmail hands out IMPORTANT liberally to promotions
 *   and updates (founder mailbox 2026-07-15: 176 of 187 importance-only
 *   protections were non-primary), so importance alone is not a strong
 *   signal — importance in Primary is. The category is Gmail-assigned
 *   (CATEGORY_* labels), never predicted by us (D222).
 *
 * Read/open rate is deliberately excluded. A manual Unprotect leaves a
 * non-null reason as a memory pin, so a later sync never silently reverses
 * the user's override.
 *
 * ## Scope, and why the unscoped form must keep running
 *
 * `scope.senderKeys` narrows the sweep to the senders a Pub/Sub push
 * actually touched. Every EVENT-DRIVEN input above is reachable that way:
 * `wrote_to_count` moves only on a message add/delete, "has inbound"
 * only on an add, and star / IMPORTANT / category are label state on a
 * message whose sender the push already named.
 *
 * Two inputs are NOT event-driven, and a scoped sweep can never see
 * them:
 *
 *   - `internal_date >= now() - interval '1 year'` on both the star and
 *     the importance rule. A star that ages past 365 days stops
 *     qualifying with no Gmail event to announce it.
 *   - the same clock edge withdrawing an importance protection whose
 *     count decays below three.
 *
 * So the scoped form is an OPTIMISATION LAYERED ON a full sweep, never a
 * replacement: `SenderIndexSweepWorker` runs this unscoped nightly per
 * mailbox and is what actually retires a stale protection. Dropping that
 * cron would leave protections pinned to signals that expired — a
 * sender the product claims is protected "because you starred it" when
 * the star is two years old (D245 requires the reason be true, not just
 * present).
 */
export async function applyAutomaticProtection(
  tx: OutboxTx,
  mailboxAccountId: string,
  scope?: AutomaticProtectionScope,
): Promise<void> {
  const senderKeys = scope?.senderKeys;
  if (senderKeys !== undefined && senderKeys.length === 0) {
    // An explicit empty scope is "this push moved nobody", which is a
    // no-op — NOT "sweep everything". Returning here keeps that
    // distinction from depending on how Postgres reads `= ANY('{}')`.
    return;
  }
  // Built once; interpolated into all three passes so they cannot drift
  // apart on which senders they consider.
  const scoped = senderKeys !== undefined;
  const keyArray = scoped ? sqlTextArray(senderKeys) : null;
  const policyScope = keyArray
    ? sql`AND sp.${sql.identifier('sender_key')} = ANY(${keyArray})`
    : sql``;
  const signalScope = keyArray
    ? sql`AND ${sql.identifier('sender_key')} = ANY(${keyArray})`
    : sql``;
  const senderScope = keyArray
    ? sql`AND s.${sql.identifier('sender_key')} = ANY(${keyArray})`
    : sql``;
  // Reconcile before escalating: retire any SWEEP-AUTHORED protection
  // whose stored reason is no longer what the current signals support.
  //
  // This used to check exactly one case — an importance-only protection
  // whose sender is no longer Primary — and it was the only demotion the
  // sweep could perform. That left the three CLOCK-driven retirements
  // this worker exists for unreachable: a `starred` protection whose
  // star aged past a year, a `replied` protection whose `wrote_to_count`
  // decayed below 3, and a `gmail_important` protection whose recent
  // count decayed below 3 while the sender stayed Primary. The upsert
  // below cannot retire them either — a sender that qualifies for
  // nothing is filtered out by `WHERE protection_reason IS NOT NULL`, so
  // its ON CONFLICT never fires, and the DO UPDATE guard
  // (`is_protected = false AND protection_reason IS NULL`) is false for
  // any row that is currently protected.
  //
  // So a sender stayed "protected because you starred it" with a
  // two-year-old star, forever, which is precisely the D245 §2.6
  // invariant this file is supposed to enforce. Caught by review on
  // 2026-08-24; the test named for the behaviour never inserted a
  // `sender_policies` row and so only ever proved the sweep does not
  // CREATE a protection from stale evidence.
  //
  // `IS DISTINCT FROM` rather than `IS NULL`: a sender whose star aged
  // out but who now qualifies as `replied` has a stored reason that is
  // FALSE, and D245 requires the reason shown to be the true one. Using
  // `IS NULL` would leave it displaying `starred`. It must also not fire
  // when the reason is UNCHANGED, or every nightly sweep would reset
  // `protection_set_at` on every protected sender.
  //
  // Composition with the upsert below is deliberate and load-bearing:
  // this statement leaves the row at `(is_protected = false,
  // protection_reason = NULL)`, which is exactly the state the upsert's
  // DO UPDATE guard requires. A sender that still qualifies under some
  // rule is therefore re-protected in the same transaction with its
  // CURRENT reason; one that qualifies for nothing stays retired.
  //
  // Scoped to sweep-authored reasons. `user_defined` is manual and must
  // never be withdrawn by a sweep, and `is_protected = true` keeps
  // manual-unprotect memory pins (which sit at false) untouched.
  await tx.execute(sql`
    WITH sender_signals AS (
      SELECT
        ${sql.identifier('sender_key')} AS sender_key,
        bool_or(
          'STARRED' = ANY(${sql.identifier('label_ids')})
          AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS has_recent_star,
        COUNT(*) FILTER (
          WHERE 'IMPORTANT' = ANY(${sql.identifier('label_ids')})
            AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS recent_important_count
      FROM ${mailMessages}
      WHERE ${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND ${sql.identifier('is_outbound')} = false
        ${signalScope}
      GROUP BY ${sql.identifier('sender_key')}
    ),
    current_reason AS (
      -- MUST stay byte-identical to the CASE in the upsert below. If the
      -- two ever disagree, a sender oscillates: demoted here every night
      -- and re-protected there, resetting protection_set_at each time.
      SELECT
        s.${sql.identifier('sender_key')} AS sender_key,
        CASE
          WHEN s.${sql.identifier('wrote_to_count')} >= 3
            AND sig.sender_key IS NOT NULL THEN 'replied'::protection_reason
          WHEN COALESCE(sig.has_recent_star, false) THEN 'starred'::protection_reason
          WHEN s.${sql.identifier('gmail_category')} = 'primary'
            AND COALESCE(sig.recent_important_count, 0) >= 3
            THEN 'gmail_important'::protection_reason
          ELSE NULL
        END AS protection_reason
      FROM ${senders} AS s
      LEFT JOIN sender_signals AS sig ON sig.sender_key = s.${sql.identifier('sender_key')}
      WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        ${senderScope}
    )
    UPDATE ${senderPolicies} AS sp
    SET
      ${sql.identifier('is_protected')} = false,
      ${sql.identifier('protection_reason')} = NULL,
      ${sql.identifier('protection_set_at')} = NULL,
      ${sql.identifier('updated_at')} = now()
    FROM current_reason AS cr
    WHERE sp.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND sp.${sql.identifier('is_protected')} = true
      AND sp.${sql.identifier('protection_reason')} IN ('replied', 'starred', 'gmail_important')
      AND cr.sender_key = sp.${sql.identifier('sender_key')}
      AND cr.protection_reason IS DISTINCT FROM sp.${sql.identifier('protection_reason')}
      -- Redundant with the scoped current_reason join above, which
      -- already cannot match an out-of-scope policy row. Kept so the
      -- scope of a DEMOTION is stated on the statement that demotes,
      -- rather than inferred two CTEs away.
      ${policyScope}
  `);
  await tx.execute(sql`
    WITH sender_signals AS (
      -- ONE GROUPED PASS PER MAILBOX, replacing three correlated
      -- subqueries per sender.
      --
      -- Each rule below used to be asked once per sender. Measured on
      -- production 2026-08-20 (7,955 senders, 185,583 messages):
      -- 81,789 shared buffers and 7,051ms, of which the starred EXISTS
      -- alone was 69,832 buffers across 7,955 executions that returned
      -- rows=0 EVERY TIME -- the whole mailbox holds 160 starred
      -- messages. Grouped: 13,246 buffers, 1,058ms. -84% / -85%.
      --
      -- The planner cannot do this transformation itself. A scalar
      -- aggregate subquery is opaque to it, unlike the EXISTS forms
      -- elsewhere in this repo that it rewrites into semi-joins.
      SELECT
        ${sql.identifier('sender_key')} AS sender_key,
        bool_or(
          'STARRED' = ANY(${sql.identifier('label_ids')})
          AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS has_recent_star,
        COUNT(*) FILTER (
          WHERE 'IMPORTANT' = ANY(${sql.identifier('label_ids')})
            AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS recent_important_count
      FROM ${mailMessages}
      WHERE ${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND ${sql.identifier('is_outbound')} = false
        ${signalScope}
      GROUP BY ${sql.identifier('sender_key')}
    ),
    eligible AS (
      SELECT
        s.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
        s.${sql.identifier('sender_key')} AS sender_key,
        CASE
          -- ORDER IS THE RULE, not an implementation detail: the first
          -- match wins, so a replied-to sender is reported as 'replied'
          -- even if it also has a star. The reason is shown to the user
          -- (D245 requires the exact reason), so reordering these
          -- changes what the product says, not just what it computes.
          --
          -- "has any inbound mail" is now membership in sender_signals,
          -- which is filtered to is_outbound = false -- so a sender with
          -- no inbound row is simply absent from the group.
          WHEN s.${sql.identifier('wrote_to_count')} >= 3
            AND sig.sender_key IS NOT NULL THEN 'replied'::protection_reason
          WHEN COALESCE(sig.has_recent_star, false) THEN 'starred'::protection_reason
          WHEN s.${sql.identifier('gmail_category')} = 'primary'
            AND COALESCE(sig.recent_important_count, 0) >= 3
            THEN 'gmail_important'::protection_reason
          ELSE NULL
        END AS protection_reason
      FROM ${senders} AS s
      LEFT JOIN sender_signals AS sig ON sig.sender_key = s.${sql.identifier('sender_key')}
      WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        ${senderScope}
    )
    INSERT INTO ${senderPolicies} (
      ${sql.identifier('mailbox_account_id')},
      ${sql.identifier('sender_key')},
      ${sql.identifier('policy_type')},
      ${sql.identifier('is_protected')},
      ${sql.identifier('protection_reason')},
      ${sql.identifier('protection_set_at')}
    )
    SELECT
      eligible.mailbox_account_id,
      eligible.sender_key,
      'keep'::sender_policy_type,
      true,
      eligible.protection_reason,
      now()
    FROM eligible
    WHERE eligible.protection_reason IS NOT NULL
    ON CONFLICT (${sql.identifier('mailbox_account_id')}, ${sql.identifier('sender_key')}) DO UPDATE
    SET
      ${sql.identifier('is_protected')} = true,
      ${sql.identifier('protection_reason')} = COALESCE(
        sender_policies.${sql.identifier('protection_reason')},
        EXCLUDED.${sql.identifier('protection_reason')}
      ),
      ${sql.identifier('protection_set_at')} = COALESCE(
        sender_policies.${sql.identifier('protection_set_at')},
        now()
      ),
      ${sql.identifier('updated_at')} = now()
    WHERE sender_policies.${sql.identifier('is_protected')} = false
      AND sender_policies.${sql.identifier('protection_reason')} IS NULL
  `);
}
