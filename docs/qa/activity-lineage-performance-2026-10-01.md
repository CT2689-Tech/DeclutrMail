# Activity lineage read performance — 2026-10-01

## Scope and ownership

Root Codex session owns `apps/api/src/activity/activity.read-service.ts`, its spec and this QA evidence. Isolated branch `codex/activity-lineage-read` starts at main `38841291beecddeb67b4f226f8ce6bfeab6be92d`. Depends on the already merged #841 complete-capture ordering and is independent of #844 Later reads and #836 readiness diagnostics. No shared schema, auth, worker or contract changes.

## Observed problem

After #842 deployment, two diagnostic production Activity requests took 829.29 and 874.50 ms. Their complete lineage operations took 292.96 and 266.85 ms respectively. The initial query already joined the root action, but returned only current-attempt fields, then fetched root fields and sender identity in two more serial database calls. These are small production samples, not percentile estimates. Stats operations run concurrently, so their summed durations cannot be subtracted from request duration.

## Change and correctness

Return the existing root and current projections from that initial query, with a LEFT JOIN to sender identity constrained to the same mailbox and a root selector of type sender. The unique mailbox/sender-key constraint prevents multiplying attempts before the existing limit. Missing senders remain null; null display names still fall back to email, with the same derived domain. Execution scope, recovery ordering, predicates, cursor and limit stay the same.

Complete lineage capture still precedes persisted feed reads, preserving the worker-completion race guard from #841. Iterator/export hydration is unchanged. A joined statement captures root/current/sender facts together instead of reading the root again later; it does not introduce a write or defer an authoritative fact past a destructive reader. Recovery mutations continue validating current database state.

## Verification

- New real-SQL regression captures all root/recovery/sender facts including a same-key sender in another mailbox, then asserts one database call. Original runtime returns the same facts and fails with three calls.
- Existing pagination test now inspects completed capture results instead of spying on the removed paged hydration implementation; it still checks exactly limit+1 matching attempts and complete failure counts across pages.
- Full Activity read suite: **84 passed / 1 unrelated optional benchmark skipped**, including the completion ordering gate and recovery/paging/stat/filter coverage.
- API typecheck, changed ESLint, formatting and diff checks pass.
- Independent architecture/correctness gate and exact-head CI are required before merge.

## Controlled timing

Actual PGlite SQL and the public `listActivity` result, with one failed sender action and identical 100 ms delay per driver call. Three samples:

| Version   | Samples (ms)           | Median (ms) | Maximum (ms) |
| --------- | ---------------------- | ----------- | ------------ |
| Original  | 450.92, 434.81, 440.81 | 440.81      | 450.92       |
| Candidate | 232.45, 222.59, 219.79 | 222.59      | 232.45       |

Command: `ACTIVITY_LINEAGE_BENCH=1 pnpm --filter @declutrmail/api exec vitest run src/activity/activity.read-service.spec.ts`. This measures controlled transport savings, not production page latency, native query CPU or a product-wide 200 ms SLO. Production-after verification remains pending deployment.
