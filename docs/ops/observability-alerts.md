# Operational alert runbook

These are initial sustained guardrails, not capacity-test conclusions or a launch SLO.
Keep API availability, DB-backed readiness, worker heartbeat, queue progress and
telemetry freshness separate. A missing measurement is unknown; a successful
collector does not mean every dependency is healthy.

## Provisioning and verification

`node scripts/setup-infra-alerts.mjs declutrmail-ai-prod` prints an offline plan.
Add `--runtime` to review the aggregate log metric definitions and runtime rules.
Nothing changes without `--apply`. Existing unrelated policies are preserved;
updates select exact names and reject duplicates. Alerts use the existing enabled
admin email channel. Do not create parallel notification channels.

1. Deploy the aggregate telemetry and heartbeat code. Verify production revision,
   `/api/worker-readyz`, structured log fields and five-minute cadence. Confirm
   each expected source and each named queue emits success or failure, with no mailbox/job labels.
2. Run `node scripts/setup-infra-alerts.mjs declutrmail-ai-prod --runtime --metrics-only --apply` to provision log metrics without alerts. Runtime distributions have
   no historical backfill. Validate emitted observations against metric readback;
   allow ingestion delay. Do not substitute older daily DB connection samples.
3. Apply reviewed policies using `--apply --worker --runtime`. The worker uptime
   check additionally refuses installation if its endpoint is not currently healthy.
   Runtime rules require the telemetry deployment first; `--runtime` explicitly
   opts in to runtime rules. Activation refuses missing/stale/failed-only samples for any expected source; at least one successful observation within 20 minutes is required for mailbox/scheduler/database/reconnect and each of the four expected queues.
4. Query every new metric/PromQL expression in the project and inspect all returned
   series and label cardinality. The tests validate local contracts, not Cloud
   Monitoring acceptance. Inspect existing policies/channels after application.
5. Open the exact shared dashboard in the intended authenticated account. Confirm
   populated panels, labels, units, freshness and links. Billing export and invoice
   gaps remain explicit; no-data is never represented as zero spend.

## Signals and first response

| Signal            | Initial trigger                                                                                          | Response                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 5xx           | >5%, >=3 errors and >=20 requests over 5m, sustained 5m                                                  | Compare deployment timing and response classes; inspect DB/Redis failures. Includes health traffic; low-volume outages are covered by uptime.                                                                                            |
| API latency       | Worst revision/status p95 >2,000ms for 10m                                                               | Inspect DB pool wait, external calls and recent deployment. Native route aggregation and sparse traffic limit interpretation.                                                                                                            |
| Memory            | Worst revision p95 >90% for 10m                                                                          | Inspect OOM/restarts, heap growth, concurrency and actual allocation. Do not shrink memory based on idle CPU.                                                                                                                            |
| Gmail Pub/Sub     | Oldest unacked >300s for 5m                                                                              | Inspect push delivery/API errors. Do not purge, acknowledge or reset subscriptions to clear an alarm.                                                                                                                                    |
| Internal queue    | Sampled waiting job age since creation >300s for 10m                                                     | Inspect named queue, worker errors, concurrency and Redis. Currently delayed/prioritized jobs are excluded from age; waiting jobs include prior delays/retries. This is not exact elapsed queue wait. Do not replay failed jobs blindly. |
| DB connections    | Sampled connections/max_connections >80% for 10m                                                         | Inspect pool configuration, connection leaks and idle transactions. Platform/reserved slots reduce practical headroom.                                                                                                                   |
| Scheduler         | Last success older than 2 ticks + grace: watch 13h, snooze 40m, deletion 20m, billing 30m; sustained 10m | Inspect cron ledger and queue consumers. These limits derive from configured 6h/15m/5m/10m cadence, not traffic. No recorded success for 15m is a separate condition.                                                                    |
| Runtime collector | Source or expected queue absent 20m or repeated failures 10m                                             | Inspect telemetry errors and deployed revision. One successful queue cannot erase another queue's failure.                                                                                                                               |
| Daily collector   | No snapshot for 25h, continuously absent another 5h                                                      | Inspect existing GitHub daily workflow and metric publisher. Do not duplicate vendor collection or repeat product smoke.                                                                                                                 |
| Worker heartbeat  | More than one uptime region fails for 2m                                                                 | Inspect worker process/DB and deployment. Endpoint itself requires heartbeat newer than 3m; this does not prove queue throughput.                                                                                                        |

