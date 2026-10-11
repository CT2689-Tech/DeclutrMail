# Approved app billing notice rollout

The founder approved provider receipts/invoices and cancellation/pause emails plus
DeclutrMail app-access deadlines and complimentary-grant expiry notices. This
compatibility release depends on merged #925 and its existing strict event kinds, deduplication,
current recipient/suppression/access verification and 24-hour stale-message cutoff.
Root owns the production deploy workflow and this record; no other open PR touches
the workflow at preparation time. No notice producer is enabled by this first
phase. No payment, refund-restoration, checkout model,
grant duration or allocation policy is changed here.

One clearly labeled synthetic delivery test was authorized for the founder's test
mailbox and the existing app sender. The current React Email template was rendered
with fictional grant/date/plan details and a prominent test banner, visually
verified in the built-in browser, then sent once with a fixed idempotency key.
Resend returned delivery status `delivered` for
`01a128c6-0fcd-777b-a6d5-6e11c4d65c0c`, created October 11 at 02:23:51 UTC. The
sending domain was verified; the suppression lookup returned no entry. This proves
template/transport delivery. Existing application routing/deduplication tests are
separate evidence; no production plan or grant was mutated to manufacture an event.

Fresh WIF readback #38105067468 at 02:25:04 UTC confirmed API
`declutrmail-api-00596-zoq` and worker `declutrmail-worker-00156-6ts`, both serving
100% of traffic with the reviewed notice-capable source. Local gcloud reads still
failed authentication; the WIF fallback succeeded. Main remained
`ec866c06c0d2a78c57297e80a3ab7d7cf5392cb1`. This is capability proof before activation,
not evidence that the new flags were already enabled.

Independent review identified a queue rollout bug before activation: a disabled
older consumer could claim a billing email from the generic queue and complete it
as `skipped_recovered`. The regression failed against the old resolver and passes
after it refuses disabled/unenrolled delivery. Refusal alone would spend a finite
retry budget, so this release isolates billing jobs into `billing-email-send` and
does not register its consumer while notices are OFF. Outbox routing stays available
while delivery is OFF, preserving waiting jobs without consuming retries. Generic
email actors cannot claim this queue. Durable refusal records and bounded queue
telemetry identify the actual new queue.

The deploy manifest explicitly keeps notices OFF on both services. Its inert
staging cutoff is `2026-10-11T02:30:00.000Z`; replace it with a fresh enrollment
instant after compatibility serving verification, in the first activation PR.
Thereafter routine releases must retain that instant. Subscription notices require
a new canonical transition; the grant scanner excludes expirations before
enrollment and enrolls current upcoming expirations. Provider cancellation/pause
app notices remain excluded. Automatic upgrade refund restoration stays off.

The normal deployment already rolls out and smokes the worker before the API. A new
read-only check requires one 100% serving worker revision with the exact release,
notice flag and enrollment instant before API producers deploy. A second check
verifies those properties on the serving API. Both refuse enabled automatic refund
restoration, including unknown secret-bound restoration flags. These checks output
booleans and revision/enrollment metadata only;
raw runtime environment values and secret references are not logged.

Generic email actors gain a broker-visible `billing-queue-v1` compatibility marker.
Before any enabled worker/producer deployment, the built reviewed image performs a
read-only broker inspection using existing WIF/Secret Manager credentials inside
CI. Every current generic email consumer must have that marker; empty, unavailable,
unnamed or mixed older actors fail closed before producer deployment. No client
addresses, credentials, jobs or email payloads are logged. This is a compatibility
check, not an inference from elapsed time or HTTP traffic alone. Ordinary shutdown
stops the outbox dispatcher before closing its generic email consumer.

Rollback is a reviewed manifest change setting `BILLING_APP_NOTICES_ENABLED=false`
for both services while keeping the enrollment instant. Keep notice-capable source:
disabled billing consumers leave published jobs waiting without spending attempts,
whereas older routers
can acknowledge unknown topics. Fresh-state rendering and the 24-hour cutoff still
control resumed sends. Do not clear queues, reset the enrollment instant, or enable
refund restoration as part of this rollout.

The historical changelog reconciliation #920 stays separate, as the founder
confirmed. Provider-revocable checkout architecture is still awaiting a decision;
the founder requested details, not implementation approval. Paddle live financial
cutover remains a separately confirmed operation.

Verification: the disabled-resolver RED result is retained in
`/tmp/billing-notice-rollout-red.log`; API notice/routing12 and operational telemetry6
tests passed. The real isolated Redis transport verifies a live legacy generic
consumer processes its own decoy but cannot take the billing job; OFF leaves zero
attempts and zero billing consumers, and the enabled isolated consumer completes
the job once. It also rejects unnamed/mixed generic actors and accepts the named
compatible actor only after the legacy actor closes. No email provider or
application database is used by that transport test. Its owned Redis server is
stopped in cleanup. All 56 worker tests passed, including the transport through
both an owned Redis process and the CI-style `TEST_REDIS_URL` service. The latter
uses a unique queue prefix and removes only its owned queues. All eight package
typechecks passed; final API/worker typechecks and touched-file lint also passed.
Sixteen synthetic controls
exercise the actual revision-check scripts, including wrong source, mixed traffic,
wrong cutoff, missing flag, enabled/secret-bound restoration and secret-noise
non-disclosure. The existing23 deployment safety tests pass. Independent final
review found no remaining material blocker for this flags-off compatibility
release. Its read-only broker queue avoids metadata writes. Activation remains a
separate PR after serving verification and the broker compatibility check. Exact
release and serving state must be read back after normal required CI/merge.
