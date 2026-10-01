# Page-load performance — September 30, 2026

Baseline: `efbb9e0139e583245bce615e0e7f956441ebd4cb` (freshly fetched main).
Integration owner: this Codex session, branch `codex/page-load-performance`.
Scope: Home hydration, sender-detail server entry, and shared Screener badge
ownership. No API, database, worker, dependency, or deployment changes.

## Findings and changes

- Home previously waited for app-shell HTML and browser hydration before
  starting its cleanup summary, Triage bootstrap, and Screener count. The
  route now starts those three reads together after the request-cached session
  lookup, overlapping the app shell. It reuses the client query-option factories,
  cache keys, capability checks, and explicit active mailbox. Optional workflow
  tiles remain client-owned. The existing two-second hydration deadline and
  client recovery path still apply.
- Full-page sender detail previously awaited identity, messages, trend, and
  history together. A delayed secondary request held back usable identity and
  current Inbox/archived counts. The server now hydrates primary detail only;
  the existing progressive client sections own their secondary reads. There
  is one hydration owner per query and no late secondary server state to race
  the browser. Secondary sections can complete later on otherwise fast loads;
  this change optimizes first useful content, not completion of every section.
- The sender detail's shared browser retry predicate overrode the server
  client's `retry: false` default and did not recognize `ServerApiError`.
  Regression tests reproduced two requests and a two-second deadline for
  immediate 401/404/409 responses. The server entry now explicitly disables
  retries. Browser refresh, retries, and designed error states are preserved.
- A mounted navigation count observer, even when disabled, created an empty
  query before Home's nested hydration boundary. TanStack defers hydration of
  existing queries until an effect, allowing Home to issue a duplicate count
  request. The shell now subscribes to cached count changes without creating a
  query. Home owns fetching/polling on Home; a small shell poller owns it on
  other eligible routes. Browser request readback confirmed no duplicate Home
  summary, bootstrap, or count requests on initial hydration.
- Home's cleanup month now uses the session timezone with an explicit UTC
  fallback. This keeps the newly server-rendered label deterministic across
  server/browser timezones at month boundaries.

## Controlled production-build browser evidence

Both baseline and candidate used `next build` / `next start`, the same local
read-only synthetic API, browser, and fixture sizes. There was one synthetic
mailbox, one sender (Inbox 7 / archived 35), nine decided senders, 120 cleared
emails, an empty Triage queue, and three pending Screener senders. The fixture
never proxied a real API and rejected mutations. Telemetry keys were empty.

Account-deletion and Home summary/bootstrap responses each had a fixed 500ms
delay. History had a 1,500ms delay. Measurements include browser-tool overhead:
elapsed navigation plus a wait for the visible main count/identity. They are
readiness proxies, not LCP, INP, production percentiles, or throughput results.
Three alternating samples per build used warm browser asset caches; initial
uncached exploratory navigations are excluded from this table.

| Surface                        | Baseline samples ms | Candidate samples ms | Baseline median / max ms | Candidate median / max ms |
| ------------------------------ | ------------------- | -------------------- | ------------------------ | ------------------------- |
| Home                           | 1173, 1147, 1140    | 625, 613, 624        | 1147 / 1173              | 624 / 625                 |
| Sender detail, delayed history | 1590, 1550, 1561    | 612, 628, 616        | 1561 / 1590              | 616 / 628                 |

The final build additionally showed identity, Inbox 7, archived 35, and actions
in 618ms while history was held indefinitely. Its UI said “Loading decision
history”; releasing the fixture produced the real empty-history state. Navigating
back through Overview restored Home. Final smoke emitted no new browser errors
or warnings. Final initial Home hydration issued exactly one server request and
zero browser requests for each of summary, Triage bootstrap, and Screener count;
the later normal count poll is a separate request.

## Verification and limits

- Home/Screener/shell/server-prefetch suites: 203 tests passed across 18 files.
- Existing sender-detail UI suite: 69 tests passed, including progressive
  secondary loading, section failures/retries, mailbox reset, and action states.
- New route regressions reproduce each delayed secondary and immediate
  401/404/409 fallback. Home regressions cover parallel reads, cache reuse with
  a mounted badge subscriber, capability gates, missing mailbox, failed session,
  transient failure, and deadline cancellation with successful sibling retention.
- Full monorepo typecheck passed. Root lint passed with seven existing unused
  suppression warnings outside changed files. Formatting and diff checks passed.
- Final production web build passed. All 51 declared route bundle budgets passed
  and all 45 expected public routes remained prerendered. Implementation-log
  validation passed; this follow-up closes no new decision.
- This is local verification. Full CI, independent pre-merge review, authenticated
  real-account/provider E2E, deployment, and production verification remain separate.

The bounded Cloud Logging read for production API timings failed because local
GCP authentication requires reauthentication. No production latency distribution
or infrastructure saturation evidence was obtained. These frontend fixes do not
establish the cause of every intermittent slow load. After restoring access,
compare equal windows/releases with `scripts/summarize-performance.mjs` and
correlate API route timings, instance utilization, and database/pool wait before
changing capacity or regions. Existing session-plus-shell dependency latency on
other full refreshes remains a measurement target.

References: [Next.js parallel fetching and streaming](https://nextjs.org/docs/app/getting-started/fetching-data),
[TanStack hydration and request waterfalls](https://tanstack.com/query/latest/docs/framework/react/guides/ssr).
