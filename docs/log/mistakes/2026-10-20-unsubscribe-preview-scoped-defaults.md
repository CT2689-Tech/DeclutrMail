## 2026-10-20 — Keep opening mode separate from filtered impact

**PR:** Unsubscribe preview review patch, branch `codex/unsubscribe-preview`.
**Caught by:** Independent design/correctness review before merge.
**What happened:** Extending Email age to Triage Unsubscribe exposed a default derived from the filtered count. An empty/missing Archive bucket could switch the action to unsubscribe-only. Details also retained an Any-age Includes clause. Moving the age controls displaced Later's existing return control in one sibling modal.
**Correct approach:** Derive the opening mode from the unfiltered inbox total; use selected-age counts only for impact and confirmation. Carry that same age to Details and the request. Verify sibling control order after shared layout changes.
**Rule:** A filter may change matches; it must not silently change the chosen action.
**Enforcement update:** Modal/inline zero and missing-bucket request regressions, filtered Includes assertions, independent sibling review and browser verification.