Reconnect incident charts use a rolling 24-hour creation window. Outbox dispatched
means consumer-handled, not email delivered; subsequent successful sync is an
association, not attribution or a conversion rate.

The reconnect email counter reads only `worker.succeeded` for `EmailSendWorker`
with `result.kind=gmail-reconnect`. Outcome `sent` means the provider accepted the
request, **not delivered to an inbox**. Other closed outcomes are skips (recovered,
suppressed, opted out, no recipient/address, or delivery disabled/rejected). Counts
are worker outcomes, not unique recipients; failed attempts before worker resolution
are not represented in this counter. Confirm real delivery using provider events
and the authorized inbox, not this chart. This new metric requires provisioning
before it can accumulate observations; it does not backfill prior email outcomes.

Queue/mailbox/DB/scheduler values are five-minute samples stored as log
**distributions**, not instantaneous gauges. Their displayed p99 is approximate and
must not be summed into users or jobs; mailbox reasons can overlap. Sync durations
are worker attempts, including retries, not signup funnel conversion. Outcome `resolved` includes skipped/no-op runs and must never be labelled completed sync or used as a sync success rate. Scheduler
success age is absent when no success exists; the missing-success rule covers it.

## Stuck mailboxes

Two paths watch for a mailbox broken past the 2-hour grace window with nothing
recovering it. Each keeps "known" and "new" apart, so a mailbox stuck for weeks
cannot hide the next one.

- **Cloud Monitoring (the pager).** The worker sweeps every 15 minutes and logs
  `mailbox.stuck_unnoticed` once per stuck mailbox, then
  `stuck_mailbox_watchdog.completed`. "Mailbox stuck: broken past grace window,
  unnoticed" opens one alert per mailbox and reason, named in the subject.
  Acknowledge a known one in the console; the next stuck mailbox still opens
  its own alert. An alert closes about 30 minutes after its mailbox recovers, so
  a mailbox that breaks again pages again. "Stuck-mailbox watchdog silent" pages
  when no sweep has completed for over an hour; while it is open, the first
  policy cannot see newly stuck mailboxes.
- **GitHub watchdog (the backstop).** `sync-stuck-watchdog.yml` reads
  `provider_sync_state` directly, so it works when the worker or Cloud Logging
  does not. It fails only for a stuck row missing from
  `scripts/known-stuck-mailboxes.tsv`; listed rows print as warnings on every
  run. An entry matches one mailbox at one stuck-since instant, so a retry that
  fails again is new. To acknowledge a row, paste the line the failing run
  prints. GitHub starts this schedule a few times a day, not every 5 minutes.

`node scripts/setup-stuck-mailbox-alert.mjs declutrmail-ai-prod` prints the
plan. `--apply` converges both log metrics and both policies in place and
refuses the silent-watchdog policy until the worker has logged a completed sweep
in the last 20 minutes. Switching the first policy to per-mailbox opens one
alert, and sends one email, for each mailbox already stuck.

`--starve-test` then proves on production data that a freshly stuck mailbox
opens its own alert while the already-stuck ones stay open, and that the
absence probe fires for a heartbeat that never existed. It uses a temporary
metric and two test policies with no notification channel, writes one synthetic
line that the production metric filters out (`jsonPayload.starveTest`), deletes
what it created, and pages nobody.

## Isolated notification delivery rehearsal

This test sends one clearly identified test incident to the existing authorized
admin channel. It does not stop production, touch Gmail or mutate customer state.

