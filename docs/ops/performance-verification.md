# Performance verification and capacity changes

Use equivalent production-build workloads and comparable time windows. Record the release, sample count, cache state and inbox size with each result. A bundle budget, one fast SQL execution or a health-check p95 is not an end-user latency result.

## API read timings

The existing `http.request` log contains route templates, status and elapsed time, including authentication guards and response transfer. Health/readiness probes are excluded. `HTTP_PERFORMANCE_SAMPLE_RATE` adds a bounded `operations` object on sampled requests (default `0.1`; `0` disables; `1` samples every request). The allowed names are:

- `auth.sync-state`
- `triage.enrichment`
- `autopilot.observe`
- `activity.lineages`
- `activity.stats`
- `followups.scan`

Each entry has count, failures, total duration and maximum duration. These are application read durations, including database network and pool waits. They are not SQL engine execution times. Concurrent operations may overlap: do not subtract their summed duration from request duration. There are no query strings, SQL text, parameters, mailbox identifiers or error payloads in these counters. Sampling has no dependency on Sentry/PostHog.

Export an equal-duration Cloud Logging window for the intended API revision as JSON, selecting `jsonPayload.kind="http.request"`, or use local JSON-line logs. Summarize locally:

```sh
node scripts/summarize-performance.mjs /absolute/path/to/http-logs.json
```

The summary separates status classes, removes health probes and only emits latency metadata. Compare sample counts as well as p50/p95/p99. Keep the source log export private; the tool intentionally does not copy arbitrary log fields. Sparse traffic does not establish a production SLO.

Use fresh deltas of `pg_stat_statements` over the same window to investigate SQL. Match statement IDs to current source before prioritizing: statistics can contain long-retired queries. Do not reset shared production statistics simply to produce a clean chart.

## Browser and worker checks

Use a production build to compare cold/warm Senders, inspector selection, Triage, Activity, Billing and public routes. Test small devices and large loaded collections. Measure click-to-useful-content, request ordering and interaction delays as well as JavaScript bytes. Standard p75 targets are LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1; these are targets, not claims about this release.

Sender-list tests separately count component renders at large row counts; those results show avoided React work, not milliseconds of browser speedup. Worker scheduling tests use delayed fixtures to prove concurrency/refill and cancellation ordering, not Gmail throughput.

For sync and maintenance, inspect job waiting/execution time, mailbox lock wait/hold time, rate-limit retries and time since successful reconciliation. Retain shared provider quotas. Increased throughput must not hide stale mailboxes or overlap a retry with an attempt still cleaning up.

## Explicit pool budget

| Setting                             | Default | Purpose                                             |
| ----------------------------------- | ------- | --------------------------------------------------- |
| `API_DB_POOL_MAX`                   | 10      | API clients per instance; validated 1–20            |
| `WORKER_DB_POOL_MAX`                | 10      | Worker main query pool                              |
| `WORKER_LOCK_POOL_MAX`              | 10      | Independent session advisory-lock pool              |
| Worker listener                     | 1       | Reserved listener connection                        |
| `WORKER_SWEEP_STATEMENT_TIMEOUT_MS` | 25000   | Transaction-local reconciliation statement deadline |

The deployment source caps the API at three instances and the worker at one. Nominal steady-state client slots are therefore **3×10 +10+10+1 =51**, before admin tools or other clients. If two API revisions each reached their revision cap during rollout, the nominal envelope would be **81**. These are client slots, not PostgreSQL backend occupancy: transaction pooling changes the relationship, while session locks reserve backends. Verify actual pooler mode, pooler capacity, backend limits, pool waiting and rollout behavior before changing caps. Keep a separate lock pool; merging it with the main pool can create hold-and-wait deadlocks.

Do not rely on session-level `SET` to enforce deadlines through a transaction pooler. Reconciliation sets its statement deadline inside each transaction. The job timeout signals cancellation and waits for cleanup; each external operation also needs an actual provider/SQL deadline.

The checked-in deploy manifest explicitly supplies the pool and sampling defaults, so its full-replacement environment update retains them on later releases.

## API region evaluation and cutover

Repository configuration currently specifies API `us-central1`, worker `us-west1`; the inspected database is in `us-west-2`. The worker-region decision already accounts for KMS locality and caching. Do not move KMS or the worker as an incidental part of an API change.

Before changing `REGION` in `.github/workflows/deploy-cloud-run.yml`:

1. Reauthenticate the existing GCP CLI account and read the actual API service, traffic, concurrency and domain/load-balancer configuration. The September 22 review could not complete that read because credentials required reauthentication.
2. Establish current route p95 and database round-trip time, separating SQL execution from network/pool waiting. Use a representative authenticated test account and avoid mutation endpoints.
3. Prepare the target API revision in Oregon without switching the public hostname. Preserve its service account, bound secrets, callback URLs, CORS, cookie domain, webhook signature verification and public webhook audience. Validate readiness and read paths.
4. Compare the same read workload, including cold starts and user-to-API latency. Review target-region domain support and certificate readiness. Prepare exact DNS/load-balancer changes and reversal before switching anything.
5. At an explicitly scheduled production cutover, route the existing hostname to the verified target, monitor errors/latency and revert routing if checks fail. Retain the former service until rollback is no longer needed; remove duplicate capacity deliberately afterward.

No region, DNS, certificate or production service change is part of local verification. A region move without those routing checks can cause an outage even if the new container is healthy.

## Search-index decision, September 22

Read-only, 3-second-limited execution-plan probes used a mailbox with **8,072 senders**, selecting IDs only and returning plans rather than sender data. The mailbox selector added approximately 3–4 ms; these are simplified search predicates, not the full Senders endpoint.

| Case                       | Existing predicate, warm executions | Text-cast comparison, warm executions |
| -------------------------- | ----------------------------------- | ------------------------------------- |
| Common substring, limit 51 | 8.957 / 8.804 ms                    | 8.812 / 9.035 ms                      |
| No matching substring      | 46.768 / 41.537 ms                  | 41.071 / 39.835 ms                    |

First executions were much slower (377 and 453 ms), so comparing a first execution against a warm variant would falsely imply a dramatic optimization. Warm plan buffers were already cached. These observations do not isolate every source of first-execution latency or establish a p95.

No text cast, new extension, trigram index or index deletion was justified by this bounded sample. Retain the existing mailbox/sort indexes and literal, case-insensitive search semantics. Reconsider trigram indexes if representative endpoint traces show search SQL dominates, especially at larger account sizes; test Unicode/literal wildcard parity, short search terms, storage and write cost first. The existing Activity recovery index already starts with `root_action_id`; do not duplicate it without plan evidence.

References: [Supabase timeout semantics](https://supabase.com/docs/guides/database/postgres/timeouts), [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html), [Web Vitals](https://web.dev/articles/vitals).
