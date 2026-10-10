## 2026-10-10 — UI consistency needs viewport and state checks

**PR:** [#916](https://github.com/CT2689-Tech/DeclutrMail/pull/916)

**Caught by:** Independent design review, manual browser verification and CI.

**What happened:** The shared-role pass left some inline mobile font overrides, an intermediate Later breakpoint, a viewport-relative Undo offset, and a pending Keep notification visible after success. Consent radios also compressed in a narrow flex row. Shared client payload pushed two routes over their existing bundle budgets. Updated explanatory copy exposed broad E2E selectors, and moving static guidance left a source-location assertion stale.

**Correct approach:** Exercise occupied and empty screens plus pending and settled states across desktop/mobile and both themes. Inspect computed field sizes and geometry. Keep action selectors precise, preserve shared-copy assertions at their actual rendering location, and reduce client payload instead of raising budgets.

**Rule:** Verify viewport, theme, and transition behavior before calling a presentation change complete.

**Enforcement update:** Added or retained focused coverage for viewport resize, scoped toast dismissal, action eligibility, preference semantics and shared-copy sourcing. Existing CI suites and bundle limits remain unchanged. The audit report preserves failed observations and links corrected browser evidence.
