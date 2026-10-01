# Activity one-query lineage — independent review

Reviewer: existing `performance_review` agent, applying the required architecture gate and adversarial correctness review. Root owns integration; reviewer made no committed runtime edits. Candidate runtime SHA-256: `f5b8520d40712530fdecea04135ff37b6dcbb8978cd7155e92c721c82b6a6015`.

**PASS, no blockers.** The reviewer reported 98 tests passed / 2 optional benchmarks skipped across the Activity read, controller and export suites, plus API typecheck and changed ESLint. A unique mailbox/sender join preserves attempt cardinality, all root/current projected fields are unchanged, and complete capture still precedes persisted feed reads. The iterator/export hydration helper is unchanged.

Two disposable actual-driver edge tests passed. Joined capture deeply equals legacy hydration for a missing sender, a messages selector, a same-key sender in another mailbox, an empty display name/email-derived domain, and recovery whose current selector differs from its root (root identity remains authoritative). A transactional worker completion after the lineage snapshot still reaches the later persisted feed; capture-before-feed ordering holds.

The root independently ran the full read suite (84 passed / 1 unrelated optional benchmark skipped), negative one-trip regression against original code, typecheck, lint and formatting. Controlled timing is documented in `activity-lineage-performance-2026-10-01.md`; neither party claims this proves production latency below 200 ms. Exact-head CI and production-after checks remain required.

The unchanged export iterator still has serial root/sender hydration. It is outside this page-navigation change and is not presented as optimized.
