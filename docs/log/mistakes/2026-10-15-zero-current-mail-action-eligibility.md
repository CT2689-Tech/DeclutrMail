## 2026-10-15 — Empty current mail still offered cleanup actions

**PR:** Follow-up to [#1059](https://github.com/CT2689-Tech/DeclutrMail/pull/1059), branch `codex/empty-sender-actions`.
**Caught by:** User report, live read-only page, independent flow/usability review.
**What happened:** The unsubscribe lifecycle fix preserved other actions but did not verify that those actions had current mail to move. Shared Archive/Later/Delete predicates always returned true, and their confirmation paths could still submit old positive facts immediately after zero readback. Bulk exclusion copy assumed every non-Protected skip was an unsubscribe/channel distinction.
**Correct approach:** Define each action's current scope: Archive/Later need inbox mail; Delete can also target archived mail. Disable only exact current zeros, preserve unknown-count preview, and revalidate trustworthy readback on confirmation. Keep current counts separate from lifetime history, completion feedback and Undo. Give empty rows their own bulk exclusion explanation and retain Protected handling.
**Rule:** Audit every action's eligible current scope, control, keyboard/menu entry and dispatch together after cleanup and recovery.
**Enforcement update:** Location-count matrix, component/menu/selection/swipe tests, immediate-zero page/list regressions, cache freshness tests, composed empty/eligible/Protected selection, synthetic browser checks; no global policy change.