1. Resolve and record the current admin channel resource name and enabled status.
   Create a unique run ID and record an explicit cleanup deadline (15 minutes).
2. Create one temporary GAUGE/DOUBLE metric
   `custom.googleapis.com/declutrmail/alert_delivery_test`, resource `global`,
   label `run_id`. Create one temporary policy whose filter matches **only that
   run ID**, threshold >0, duration 0s, ALIGN_MAX/60s. Use the existing channel,
   policy title `TEST ONLY — DeclutrMail alert delivery — <run ID>`, and auto-close
   1800s. This metric is deliberately outside all production alert filters.
3. Publish value 1 with the actual current timestamp, then poll incident state
   without generating additional triggers. Verify the notification in the
   authorized admin inbox (subject/run ID, incident link and timestamp). API policy
   creation or an open incident alone is not evidence of email receipt.
4. Publish value 0 to the same series, verify recovery, disable/delete the exact
   temporary policy, and delete the temporary metric descriptor when no other test
   references it. Use a `finally` cleanup path even if receipt verification fails.
5. Record run ID, policy/incident IDs, trigger and receipt/recovery times, and
   cleanup results. If inbox access is unavailable, report delivery **unverified**;
   do not simulate a real outage to obtain stronger evidence.

This proves Monitoring-to-channel delivery only. Reconnect emails require their
separate authorized recipient and account test; alerts are not customer outreach.

## Cost and scope

The runtime metric set uses only bounded queue/reason/source/worker/outcome labels.
Never include mailbox IDs, job IDs, message content, addresses or exception text in
labels. One exception: `stuck_mailbox_unnoticed` is labelled by mailbox, because one
alert per stuck mailbox is its purpose. Its series exist only while a mailbox is
stuck, so there are only as many as stuck mailboxes (a policy opens at most 1,000
alerts at once). Log-based metrics and alert policies can add monitoring charges; inspect
billing after deployment. Preserve raw forensic logs, recovery queues and required
retention. Do not lower logging thresholds or suspend production to reduce noise.

Definitions: `scripts/infra-runtime-metrics.mjs`,
`scripts/setup-infra-alerts.mjs`, `scripts/setup-infra-dashboard.mjs`,
`scripts/setup-stuck-mailbox-alert.mjs`.

## Gmail push dead-letter recovery

The production `gmail-push-sub` retries with 10–600 second backoff and forwards
persistent failures to `gmail-push-dead-letter` after approximately 100 delivery
attempts. The pull-only `gmail-push-dead-letter-sub` retains messages for seven days
and never expires. The primary subscription also never expires. A separate backlog
alert fires when the dead-letter subscription has undelivered messages.

1. Inspect endpoint status/error classes, authenticated request handling and
   queue/database health before reading message payloads. Preserve OIDC rejection;
   authenticated disconnected-mailbox notifications are terminal no-ops.
2. Inspect a bounded sample without auto-acknowledging it. Treat notification
   payloads as private mailbox metadata; never paste them into logs or issues.
3. Repair the cause and verify the deployed handler and downstream queue. A replay
   must preserve the original notification identity and existing deduplication and
   history ordering. Do not publish the wrapped dead-letter envelope directly to
   the primary topic. Review selected messages before any replay or acknowledgement.
4. Verify enqueue/processing outcomes before acknowledging selected dead letters.
   Never purge the subscription to clear an alert. Seven-day retention is a recovery
   deadline, not indefinite storage; escalate before it expires.

Configuration readback verifies the controls, not end-to-end dead-letter delivery
or inbox notification receipt. Those rehearsals need their own evidence.

Rollback: clear the primary subscription's dead-letter and retry policies to return
to the previous delivery configuration; retain the dead-letter topic/subscription
and its messages for investigation. Restore expiration only if intentionally
accepting idle-subscription deletion. Disable the specific dead-letter alert only
when its replacement monitoring is established.
