// @declutrmail/db — the Triage queue's order and its decided window
// (D30, D227).
//
// Two readers pick "the senders Triage shows first": the API's queue
// read (`TriageReadService.listQueue`) and the score worker, which buys
// LLM explanations for exactly those senders when a mailbox becomes
// ready. A copy in each would drift the first time either moved, and
// the worker would then pay for senders nobody is shown while the
// queue's rows fall back to the template. So the order lives once,
// here, where both packages import from.

import { asc, desc, sql, type SQL } from 'drizzle-orm';

import { triageDecisions } from './schema/triage-decisions';

/**
 * D30 — "not seen by user in last 7 days". A sender the user has
 * DECIDED on (a K/A/U/L/D `activity_log` row whose undo has not been
 * reverted) within this window is excluded from the queue, so a row
 * leaves the queue only once the server has durably confirmed the
 * decision (D226 — no optimistic removal). Shared with
 * `ActionsService.recordKeepIntent`'s replay window so "already
 * decided" means the same thing on both the read and the write side.
 */
export const TRIAGE_DECIDED_WINDOW_DAYS = 7;

/**
 * Excludes senders the user has already decided on within the D30
 * window. Correlates to an UNALIASED `triage_decisions` in the enclosing
 * query.
 *
 * The "decided" record is the K/A/U/L/D `activity_log` row (written by
 * the label-action worker on `done` for Archive/Later/Delete, by the
 * intent endpoints for Keep/Unsubscribe). A decision whose undo has been
 * REVERTED no longer counts: the user changed their mind, so the sender
 * returns to the queue. Raw SQL (no column interpolation) because a
 * correlated `sql` template emits bare column names that mis-bind across
 * the three tables (LEARNINGS 2026-06 — Drizzle correlated-subquery
 * pitfall).
 */
export function triageNotDecidedRecently(): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM activity_log al
    LEFT JOIN undo_journal uj ON uj.token = al.undo_token
    WHERE al.mailbox_account_id = triage_decisions.mailbox_account_id
      AND al.sender_key = triage_decisions.sender_key
      AND al.action IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')
      AND al.occurred_at >= now() - make_interval(days => ${TRIAGE_DECIDED_WINDOW_DAYS})
      /* Reads the reversal from undo_journal, which is PRUNED after the
         undo window, rather than the durable al.reverted_at. Safe only
         because undoWindowDays is 30 on every tier, which outlasts this 7-day
         decided window, so no row in range can have lost its journal
         row. Shrink one or widen the other and this reads an undone
         decision as standing. Sibling: lapse-reengagement.worker.ts. */
      AND (al.undo_token IS NULL OR uj.reverted_at IS NULL)
  )`;
}

/**
 * The daily queue's order (D227): destructive verbs first — archive,
 * unsubscribe, later, keep — so the user makes the highest-impact
 * decisions while attention is fresh; then confidence DESC; then
 * `sender_key`, so the ORDER BY is a total order.
 *
 * The tiebreak is load-bearing. The engine emits a handful of discrete
 * confidences, so a real mailbox had 33 decisions tied at 0.87 contending
 * for the last 4 of 12 LIMIT slots. Without it Postgres may return any of
 * them, so which senders appeared at all was undefined and any write to
 * `triage_decisions` reshuffled the queue under the reader mid-decision.
 *
 * `confidence` is `numeric` — DESC sorts it as a number, not as text.
 */
export function triageQueueOrder(): SQL[] {
  return [
    sql`CASE ${triageDecisions.verdict}
      WHEN 'archive'     THEN 0
      WHEN 'unsubscribe' THEN 1
      WHEN 'later'       THEN 2
      WHEN 'keep'        THEN 3
    END`,
    desc(triageDecisions.confidence),
    asc(triageDecisions.senderKey),
  ];
}
