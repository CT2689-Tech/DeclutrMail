### 2026-09-27 — Should an Active rule act again on a sender whose old action went stale?

**Source:** PR #800 (Quiet held count), gate review. The question was queued through the
session orchestrator.
**Why:** Sometimes a resync re-creates a sender after an Autopilot action for it was approved.
That old action never runs, and nothing retires it. `staleEvidenceExcluded` on the
`AutopilotActionWorker` succeeded line now counts these actions. The Active-mode apply step
still treats the action as queued: its "already queued" check
(`packages/workers/src/autopilot-apply.worker.ts`) reads approved and unapplied without an
evidence check. So that Active rule never records a fresh match for the sender and never acts
on it again. Every rule that can run Active today is an Unsubscribe rule, so answering yes
means the rule may unsubscribe that sender again, based on its current mail.

Dev DB, read-only, on 2026-09-27: 0 such rows. Prod not measured. Since #388, only two
things produce these rows: legacy resyncs, and a narrow race where apply records a match
for a sender a concurrent sync has just inserted.

**How:** Answer in plain terms. "An old queued Autopilot action that a resync made stale will
never run, but it also stops that Active rule from ever acting on that sender again. Should the
rule be allowed to act on that sender again from its current mail?" Recommended: **yes**. The
old action still never runs. A yes lets the check read `ruleMatchIsQueuedAction()` from
`@declutrmail/db`.
**Verifies by:** A yes ships with a test: a stale approved row plus an Active rule leads to a
fresh match being recorded. A no stays as the comment at the check.
**Status:** Open
