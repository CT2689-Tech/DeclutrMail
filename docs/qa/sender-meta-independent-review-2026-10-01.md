# Independent Senders default-count review — 2026-10-01

Final verdict: **PASS, no unresolved blocking findings.** Required privacy-auditor gate: **PASS**. Required architecture-guardian gate: **PASS**. Independent correctness review and scoped defect-class sweep: **PASS**. Ready for integration-owner PR creation and exact-head CI, followed by deployment and production-after verification.

## Exact candidate and scope

- Worktree: `/Users/chintant/.codex/worktrees/d523/DeclutrMail-sender-meta`
- Base HEAD: `38841291beecddeb67b4f226f8ce6bfeab6be92d`
- Runtime SHA-256, `apps/api/src/senders/senders.read-service.ts`: `d634abf679128f30090b0e805960863228d66ecf5d3daabbbd15405baa2b8381`
- Read spec SHA-256: `8bd50aced8ca0042e49bd26bf731f90344e36e302d1f32eecdb9eba9e3302934`
- Corrected current-mail plan spec SHA-256: `3fb2171f4d425e2b83c820b857566f8d197b8e4dfe082cb062f2378a56477d13`
- QA: `docs/qa/sender-meta-performance-2026-10-01.md`

Runtime change is confined to getSenderListQueryMeta: share the mailbox/current-mail base predicates, copy them for matching, and use the existing axis aggregate total when no composed predicate was appended. No schema, auth, worker, API response, caching, write or provider-call change. Integration owner fixed the plan-spec finding during this review; runtime remained unchanged. Reviewer performed no workspace source edits, Git mutations, production reads, commits, pushes or external comments. Disposable synthetic tests/configuration were outside the checkout and removed after review.

## Required structural gates

Applied CLAUDE.md sections 7–8 and the privacy-auditor, architecture-guardian and defect-class-sweeper definitions. API typecheck and changed-file ESLint passed. Service remains read-only; no cross-feature write, new Nest module, endpoint, orchestrator, event, worker, destructive handler, idempotency, undo or rate-limit path is introduced. Existing module/controller contracts and mailbox attribution remain unchanged.

Privacy diff prechecks and semantic review found no message body, attachments, MIME/header retrieval, telemetry/logging payload or new data destination. The existing mailbox-scoped sender/policy aggregate and metadata-only current-mail EXISTS predicate remain the data sources. No new stored or returned data field is introduced.

## Reader and consequential-count review

Inventoried getSenderListQueryMeta, its first-page controller invocation, listSenders predicate composition, the axis/MAX aggregate, shared current-mail and Inbox helpers, web page-1 query metadata readers, sender policies screen, search/widened-result count readers, bulk-selection and action preview/enqueue paths.

TotalMatching drives consequential count copy and the results hero. The current BulkSelectButton selects eligible loaded sender IDs; its selection label uses those rows. Bulk previews resolve actual sender IDs and current protected state in the authenticated mailbox, and enqueue retains independent checks. The optimization introduces no estimated count and does not substitute metadata totals for authoritative preview/mutation scope. It does not move a write or defer a fact beyond a destructive reader.

## Predicate and aggregate correctness

The reuse guard compares lengths of two arrays, one copied from the other. Every applicable composed predicate only appends to the copied matching array. Therefore equality of lengths is sufficient here: both aggregates use the same FROM, identical mailbox/current-mail WHERE predicates and identical LEFT JOIN to sender_policies. The policy unique mailbox/sender constraint prevents multiplication. Constructing the skipped Drizzle query does not execute it; the real-driver call-count tests demonstrate that behavior.

Category, true/false protection, activity, true/false unsubscribe-ready, true/false wrote-to, unsubscribe-ignored true, positive quiet days, nonblank domain/search and Inbox true all append predicates and retain the separate exact count. Null/undefined tri-state inputs, blank search/domain, nonpositive quiet days, Inbox false and unsubscribe-ignored false retain their original no-filter semantics. In particular, false protected/unsubscribe-ready/wrote-to values are not treated as absent.

CurrentMailOnly is a shared base predicate, not a composed filter, so reuse works for both historical and current-mail scope. It retains inbound-only membership and Trash/Spam/Draft/Chat exclusions, including mailbox isolation and Undo/new-mail behavior covered by existing tests. Inbox retains its distinct existing semantics and runs the filtered count. MAX and absolute axis counts retain their original mailbox/current-mail scope; a category filter does not rescale them.

