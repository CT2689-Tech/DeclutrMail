# API query performance follow-up — 2026-09-24

This follow-up covers Sender SQL, Search SQL, API request fan-out, and server-side cache/polling opportunities from the interaction review. Measurements use a migrated, isolated PGlite PostgreSQL database; no deployed database was read or changed. This measures query execution, not network/pool wait, production percentiles, or click-to-feedback.

## Implemented

- Five sender rolling-statistics scans become one bounded scan with filtered aggregates, shared by list and detail. Dates retain their individual windows; user-read and sweeper-read attribution remain separate. Outbound exclusion is unchanged. All-time Inbox/unread counts retain their selective indexed queries; archived count keeps the original current-mail exclusions.
- Four list/six detail recommendation lookups become one scalar JSON projection of the most recent mailbox/sender decision. The list does not fetch reasoning or expiry. `ORDER BY produced_at DESC LIMIT 1`, absent-decision nulls, tenancy, confidence precision, and API shape are preserved.
- Activity starts counters alongside row hydration. The same unbounded aggregate promise still supplies both counters when no date bounds apply. This removes a request waterfall without caching mutable action/undo state or adding reads.

A scalar projection matters: the lateral-join candidate performed decision work before LIMIT for non-indexed sorts. On 2,000 senders its name/time-sort executions increased from about 13ms to 21–26ms, despite reducing the number of decision subplans. That candidate was rejected. A direct unique-key join had mixed results and was also rejected. The retained projections preserve deferred work for only selected page rows.

## Reproducible measurement

Run `SENDER_SQL_BENCH=1 pnpm --filter @declutrmail/api exec vitest run src/senders/senders.performance.spec.ts`.

The opt-in fixture creates 50 and 2,000 senders, 100 messages per sender (5,000/200,000 messages), indexed/ANALYZE'd migrated tables, mixed read/Inbox states, and recommendations for half the senders. It captures the actual generated service query and runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` three times for every supported sort and five searches: no search, rare matching term, one-character term, absent term, and literal wildcard. Output contains only synthetic size/sort/query labels, execution time, and plan scan counts. It never opens a deployed connection.

One sequential baseline/candidate comparison (median of three executions, milliseconds):

| Senders/messages | Sort       | Baseline | Retained scalar aggregates |
| ---------------- | ---------- | -------: | -------------------------: |
| 50 / 5,000       | total      |   10.258 |                      9.236 |
| 50 / 5,000       | name       |    9.557 |                      8.455 |
| 50 / 5,000       | first_seen |    9.266 |                      8.252 |
| 50 / 5,000       | last_seen  |    9.119 |                      8.089 |
| 2,000 / 200,000  | total      |   10.900 |                      9.521 |
| 2,000 / 200,000  | name       |   13.108 |                     11.390 |
| 2,000 / 200,000  | first_seen |   13.342 |                     11.171 |
| 2,000 / 200,000  | last_seen  |   12.504 |                     11.086 |

The final plan has four mail-message scan nodes (rolling aggregate, Inbox, unread Inbox, sparkline), versus eight previously, and one decision scan versus four. Repeat runs while other agents ran builds/tests showed substantial host contention, so these timings are illustrative CPU evidence, not a stable latency guarantee. Baseline source is commit `920c14e7`; the same fixture can run against that service for comparison.

## Assigned audit dispositions

| Audit area               | Result and remaining boundary                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sender SQL               | Implemented measured scan consolidation. Existing integration coverage exercises sorting/cursor pagination, absent decisions, multiple tenants with identical sender keys, rolling read-rate/trends, sweeper attribution, and current archived mail. No speculative index or schema changes. Production p95 and real mailbox distributions still need deployment telemetry.                                                                                              |
| Search SQL               | Measured all supported sorts with rare, short, absent and literal-wildcard terms. At 2,000 senders the initial absent-query executions were 2.2–2.3ms and rare queries about 2.9ms; later contended runs varied. Existing `%`, `_`, and backslash escaping remains intact. No trigram index: this sample does not demonstrate index benefit sufficient to justify added sync write cost. Revisit with substantially larger real sender cardinality and production plans. |
| Request fan-out          | Activity row→counter serialization removed and covered by a deferred-read concurrency regression. Existing sender list/meta requests and Triage bootstrap already run independent work concurrently. Detail's messages/chart/history each resolve the sender with a tenant-scoped lookup: do not remove the existence/404 distinction just to save a read. A future combined endpoint should be justified by traces and retain independent section failures.             |
| Server cache correctness | No new persistent server cache. Worker/provider actions and sync alter counts outside the API process, and undo/preview state is time-sensitive. In-process TTL caching would create stale destructive decisions unless a cross-process invalidation contract is implemented. Existing client scoping/invalidation is handled by the browser workstream.                                                                                                                 |
| Polling/actions          | Reduced each Activity refresh's serial latency; preserved fresh counters, action states and undo. Browser polling coalescing is handled separately. Worker/provider execution timing is a separate instrumentation requirement and is not inferred from SQL time.                                                                                                                                                                                                        |

## Validation

- Sender and Activity integration suites: 140 passed, 10 existing skipped timeseries tests.
- Added regression holds row hydration open and proves counter work starts before release and an unbounded counter is requested once.
- The opt-in 40-case actual-query plan benchmark passes against the migrated synthetic database.
- API typecheck and changed-file lint passed.

### Real PostgreSQL driver parity

A separate smoke exercised the changed service methods using the actual `postgres-js` driver against `localhost:5432/declutrmail`, with synthetic fixtures enclosed in a transaction that was deliberately rolled back. The existing port-4000 API and its owning worktree were not changed. This was a direct service/driver harness, not an HTTP endpoint smoke.

Verified all four list sorts, detail Inbox **1**, archived **2**, rolling volume **3**, user read rate **2/3**, decimal confidence **0.87**, exact normalized ISO decision timestamp, non-stale future expiry, null missing decision, and foreign-mailbox isolation. Activity returned the expected `rows`, `stats`, and `allTimeStats` service envelopes for both `all` and `7d`; the empty synthetic mailbox had equal counter objects. A post-rollback query verified that no synthetic workspace row remained. This confirms JSON scalar decoding and timestamp/numeric handling with the production driver as well as PGlite.

### Isolated HTTP smoke

Started the changed API from `/private/tmp/declutr-perf-api/apps/api` on port **4005** (PID/cwd verified), reusing local development configuration. The existing API on port 4000 was untouched. The allowlisted D206 login returned **302**. Authenticated read-only requests returned **200** for sender list (`data`, `meta`), sender detail (`data`, including numeric Inbox and archived counts), and Activity (`data`, `meta`). No Gmail actions were requested.

Downstream structured `http.request` logs recorded route templates and matching statuses: `GET /api/senders` **113.1ms**, `GET /api/senders/:id` **38.7ms**, `GET /api/activity` **47.3ms**. These are individual local smoke observations, not production percentiles or controlled before/after latency results. No mailbox content, identifiers, session cookies, or secrets are included in this evidence.
