# Performance delivery — 22 September 2026

Branch: `claude/product-simplification-ideas-5a8515`

Base revision: `17888918`

Scope: implement the three waves from the [performance review](performance-review-2026-09-22.md), including issues found during independent review.

All source changes are implemented and locally verified. Production rollout, production latency comparisons and a conditional API region move remain separate operational work. No deployment, mailbox operation, payment operation or database schema change was performed.

## Delivery against the audit

| Area                         | Delivered                                                                                                                                                           | Evidence and boundaries                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sender preview               | Inspector code and essential detail data start together on selection; bounded hover/focus prefetch honors slow connections and data saving.                         | Query-cache and intent tests; real desktop inspector and mobile full-page detail verified. Secondary data stays deferred.                                                                                                   |
| Initial authenticated page   | Optional sender/Screener counts no longer block server rendering.                                                                                                   | Auth, onboarding, deletion, sync, recovery and Undo gates remain awaited. Counts retain their existing gated client queries.                                                                                                |
| Triage and authentication    | Independent enrichment reads run concurrently; readiness and reconnect status share one sync-state read.                                                            | Concurrency and result-parity regressions pass.                                                                                                                                                                             |
| Large sender collections     | Stable callbacks and memoized row boundaries prevent every loaded sender from rendering on selection.                                                               | At 250 and 1,000 entries, selecting/opening one row renders one row boundary. This uses a mocked inner row; it is not a browser latency benchmark. Browser selection and inspector checks used 300 loaded senders.          |
| Action completion and charts | Shared terminal snapshots reconcile once; known single-sender actions refresh affected data, lists and summary; historical charts can reuse five-minute-fresh data. | Unknown, bulk, recovered and Undo scope retain broad reconciliation. Explicit action invalidation and destructive preview freshness remain.                                                                                 |
| Autopilot Observe            | Filter pending/recent matches early and deduplicate rule/sender pairs before joining inbox messages.                                                                | PGlite parity fixtures preserve old pending matches, indexed-at-match rules, inbound scope and repeated-match counts.                                                                                                       |
| Activity history             | Resolve current unresolved attempts and filters in SQL before bounded page hydration; retain exact separate totals.                                                 | Recovery, filtering, cursor ties, export and page-size tests pass. Existing recovery index already covers the root prefix.                                                                                                  |
| Follow-ups                   | Stable sent-time/ID pagination and request-local recipient policy reuse.                                                                                            | Heavily excluded fixture traverses tied timestamps correctly; later requests see policy changes.                                                                                                                            |
| Incremental sync             | Bounded metadata prefetch outside the mailbox lock for bursts, with provider-history and database-cursor revalidation.                                              | Eight request slots, 500-message cache, ordered application, conservative quota accounting and label-race tests.                                                                                                            |
| Initial sync                 | Refillable request slots replace fixed request-wave barriers.                                                                                                       | Existing 20-request concurrency, 500-message persistence bounds, quotas and checkpoints retained. Synthetic delayed fixture completes in 110 ms versus 200 ms for waves; this is scheduling evidence, not Gmail throughput. |
| Reconciliation coverage      | Daily ordered per-mailbox jobs with durable, deduplicated continuation replace four randomly selected mailboxes.                                                    | Complete traversal, retry IDs and failed-head/successful-tail fixtures. Newly eligible mailboxes behind the cursor join the next daily root.                                                                                |
| Deadlines and cleanup        | Cooperative abort signals flow into sync reads and quota sleeps; retries wait for attempt cleanup. Reconciliation SQL uses transaction-local deadlines.             | Cancellation, rollback, lock cleanup and no-overlapping-attempt tests. Arbitrary third-party work and all other SQL are not guaranteed a hard wall-clock deadline.                                                          |
| Capacity and observability   | Explicit validated API/worker pool settings, sampled named read timings, job/queue/slow-lock timings, local p50/p95/p99 summarizer and rollout runbook.             | Metadata only; no mailbox contents, SQL parameters or added dependency on optional telemetry. Deployment source carries the defaults. Actual backend occupancy and rollout overlap still require live measurement.          |
| Search and indexes           | Read-only, bounded plan probes compared existing search with a text-cast variant on an 8,072-sender mailbox.                                                        | Warm common-term execution was about 9 ms; no-match about 40–47 ms. No consistent material gain justified a cast, extension or index. First executions were slower; this is not endpoint p95.                               |
| Billing and public pages     | Retained existing deferred Billing panels, fresh provider quotes, static public routes and unchanged route budgets.                                                 | Built-app smoke checks and build gates pass. No speculative splitting or quote caching added.                                                                                                                               |
| API region                   | Prepared a concrete evaluation/cutover/rollback sequence.                                                                                                           | Live GCP inspection requires credential reauthentication. Current placement and target routing must be verified before a production move; no region or public routing was changed.                                          |