Both counts are COUNT(*)::bigint over identical joined rows. The reused value still passes ensureSafeIntegerNumber with the totalMatching label; invalid/negative/unsafe values reject rather than returning a rounded count. The existing optional-row fallback is zero. Actual PostgreSQL aggregate shape always supplies one row even for an empty population, verified with real SQL for both current-mail modes. No additional acceptance of an unknown aggregate shape was introduced. Default matching and axis totals now share a statement snapshot; the independent list query still has its pre-existing possible concurrent-write interval.

## Independent checks

- Read-service and controller suites: **118 passed, 10 existing optional tests skipped, 2 files**. Initial combined run also exposed the plan-spec blocker below. Log: `/tmp/declutrmail-sender-meta-review-tests.log`.
- Disposable real-SQL edge suite: **3 passed, 1 file**. Empty mailbox returns all-zero totals/MAX/axes in one query for both current-mail modes. No-op inputs use one query; false tri-state predicates use two. Sixteen composed predicate cases across both current-mail modes (32 combinations) each use two queries and totalMatching equals actual list length while absolute total/MAX remain unchanged. Log: `/tmp/declutrmail-sender-meta-review-edge.log`.
- Corrected real-SQL current-mail plan suite: **1 passed, 1 file**. Three default statements and two additional filtered statements; filtered matching 25 versus absolute axes 50; all five captured statement plans use the current-mail partial index. Log: `/tmp/declutrmail-sender-meta-review-candidate-plans.log`.
- Combined successful independent coverage: **122 passed, 10 skipped, 4 files**.
- API typecheck and changed-file ESLint passed; corrected plan-spec ESLint and git diff --check passed. Logs: `/tmp/declutrmail-sender-meta-review-typecheck.log`, `/tmp/declutrmail-sender-meta-review-lint.log`, `/tmp/declutrmail-sender-meta-review-plan-lint.log`.

Disposable fixture setup initially omitted required protection metadata, then used an incorrect protection reason enum. Those synthetic setup mistakes were corrected to the existing schema's user_defined reason and protection timestamp before the successful edge run; neither was a product finding.

## Finding resolved during review

The existing current-mail performance spec expected four default statements at its old line 48. Independent execution failed with three, because eliminating the fourth duplicate statement is the intended behavior. Required fix was to prove three default statements while retaining separate filtered matching-count/index coverage. The owner changed the synthetic categories so only half of current-mail senders match updates, checks 25 matching versus 50 absolute, and exercises both filtered statements. This was independently reverified; no count or index expectation was weakened.

A subsequent apparent index-plan failure was a local dependency-resolution issue: apps/api/node_modules/@declutrmail/db resolved the older original DeclutrMail checkout, whose migration set lacked 0081; fresh-db derives its migrations directory from its own module. A disposable Vitest alias pointed DB/testing imports to this candidate's source/migrations and all five plan assertions passed. No runtime/query fix was needed. Integration CI must resolve its own checked-out workspace packages normally.

## Scoped sweep and limits

Mechanism: duplicate matching COUNT and axis COUNT over identical request membership. Baseline query `git show HEAD:apps/api/src/senders/senders.read-service.ts | rg -n 'totalMatchingQuery|filterCountsQuery|\\[totalRow, countsRow\\]'` rediscovered the seed: matching query around 975, axis query around 998, and unconditional execution of both around 1052. Searches for COUNT(*) and aggregate consumers across read services then examined shape, producer/reachability (all filter branches), consumers (metadata/UI/bulk), and SQL/service layer. Summary and detail aggregates count different populations/windows and are not interchangeable; no additional proven sibling was found within the scoped reader family. Provenance/database population investigation was skipped because this is a read-only mechanism review with no stored-format or historical distribution change; production populations were not queried.

The patch proves removal of one duplicate aggregate/current-mail scan on unfiltered initial metadata. It retains the expensive axis aggregate and the separate row/summary work. No elapsed production improvement percentage, percentile, native production plan result, sub-200 ms guarantee or all-screen completion claim is established. Production-after endpoint timing remains pending deployment.

Required fixes remaining: **none**. Exact-head CI and deployment verification remain integration responsibilities.
