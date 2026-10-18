## 2026-10-15 — Completed status did not retire its action control

**PR:** Follow-up to [#1058](https://github.com/CT2689-Tech/DeclutrMail/pull/1058), branch `codex/unsubscribe-status-controls`.
**Caught by:** User report, production read-only inspection, independent flow/usability review.
**What happened:** The previous repair retired fulfilled recommendations but the action controls still derived unsubscribe eligibility from method availability. Accepted requests retained an active button. Review also found that a confirmation could submit during the gap between current query-cache readback and React's render, and that stale accepted detail could wrongly suppress failed-request recovery.
**Correct approach:** Use a shared lifecycle rule for every entry point, show honest current status in the action slot, and revalidate current trustworthy facts when confirming. Preserve retry for failed/unknown outcomes and alternate cleanup actions. Test newer, invalidated, missing and tied cache reads, including immediate confirmation before the observer commits.
**Rule:** Verify the recommendation, action control and dispatch guard together after a durable action outcome on every sibling surface.
**Enforcement update:** Regression tests and synthetic browser checks; no hook or global policy change.
