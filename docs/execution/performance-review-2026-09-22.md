# Performance review — 22 September 2026

Branch: `claude/product-simplification-ideas-5a8515`

Reviewed revision: `17888918`

Scope: browser, server rendering, API, database, sync workers, deployment configuration and measurement.

## Recommendation

Start with sender-inspector request sequencing, independent Triage reads, and duplicate authentication reads. Establish measurements alongside those changes. Then reduce work that grows with mailbox history and shorten the time background sync holds action locks.

These are source-backed opportunities, not measured speedup claims. The production database snapshot did not establish an immediate capacity problem. Larger infrastructure is not the first recommendation.

This review changed no application code, database schema, runtime configuration or deployed services. It includes read-only production database metadata inspection; no mailbox contents or payment data were read.

## Evidence and limits

- The current branch was inspected across frontend, API and worker workstreams.
- The previous implementation verification on this revision passed all 52 route JavaScript budgets and confirmed 45 statically rendered public routes. This audit did not rerun the build. See [delivery verification](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/docs/execution/implementation-delivery-audit-2026-09-22.md).
- At **19:18:26 UTC on 22 September**, production PostgreSQL reported **23 connections against a maximum of 60**, one active connection (including the inspection), no idle transactions and no sessions waiting on locks. This is one quiet snapshot, not a peak-load or latency assessment.
- Estimated live rows: **221,986 messages**, **15,539 senders**, **39,268 sender time-series rows** and **11,757 triage decisions**. Message-table total storage, including indexes, was approximately 279 MiB. These estimates do not justify partitioning by themselves.
- PostgreSQL statement statistics were last reset on **8 June**. Several top cumulative consumers reference retired reply-counter columns. The repository already documents this trap in [migration 0075](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/packages/db/migrations/0075_drop_reply_counters.sql). Do not prioritize current changes from those historical totals without mapping statements to current code and measuring fresh deltas.
- The performance advisor returned informational index/archive-table findings, not evidence of current saturation. “Unused” indexes can protect rare recovery, deletion or expiry work; usage counters alone are insufficient grounds to remove them.
- Live Cloud Run inspection was blocked by credentials requiring reauthentication. Deployment settings below are **repository configuration**, not verified running configuration. No authentication or infrastructure changes were attempted.
- No production load test, browser interaction benchmark, current endpoint p95 measurement or database execution-plan benchmark was performed in this audit.

## First wave: bounded changes with a clear benefit

| Priority | Finding                                                                                                    | Proposed change                                                                                                                                                                                                                 | Verification                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Clicking a sender must load the inspector component before its data requests start.                        | Start the component import and essential detail query together. Add bounded hover/focus prefetch where useful; avoid prefetching every sender and honor data-saving constraints. Keep secondary tabs deferred when appropriate. | Compare cold/warm click-to-useful-preview, request start times, bytes and abandoned prefetches. Check keyboard use, inbox switching and mobile detail routing.                         |
| 2        | Triage awaits three independent reads sequentially after loading its main rows.                            | Execute outbound-index availability, aggregate statistics and actionable inbox counts concurrently.                                                                                                                             | Verify all reads begin without waiting for another; compare result parity and endpoint timing. Confirm connection-pool waiting does not increase under representative concurrency.     |
| 3        | Authentication reads the same provider-sync state through two bulk methods.                                | Fetch once and derive readiness and reconnect state from the same result.                                                                                                                                                       | Reduce database calls while preserving missing-row defaults, freshness and empty-account behavior. These reads already run in parallel, so the clearest benefit is less repeated work. |
| 4        | The shared authenticated page boundary waits for optional badges and summaries alongside navigation gates. | Keep authentication, onboarding and account-deletion gates blocking; let optional shell summaries load independently.                                                                                                           | Compare time until the page is usable. Confirm no unauthorized content, extra duplicate fetches, incorrect badges or lost error recovery.                                              |

Source anchors:

- [Inspector loading](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/features/senders/senders-screen.tsx:82) and [inspector data hooks](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/features/senders/detail/sender-detail-page.tsx:180). The full-page detail route already prefetches its data in parallel; the improvement concerns the list inspector.
- [Triage follow-on reads](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/triage/triage.read-service.ts:648).
- [Authentication sync reads](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/auth/auth.controller.ts:124) and [sync projections](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/sync/sync.service.ts:333).
- [Authenticated page boundary](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/features/auth/server-app-boundary.tsx:43). Its existing timeout is a hang guard, not elimination of this wait.

