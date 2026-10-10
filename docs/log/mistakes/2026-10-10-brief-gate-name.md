## 2026-10-10 — Include entitlement gates in naming audits

**PR:** [#916](https://github.com/CT2689-Tech/DeclutrMail/pull/916) and its production follow-up.

**Caught by:** Production browser verification after PR #916.

**What happened:** The Daily brief navigation, document title, loading state, and granted page used the agreed name, but the Free/Plus entitlement gate on the same route still headed its upgrade card “Your Morning Brief.” The earlier synthetic browser account had Pro access, so that gate was not visible in its four-theme matrix.

**Correct approach:** Check both entitled and under-tier states when standardizing a feature name. The route should pass “Daily brief” to its shared gate and its Storybook example should show the same copy.

**Rule:** Include each entitlement-gated state in route naming reviews.

**Enforcement update:** None; production verification of the under-tier route caught the missed state.
