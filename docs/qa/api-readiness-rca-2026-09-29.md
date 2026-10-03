# September 29 API readiness incident

## Finding and limits

The readiness and sustained-server-error emails describe one short dependency-probe incident, not evidence of two separate application outages. The immediate mechanism is verified: 17 `/api/readyz` requests returned 503 at approximately the configured two-second dependency timeout. The dependency that stalled was not recorded. A Redis probe connection stall is plausible because database-backed worker readiness stayed fast, but the available evidence cannot exclude a transient database connection stall. Do not present either as a proven vendor outage.

## Evidence

Cloud Logging was queried for the production API between 2026-09-29 15:10 and 15:18 UTC (08:10–08:18 America/Los_Angeles). All 230 entries came from one instance of revision `declutrmail-api-00391-sen`; there were no restart or Redis error entries in a separate 15:00–15:30 search.

Of 158 request records:

| Route                        | HTTP 200 | HTTP 503 |
| ---------------------------- | -------: | -------: |
| `/api/readyz`                |       34 |       17 |
| `/api/worker-readyz`         |       49 |        0 |
| `/api/healthz`               |       48 |        0 |
| `/api/webhooks/gmail/pubsub` |       10 |        0 |

The failed requests started at 15:12:25.172 UTC and ended at 15:15:53.438 UTC, with request latency 2.003–2.008 seconds. Readiness alternated with a successful check near the end. Worker readiness queries use the same injected database and generally completed around 93–129 ms. Some successful Gmail webhook handlers slowed substantially, including one at 9.4 seconds. This supports a transient degradation; it does not establish failed customer operations. No interactive user-route requests appear in this eight-minute sample.

The admin Gmail readiness incident `0.od785t9n3sxu` opened around 15:15 UTC and recovered around 15:17. The sustained-error incident `0.od78auaq6ubh` opened around 15:22 and recovered around 15:26. Its native Cloud Run request ratio explicitly includes health checks, uses a rolling five-minute window and requires five minutes above threshold. Those semantics and metric processing explain why the second email can arrive after request recovery. The broader 15:08–15:28 error query found exactly the same 17 readiness 503s and no other HTTP 5xx.

Worker logs show jobs continuing successfully during the incident. Separately, the watchdog reported old stuck-mailbox states (567 and 810 hours old); their age rules them out as newly created by this event. Those historical mailbox states need their own investigation.

## Confirmed code defect and correction

`ReadinessController` raced each dependency against a two-second timer, then swallowed every failure. Its comment assumed the client would log the cause. A local timer expiry does not emit a client error, so neither the failing dependency nor timeout reason survived in logs. Successful probes also left timeout timers pending until expiry.

The correction emits a structured `readiness.dependency_failed` record with `dependency`, `reason` (`timeout` or `error`) and `durationMs`. It never copies raw provider messages, connection details or mailbox data. Timers are cleared on settlement. Existing two-second timeout behavior and public response shape remain intact. This repairs the diagnostic gap; it is not a claimed fix for an unidentified dependency interruption. An in-flight operation can still outlive the response timeout; cancellation is outside this focused correction.

No alert thresholds or notification channels were changed for this incident. Health-check failures still count in the native server-error ratio, so correlated notifications remain possible.

## Verification and deployment status

Four added regression cases failed before the change: database timeout evidence, Redis timeout evidence, sanitized rejection evidence, and successful timer cleanup. After the change, the readiness and worker-readiness suites pass (15 tests). API type checking passes.

At the follow-up check, production was serving revision `declutrmail-api-00406-yih` and `/api/readyz` returned HTTP 200 with database and Redis both `ok`. Recovery preceded this code change. The diagnostic correction is prepared for review and has not been deployed by this task.
