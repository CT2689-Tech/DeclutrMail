// @declutrmail/db — Autopilot match predicates (D92, D104, D245).
//
// THE meaning of a `rule_match_log` row at each stage of its life, so every
// reader of a stage resolves the SAME row set:
//
//   - A pending Observe suggestion the user can act on: the pending list,
//     the Observe digest's `pendingTotal` (which "Approve all ~N" and the
//     day-7 prompt read) and both approve UPDATEs. They used to spell it
//     inline, four times, so the Protected exclusion (#715) reached the
//     list and both approve paths but not the count.
//   - An approved action waiting to run: the action sweep's load, its
//     in-hold re-checks and the Quiet screen's held count. The count used
//     to spell it approved-and-unapplied and skip the sweep's evidence
//     test, so a match no sweep loads, runs or retires read as "waiting to
//     run" for good.
//
// They live in packages/db because every reader already imports it: the
// workers and the API. Which feature may SELECT `rule_match_log` is a
// separate question: Autopilot owns the table, and every other reader is
// registered in ADR-0008 §3.
//
// Every fragment correlates on the OUTER `rule_match_log` row through
// `sql.raw('rule_match_log.<col>')`, on purpose: an interpolated Drizzle
// column can emit a BARE name, which inside these subqueries would bind to
// the inner table and degenerate into `s.x = s.x` (MISTAKES.md 2026-05-23,
// correlated-subquery tautology). The enclosing query must therefore read
// `rule_match_log` unaliased.
//
// Two evidence tests live here, and they differ ON PURPOSE:
// `senderIndexedAtMatchTime` (suggestions) requires the sender row to
// exist and predate the match, because a suggestion is shown by name and
// approved as a claim about that sender's current mail.
// `ruleMatchEvidenceIsCurrent` (actions) lets a MISSING sender through —
// the sweep retries it while the index is being built and retires it once
// the index was rebuilt without it — and lets a claimed action through,
// because a claim may already have moved mail. Unifying them would either
// strand a claimed action mid-execution or offer suggestions about senders
// that are gone; `packages/db/tests/autopilot-suggestions.test.ts` pins
// the difference.

import { and, eq, not, sql, type SQL } from 'drizzle-orm';

import { ruleMatchLog } from './schema/rule-match-log';

/**
 * Idempotency-key prefixes of a match's durable execution claim
 * (`<prefix><matchId>` in `action_jobs.idempotency_key`): a label action
 * (archive / later), then a one-click unsubscribe execution.
 *
 * Every writer and reader of a claim key builds from this;
 * `autopilot-claim-key.spec.ts` fails on the common hand spellings in the
 * production sources. A format
 * change made in one place and not the others would read claimed matches
 * as unclaimed: the rebuild would delete them and the sweep would stop
 * loading them, stranding a Gmail change with no row to finish it against.
 */
export const AUTOPILOT_CLAIM_KEY_PREFIXES = ['autopilot-', 'autopilot-unsubexec-'] as const;

/**
 * `<label-claim prefix> || rule_match_log.id` — the key a label claim for
 * the outer match row carries. Only the label prefix: an unsubscribe
 * claim is written in the same transaction that flips `intent_applied`,
 * so it never exists beside an unapplied match.
 */
export function ruleMatchLabelClaimKey(): SQL<string> {
  return sql<string>`${AUTOPILOT_CLAIM_KEY_PREFIXES[0]} || ${sql.raw('rule_match_log.id')}::text`;
}

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
 *
 * Correlates on an unaliased `rule_match_log` in the enclosing query.
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
 *
 * Correlates on an unaliased `rule_match_log` in the enclosing query.
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
 *
 * Correlates on an unaliased `rule_match_log` in the enclosing query.
 */
export function ruleMatchIsOfferableSuggestion(): SQL {
  return sql`(${ruleMatchIsPendingSuggestion()} and not ${ruleMatchSenderIsProtected()})`;
}

/**
 * Is a match's evidence still the CURRENT sender index — or already
 * claimed for execution? Correlates on an unaliased outer `rule_match_log`.
 *
 * `InitialSyncWorker` rebuilds `senders` by DELETE + re-INSERT, so a
 * sender row created after the match means the rule decided on mail the
 * mailbox no longer holds; executing it would mutate Gmail on deleted
 * evidence. The second branch is the escape hatch: once the durable
 * `action_jobs` claim exists the action is legitimately in flight (the
 * rebuild's cleanup skips it for the same reason), and dropping it would
 * strand a Gmail change with no row to flip or audit against.
 *
 * A MISSING sender row passes. `AutopilotActionWorker` tells that case
 * apart itself: retried while the sender index is still being built,
 * retired once the index has been rebuilt without it.
 *
 * ONE definition for the sweep's load, its per-match re-read and its
 * claim re-check. They were briefly written out twice and drifted on the
 * very first edit — the load filtered claimed matches the re-check would
 * have allowed.
 */