## Second wave: keep larger accounts responsive

### Browser rendering and requests

**Long sender lists.** Loaded pages accumulate as rendered rows. Profile 50, 250 and 1,000 loaded senders before selecting a remedy. Stabilize row properties and callbacks first; use windowed rendering if the profile shows that mounting off-screen rows drives interaction delays. Preserve group headings, selection, keyboard navigation and focused rows. Measure interaction latency, render duration, DOM count and memory.

Evidence: [Sender list rendering](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/features/senders/sender-list.tsx:143) and [loaded-page composition](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/features/senders/senders-screen.tsx:305).

**Post-action refetches.** Action completion invalidates the broad sender query namespace, which includes lists, summaries, details, messages, charts and history. Narrow invalidation to affected data where the action contract permits it; give historical charts longer freshness only when action invalidation keeps them correct. Preserve undo, partial failures, background reconciliation and strict freshness of destructive-action previews.

Evidence: [Action invalidation](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/web/src/lib/api/use-action.ts:112). Measure requests per action and active-query duplication rather than assuming every invalidated query is immediately fetched.

**Billing and public pages.** Optional Billing panels already load on demand, and public pages already benefit from static rendering. Keep the current budgets and measure real route loading and interaction responsiveness before adding further splitting. Provider-confirmed billing quotes must remain fresh; caching them indiscriminately is not a performance improvement.

### API and database work

**Autopilot Observe summaries.** Historical rule matches are joined to current inbox messages before recent/pending filters inside aggregate counts. Repeated matches can multiply intermediate rows. Filter eligible matches early, calculate pending counts separately, deduplicate recent rule/sender pairs, then join messages.

Evidence: [Observe digest query](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/autopilot/autopilot.read-service.ts:428). Compare plans and returned counts on representative data. Preserve old pending matches, indexed-at-match rules, inbound-only message scope and distinct counts across repeated matches. This is a credible growth risk, not a measured current slow endpoint.

**Activity history.** Each page loads unresolved root actions and their recovery history before applying the final feed filtering and page slice. As failed-action history grows, the work can exceed what a page needs. Move latest-attempt resolution and pagination into bounded database work, with a separate totals query where necessary.

Evidence: [Execution lineage loading](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/activity/activity.read-service.ts:863). This needs careful parity testing: successful recovery must remove the root, latest attempts must determine state, and filtering/cursor ordering must remain correct. An arbitrary cap would hide valid activity and is not an acceptable optimization.

**Follow-ups.** Candidate scanning can make ten rounds, each with awaiting-message and policy queries, using offsets. Use a stable sent-time/id cursor and reduce repeated policy work. Keyset pagination alone will not remove the two-query-per-round sequence.

Evidence: [Follow-up scan](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/followups/followup.read-service.ts:79). Preserve limits, mailbox scoping, exclusion rules and dismissal behavior; measure heavily excluded datasets as well as ordinary inboxes.

**Sender search.** Name/email/domain searches use substring matching. The inspected sender indexes are B-tree indexes and production does not have the trigram extension installed. Benchmark representative terms and short-query behavior; add a suitable trigram index or change the search strategy only if execution plans and latency warrant it. Index cost includes storage and writes.

Evidence: [Sender substring search](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/senders/senders.read-service.ts:359). No index changes were made.

## Third wave: background speed, freshness and infrastructure

