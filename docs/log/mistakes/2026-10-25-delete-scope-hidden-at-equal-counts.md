## 2026-10-25 — Equal preview counts hid Delete scope

**Caught by:** User report; reproduced in the signed-in UI and a failing screen-level regression.
**What happened:** The shared Delete scope control hid Include archived email when age-filtered inbox and all-mail counts matched, including zero. This concealed an explicit scope choice when archived mail existed outside the current age window. Existing tests enforced the hiding behavior; independent review found one more such assertion in the Unsubscribe backlog suite.
**Correct approach:** Keep the explicit scope control visible, explain equal counts using existing copy, and preserve confirmation guards for zero and unavailable counts. Update all affected consumer assertions.
**Rule:** Snapshot count equality must not remove a supported scope control or conceal an already selected scope.
**Enforcement update:** First-review request regression and shared-consumer assertions; browser regressions for recent archived-only mail, no current mail and unavailable counts.
