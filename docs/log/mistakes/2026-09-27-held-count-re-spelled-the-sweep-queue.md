## 2026-09-27 — The Quiet held count re-spelled the sweep's queue and missed a clause

**PR:** #800 (https://github.com/CT2689-Tech/DeclutrMail/pull/800)
**Caught by:** defect-class sweep during PR #791, confirmed 2026-09-27 by a failing spec
**What happened:** `MailboxAccountsService.quietHeldCount` (#298, 2026-07-08) counted
`rule_match_log` rows with `resolution='approved' AND intent_applied=false`. #388
(2026-07-26) added `MATCH_EVIDENCE_CURRENT` to the Autopilot action sweep's load, but not
to the count. A match whose sender a resync re-created, with no execution claim, read as
"N Autopilot actions waiting to run" for good, while no sweep ever loaded, ran or retired
it. Dev DB, read-only, on 2026-09-27: 0 approved-unapplied rows, so none affected. Prod
was not measured.
**Correct approach:** a surface that says "the worker will run these" reads the worker's
own predicate. It must not re-spell that predicate.
**Rule:** Read the Autopilot action queue through the predicates in `@declutrmail/db`:
`ruleMatchIsQueuedAction()` for what the sweep loads, `ruleMatchIsHeldAction()` for what
the Quiet screen counts as held. Never hand-write `approved AND NOT intent_applied`.
**Enforcement update:** none. The exported predicates carry the rule, and the held-count
spec runs a real sweep and asserts it executes exactly the counted actions.