Windowed sender rendering remains conditional: the measured React update fan-out is fixed, but full browser scrolling/DOM-memory profiling must establish a remaining bottleneck before changing keyboard, selection and accessibility behavior.

## Additional fixes found during the work

- Activity impact volume counted the same sender's recent messages repeatedly when that sender had multiple qualifying actions. The message join now starts from distinct sender keys; action counts retain event semantics. Independent statistics reads also run concurrently, and an all-time request reuses the same aggregate result.
- Next.js now uses this worktree's monorepo root for output tracing, avoiding inference from the parent checkout's unrelated lockfile. The final production build was rerun after this change.
- Sync cancellation now also interrupts quota sleeping and touched Gmail HTTP reads. OAuth token acquisition and already-running Redis commands still depend on their existing transport behavior.

## Verification

| Check                                                                 | Result                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Complete web suite                                                    | 239 files, 2,970 tests passed                                       |
| Complete API suite                                                    | 131 files, 1,866 tests passed, 14 skipped                           |
| Later Activity statistics and Gmail adapter changes                   | Focused reruns: 64 Activity tests and 51 Gmail adapter tests passed |
| Complete worker suite after final worker changes                      | 61 files, 990 tests passed, one existing skipped test               |
| Repository TypeScript checks                                          | All packages passed                                                 |
| Repository ESLint, excluding pre-existing untracked browser artifacts | No errors; seven existing warnings                                  |
| Final Next.js production build                                        | Passed                                                              |
| Route JavaScript budgets                                              | All 52 passed; budgets unchanged                                    |
| Public route prerender checks                                         | All 45 expected static routes passed                                |
| Performance log summarizer                                            | Two tests passed                                                    |
| Final request timing, sampling and API pool regressions               | 17 tests passed                                                     |

The full API run preceded the final Activity statistics additions; the subsequent focused suites cover those additions. Shared/database runtime code and schema were not changed. Tests use isolated fixtures; live worker jobs were not started for verification.

Built-app browser verification used the existing connected localhost data:

- Desktop Senders: right inspector opens, closes and updates to another sender, with recent messages and decision timeline.
- A 300-sender collection: bulk selection honors protected exclusions; unsubscribe preview retains leave/archive/delete, Inbox/Inbox + archived, age choices and counts. The preview was cancelled without submitting an operation.
- Mobile at 390 × 844: selecting a sender opens the complete detail route. The temporary viewport was reset afterward.
- Triage, Autopilot, Activity and Follow-ups finish loading and display their expected content.
- Billing displays its plan, payment/history controls and plan choices; homepage and pricing render their expected sections.
- No browser console errors were reported in these checks. This was a functional smoke pass, not every mutation flow or a numeric responsiveness benchmark.

The available browser control surface did not expose a supported numerical performance API. Consequently, there is no measured INP/LCP, request-waterfall timing, production p95 or percentage speedup claim. The runbook supplies acceptance targets and before/after measurement steps for rollout.

## Operational handoff

Use [performance verification and capacity changes](../ops/performance-verification.md) for deployment measurement, client/backend connection budgeting, the search-index decision and the conditional region move. Keep provider quotas and worker replica limits until production observations justify changes.

Detailed implementation records: [frontend](performance-frontend-delivery-2026-09-22.md), [API](performance-api-delivery-2026-09-22.md), [workers](performance-worker-delivery-2026-09-22.md).
