## 2026-10-17 — Resolve an accepted handle before retiring uncertain feedback

**PR:** Linked from the associated action-feedback consistency PR.
**Caught by:** Independent flow review, design-system-agent Check E and regression tests.
**What happened:** An unshipped feedback candidate stored a client acknowledgement in Query and used a discovery fetch's completion timestamp as proof that it had seen a newly accepted action. A pre-accept empty snapshot or an aged-out result could retire the warning without establishing the outcome. Home's mutation also omitted the explicit mailbox argument used to scope the acknowledgement.
**Correct approach:** Keep transient accepted handles in Zustand, pass mailbox scope at enqueue, and read the accepted batch when discovery omits it. Retire a handle only after that scoped read succeeds. Preserve unknown feedback and retry on unavailable reads. Use one live announcer for shared progress.
**Rule:** An empty active list does not prove what an accepted action did; resolve its handle before dropping feedback.
**Enforcement update:** Integration regressions hold the initial read across acceptance and recover an accepted failure after discovery returns an empty list. Existing glossary/lint gates reject ambiguous UI copy and restricted query patterns.
