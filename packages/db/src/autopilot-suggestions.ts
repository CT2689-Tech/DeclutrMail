// @declutrmail/db — Autopilot suggestion predicates (D104, D245).
//
// THE meaning of "a pending Observe suggestion the user can act on". The
// pending list, the Observe digest's `pendingTotal` (which "Approve all ~N"
// and the day-7 prompt read), and both approve UPDATEs must resolve the
// SAME row set. They used to spell it inline, four times, so the Protected
// exclusion (#715) reached the list and both approve paths but not the
// count: "Approve all ~N" counted suggestions the approve itself skips.
// It lives once, here, where every module that reads `rule_match_log`
// can import it without depending on the Autopilot read service (D204).
//
// Every fragment correlates on the OUTER `rule_match_log` row through
// `sql.raw('rule_match_log.<col>')`, on purpose: an interpolated Drizzle
// column can emit a BARE name, which inside these subqueries would bind to
// the inner table and degenerate into `s.x = s.x` (see LEARNINGS —
// correlated-subquery pitfall). The enclosing query must therefore read
// `rule_match_log` unaliased.

import { and, eq, sql, type SQL } from 'drizzle-orm';

import { ruleMatchLog } from './schema/rule-match-log';

/**
 * A pending suggestion is offerable only while the sender row it was
 * computed FROM is still the one in the index.
 *
 * A match is a claim about a sender's volume, read rate and recency.
 * The initial-sync rebuild tears `senders` down and re-inserts it
 * (`initial-sync.worker.ts` — delete + reinsert IS the reconciliation),
 * so after any resync every surviving match describes mail this mailbox
 * no longer holds. On the founder's dev mailbox, ten days after a
 * reconnect: 6,244 pending matches, of which **32** pointed at sender
 * keys that existed nowhere and **5,978** at rows the rebuild had
 * re-created — only 234 were genuinely current. Existence alone is
 * therefore the wrong test; it catches 0.5% of the bad rows and lets a
 * stale suggestion RESURRECT the instant its sender is re-inserted.
 *
 * `created_at <= matched_at` is the exact test: the sweep reads senders
 * and then writes the match, so a legitimate pair always satisfies it,
 * and incremental sync upserts (`onConflictDoUpdate`) never move
 * `created_at`. Only a full rebuild — the one event that invalidates
 * the evidence — makes it false.
 *
 * `initial-sync.worker.ts` now deletes pending matches inside the same
 * rebuild transaction, so this predicate is the guard for mailboxes
 * that were already rebuilt before that shipped.
 */
function senderIndexedAtMatchTime(): SQL {
  return sql`exists (
  select 1
  from senders s
  where s.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
    and s.sender_key = ${sql.raw('rule_match_log.sender_key')}
    and s.created_at <= ${sql.raw('rule_match_log.matched_at')}
)`;
}

/**
 * The match's sender carries `sender_policies.is_protected = true` RIGHT
 * NOW — protection can be set any time after the match was logged. The
 * execution-time guard in `autopilot-action.worker.ts` re-checks this and
 * dismisses an already-approved match with `dismissReason:'protected'`, so
 * every surface that offers, counts or approves a match must apply the
 * same check — otherwise it offers, counts or approves suggestions the
 * worker will silently refuse to execute (D245: Protected senders are
 * excluded from bulk and automatic mail-changing actions).
 */
export function ruleMatchSenderIsProtected(): SQL {
  return sql`exists (
  select 1
  from sender_policies sp
  where sp.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
    and sp.sender_key = ${sql.raw('rule_match_log.sender_key')}
    and sp.is_protected = true
)`;
}

/**
 * An Observe suggestion still awaiting a decision whose evidence is
 * current. Protected senders are NOT excluded: pair it with
 * {@link ruleMatchSenderIsProtected} to split it exactly into what the
 * user can act on ({@link ruleMatchIsOfferableSuggestion}) and what an
 * approve holds back (its `skippedProtectedCount`).
 */
export function ruleMatchIsPendingSuggestion(): SQL {
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(
    eq(ruleMatchLog.modeAtMatch, 'observe'),
    eq(ruleMatchLog.resolution, 'pending'),
    senderIndexedAtMatchTime(),
  )!;
}

/**
 * A suggestion the user can act on: what the pending list shows, what
 * `pendingTotal` counts, and what both approve paths may flip. A Protected
 * sender's suggestion stays `pending` rather than being dismissed, so
 * unprotecting the sender makes it offerable again.
 */
export function ruleMatchIsOfferableSuggestion(): SQL {
  return sql`(${ruleMatchIsPendingSuggestion()} and not ${ruleMatchSenderIsProtected()})`;
}