export function ruleMatchEvidenceIsCurrent(): SQL<boolean> {
  return sql<boolean>`(
  not exists (
    select 1
    from senders s
    where s.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
      and s.sender_key = ${sql.raw('rule_match_log.sender_key')}
      and s.created_at > ${sql.raw('rule_match_log.matched_at')}
  )
  or exists (
    select 1
    from action_jobs aj
    where aj.idempotency_key = ${ruleMatchLabelClaimKey()}
  )
)`;
}

/**
 * An approved match the Autopilot action sweep will pick up: what
 * `AutopilotActionWorker` loads and re-checks before it claims.
 * Approved and unapplied alone is not it — a match whose evidence is
 * stale is never loaded, so nothing ever runs or retires it.
 * Correlates on an unaliased outer `rule_match_log`.
 */
export function ruleMatchIsQueuedAction(): SQL {
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(
    eq(ruleMatchLog.resolution, 'approved'),
    eq(ruleMatchLog.intentApplied, false),
    ruleMatchEvidenceIsCurrent(),
  )!;
}

/**
 * An approved, unapplied match the sweep will never pick up: its evidence
 * is stale. Nothing runs or retires it — the sender-index rebuild's
 * cleanup is its only exit — so the sweep reports how many it left behind.
 * With {@link ruleMatchIsQueuedAction} it splits approved-and-unapplied
 * exactly in two. Correlates on an unaliased outer `rule_match_log`.
 */
export function ruleMatchIsStaleAction(): SQL {
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(
    eq(ruleMatchLog.resolution, 'approved'),
    eq(ruleMatchLog.intentApplied, false),
    not(ruleMatchEvidenceIsCurrent()),
  )!;
}

/**
 * The match's rule may start new work: enabled and not paused. Mirrors
 * the sweep's rule check (Guard 3) for the COUNT only — the sweep still
 * loads a paused rule's matches, because an in-flight claim among them
 * has to finish (D105).
 *
 * Exported (2026-09-29) so the approve endpoints can refuse to flip a
 * suggestion to `approved` while its rule is off or paused — approving
 * used to succeed silently and just wait as `approved,
 * intent_applied=false` until the rule resumed, which then ran every
 * waiting approval — irreversible Unsubscribe requests included — at a
 * moment the user was never shown a preview. Founder decision
 * 2026-09-29 (a):
 * docs/log/founder-followups/2026-09-27-autopilot-approvals-on-paused-rules.md
 */
export function ruleMatchRuleCanStart(): SQL {
  return sql`exists (
  select 1
  from automation_rules ar
  where ar.id = ${sql.raw('rule_match_log.rule_id')}
    and ar.enabled
    and ar.mode <> 'paused'
)`;
}

/**
 * An unsubscribe whose sender already carries the one-way
 * `policy_type='unsubscribe'` projection: the sweep closes it as a no-op
 * (Guard 5) instead of sending anything.
 */
function ruleMatchUnsubscribeAlreadyDone(): SQL {
  return sql`exists (
  select 1
  from automation_rules ar
  join sender_policies sp
    on sp.mailbox_account_id = ${sql.raw('rule_match_log.mailbox_account_id')}
   and sp.sender_key = ${sql.raw('rule_match_log.sender_key')}
  where ar.id = ${sql.raw('rule_match_log.rule_id')}
    and ar.action_kind = 'unsubscribe'
    and sp.policy_type = 'unsubscribe'
)`;
}

/**
 * What the Quiet screen counts as held: a queued action whose rule may
 * start it (Guard 3), whose sender is not Protected (Guard 4) and, for an
 * unsubscribe, not already unsubscribed (Guard 5). The sweep still loads
 * the others — it retires them or waits for the rule — so the exclusions
 * are the count's alone. Not every exit is mirrored; among those left out:
 * the rule's daily cap, the tier gate, an in-flight claim (it finishes even
 * during quiet), a legacy superseded Active match, an unknown preset, and
 * a claim abandoned after a rebuild. Correlates on an unaliased outer
 * `rule_match_log`.
 */
export function ruleMatchIsHeldAction(): SQL {
  // Non-empty predicate list, so `and()` can never return undefined.
  return and(
    ruleMatchIsQueuedAction(),
    ruleMatchRuleCanStart(),
    not(ruleMatchSenderIsProtected()),
    not(ruleMatchUnsubscribeAlreadyDone()),
  )!;
}