| Area                          | Finding and proposed improvement                                                                                                                                                                                                                                             | What must be measured or preserved                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync/action contention        | Incremental sync makes serial Gmail metadata calls while holding the mailbox action lock. Fetch metadata with bounded concurrency outside the critical section where safe, then revalidate and apply in order.                                                               | Lock waiting/holding time, provider quota, cursor consistency, label ordering and races with deletion. History-page fetching already occurs outside the lock.                                           |
| Reconciliation coverage       | The daily sender-index sweep randomly selects at most four eligible mailboxes. As the fleet grows, this provides no maximum interval between successful sweeps. Prioritize the oldest successful sweep or schedule deduplicated per-mailbox jobs within a fixed load budget. | Oldest unswept age and coverage; retain locks, restart safety and quota limits. Fleet-wide starvation was not measured.                                                                                 |
| Work cancellation             | Worker timeout uses a promise race; timeout rejection does not itself stop the underlying work. Add cooperative cancellation, request deadlines and appropriate database statement timeouts.                                                                                 | Verify the underlying task stops and releases resources before retries overlap. Shortening the timeout alone is insufficient.                                                                           |
| Connection/concurrency budget | Source config allows up to three API instances; worker main, lock and listener pools add clients. Explicitly budget pools, rollout overlap and queue concurrency before increasing worker parallelism.                                                                       | Pool waiting, actual pooler mode, backend connections, CPU and memory. Client pool slots are not equivalent to PostgreSQL backend connections under transaction pooling.                                |
| API/database distance         | Deployment config places API in Iowa and worker in Oregon; the database is in Oregon. Benchmark API-to-database round trips and assess moving the API nearer the database if this remains true in production.                                                                | Verify actual placement first; compare whole-request latency and plan domain/certificate/OAuth/webhook routing and rollback. Historical worker measurements in comments are not current API benchmarks. |

Source anchors:

- [Incremental sync](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/packages/workers/src/incremental-sync.worker.ts:487).
- [Sender-index sweep](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/packages/workers/src/sender-index-sweep.worker.ts:165) and [daily schedule](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/packages/workers/src/sender-index-sweep.queue.ts:33).
- [Timeout wrapper](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/packages/workers/src/base-declutr-worker.ts:643).
- [Worker pools](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/worker.ts:461), [API pool](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/apps/api/src/db/db.module.ts:40) and [deployment regions](/Users/chintant/projects/DeclutrMail/.claude/worktrees/product-simplification-ideas-5a8515/.github/workflows/deploy-cloud-run.yml:77).

Initial sync's chunk barriers are a secondary candidate: a bounded streaming fetch pool could avoid waiting for the slowest item in each chunk. Investigate only after separating provider quota waits from network time. Existing resumability, checkpoints and quota controls must remain intact.

## Measurement and acceptance

1. Capture route-level loading and interaction timing for public pages, sign-in, Home, Senders/inspector, Triage, Activity and Billing. Compare cold and warm loads, smaller devices and large inboxes using a production build.
2. Add sampled endpoint and database-span timing with low-cardinality route names; separate network/pool waiting from SQL execution. Exclude health checks from product endpoint latency reports.
3. Track queue waiting time, execution time, mailbox-lock waiting and time since successful sync/reconciliation. Queue throughput alone does not show whether an individual mailbox is stale.
4. Keep telemetry optional and nonblocking. Consent-gate browser analytics and exclude addresses, search terms, subjects, recipients, tokens and message bodies.
5. For each optimization, record a baseline and the same after-change workload. Require result parity, lower relevant waiting/work, no increased errors or quota failures, and unchanged route budgets. Do not promise a percentage improvement before measuring.

Browser targets can use the standard p75 Core Web Vitals thresholds: LCP ≤2.5 seconds, INP ≤200 ms, CLS ≤0.1. These are proposed acceptance targets, **not current measured scores**. See [Web Vitals](https://web.dev/articles/vitals).

## Existing improvements to retain

The branch already has shared query factories, server hydration and request deduplication, parallel prefetching in several routes, intent-based navigation prefetch, lazy optional panels, adaptive polling, bounded exports, batched sender/score work, provider quota limits, resumable sync, and hot-table autovacuum tuning. Source deployment configuration also already specifies warm minimum instances and startup CPU boost.

These are not new recommendations. Preserve them while fixing the remaining waits and repeated work.

## Reference guidance

- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist): validate production behavior and real loading/interaction performance alongside bundle size.
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html): use execution plans to validate query changes; execution-enabled analysis actually runs the statement and should use a controlled workload.
- [Supabase performance detection](https://supabase.com/docs/guides/observability/detecting): inspect representative periods and multiple signals rather than treating a single snapshot as diagnosis.
- [Cloud Run development guidance](https://docs.cloud.google.com/run/docs/tips/general): account for instance startup, concurrency and dependency cost; warm-instance settings are already present in this repository.
