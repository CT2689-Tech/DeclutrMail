# Observability verification — 2026-09-05

## Implemented in PR #726; not deployed

- Consent is still opt-in. Withdrawal during the PostHog dynamic import now stops initialization before automatic pageview capture. Later opt-in remains possible.
- Snooze mapping and wake paths persist the first invalid grant through the shared atomic reconnect incident/outbox writer. Missing initial sync state is created for an active account; duplicate callbacks do not duplicate the notice.
- Worker lifecycle logs now carry Cloud Logging severity. Reconnect email result categories survive the safe log allowlist. Provider acceptance is not inbox delivery.
- Five-minute aggregate observations cover affected mailboxes, durable scheduler success age, DB connection pressure, queue counts/age/pause flag and reconnect incidents followed by later successful sync. Attempt duration distinguishes resolved/rejected execution; resolved includes no-ops.
- Optional collection has SQL/Redis deadlines and bounded single-flight probes. Telemetry failure does not block sync, heartbeat or shutdown. No user/mailbox/job identifiers are metric labels.
- Runtime activation requires fresh successful observations for every source and each of the four queues. Missing measurements remain unknown.

## Verification performed

- 43 consent tests plus the real SDK transport test passed.
- Real Chromium smoke in this checkout: delayed SDK import + withdrawal, later opt-in with a captured request at a local fake endpoint, then withdrawal and reload. No browser errors. Harness is `docs/eval/consent-browser-smoke.cjs`. Its local-only CSP/automation overrides permit the fake endpoint and prevent PostHog bot filtering from invalidating the positive control; no events were sent to the production analytics project.
- Snooze/watch regression suites passed (35 tests); an additional missing-state watch regression passed in the updated 15-test watch suite.
- 20 worker lifecycle tests and five operational telemetry tests passed, including durable PGlite queries, failure isolation and stalled-probe non-overlap. An isolated real Redis/BullMQ check verified waiting-job age and queue pause semantics.
- API and worker typechecks, changed-file ESLint, format and diff checks passed. Eight alert/metric contract tests passed.
- Live GCP native metric descriptors, filters, aggregations and PromQL executed successfully. Snapshot: API p95 about 102 ms, memory fraction API 0.6895 / worker 0.3295, Pub/Sub oldest unacked 0 seconds; 61 API requests in the sampled five-minute window. These observations are not load-test or launch-capacity conclusions.

## Applied and read back in GCP

- Four new native policies: sustained API 5xx, latency, memory and Gmail Pub/Sub backlog. Existing daily collector policy retained. All 12 current policies are enabled, have one existing admin channel and no returned validity error.
- Runtime log metric definitions provisioned ahead of deployment. Definition acceptance is not data or dashboard usability verification.
- Current production revisions: API 00308-2b9, worker 00049-snv. `/api/worker-readyz` returns 404 and no new `ops.*` logs were found in the preceding hour. Runtime/worker alerts intentionally remain unactivated.

## Still required

- Complete the outstanding real account reconnect and transactional email smoke; the owner completes Google consent. Then merge/release PR #726 and verify production revision, heartbeat, collector logs, metric freshness and the exact authenticated dashboard URL.
- Isolated admin alert trigger/recovery and inbox receipt verification. Gmail connector requires reauthentication; no test notification has been sent yet.
- Sentry recent-issue triage requires read scopes. `sentry-read-token` was not present when checked; the existing build token cannot read issues.
- GCP billing export table exists but its last bounded check had no current-month rows. Cost availability remains unverified until real rows are read and published. Daily vendor snapshots and historical invoices must retain their source timestamps and coverage labels.

See `docs/ops/observability-alerts.md` for staged activation and alert rehearsal. This report is not a launch-ready sign-off.
