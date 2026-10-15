## 2026-10-15 — Reconcile historical suggestions with current action state

**PR:** Follow-up to [#1057](https://github.com/CT2689-Tech/DeclutrMail/pull/1057), branch `codex/post-action-suggestions`.
**Caught by:** User report, production, independent flow/design review.
**What happened:** Sender details rendered a stored Unsubscribe recommendation alongside Request accepted. The renderer did not reconcile historical recommendations with current policy, lifecycle or mail counts. Review also caught legacy unknown/unavailable outcomes, contradictory Keep suggestions, and unnecessary scoring for never-scored Keep/Protected senders.
**Correct approach:** Project a recommendation's current applicability at every display and lazy-work consumer. Preserve lifecycle uncertainty, partial and unknown counts, retry eligibility, and Undo/new-mail restoration without erasing history.
**Rule:** Verify completed action readback against both the visible suggestion and any scoring/explanation work it triggers.
**Enforcement update:** Shared eligibility projection, lifecycle/count matrices, page/inspector readback regressions and old-renderer negative control; no hook or global policy change.
