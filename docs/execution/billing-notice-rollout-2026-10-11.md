# Approved app billing notice rollout

The founder approved provider receipts/invoices and cancellation/pause emails plus
DeclutrMail app-access deadlines and complimentary-grant expiry notices. This
compatibility release depends on merged #925 and its existing strict event kinds, deduplication,
current recipient/suppression/access verification and 24-hour stale-message cutoff.
Root owns the CI/deploy workflows and this record; no other open PR touches
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

The compatibility deploy manifest explicitly kept notices OFF on both services. Its inert
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
read-only broker inspection. The first activation attempted the CI Secret Manager
route; the runtime-secret access correction below replaces it with the existing
runtime identity. Every current generic email consumer must have that marker; empty, unavailable,
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

## First activation candidate

Compatibility PR #934 merged at `2db0106a984824b3b56ff39ee71742064f21bafa`.
Normal queue CI #38106731265 and exact-main CI #38107055222 passed. Release
#38107055207 completed and independently checked the resolved serving worker/API
revisions against that release, notices OFF, the inert cutoff and automatic refund
restoration OFF. This is flag-value proof; snapshot environment names alone are not.

Fresh WIF snapshot #38107731484 at `2026-10-11T03:14:33Z` confirms API
`declutrmail-api-00602-rob` and worker `declutrmail-worker-00158-x9m`, each 100%
ready on `sha256:2952038307668efbae729d07a6ff03ea37476e2f90c69b67c1a6d263892aafe6`.
The release's immutable image digest maps to the exact merged source above. Local
gcloud reads still failed authentication and remain separate from this WIF proof.

The separate activation candidate sets notices ON and replaces the inert instant
once with `2026-10-11T03:15:41.000Z`, after compatibility verification. This timestamp
must remain stable during routine releases and rollback. Root owns the manifest
and integration; no other open PR touches it at preparation time. The approved
policy needs no additional human approval. Provider financial cutover remains
separate, and automatic upgrade-refund restoration stays OFF.

The real broker preflight is required before the enabled worker deploys: the worker
can publish grant notices during bootstrap. It refuses empty, unknown, unnamed or
mixed legacy actors before the first possible producer. The subsequent resolved
worker source/flag check gates API producers specifically. The first candidate
attempted the reviewed CI image/WIF route; its failure and replacement are recorded
below. The OFF foundation intentionally did not
perform this broker read; real capability proof is still required during the
activation release before any enabled service deploys.

Aggregate-only production read at `2026-10-11T02:50:23Z` found four active open-ended
grants, zero future-dated expiries and one historical expired grant. Historical and
open-ended expiries remain excluded; this is a timestamped observation, not a
guarantee against later legitimate grant changes. No grant, plan, account, queue or
provider record was changed to create a delivery event.

Activation readiness is conditional on independent review and all normal required
checks/queue validation. Production activation requires successful broker and both
serving checks plus fresh source/traffic/digest readback. The one synthetic email
delivery proves template/transport; no real business-notice trigger was manufactured.

Independent final review found no material finding in the activation diff and
passed all 16 controls with the new cutoff, 23 deployment tests and diff validation.
Root also passed the controls/tests, formatting and diff checks. No application
TypeScript changed in this activation candidate. Runtime broker and enabled serving
proof remain required by the release; this review does not claim activation.

## Runtime-secret access correction

Activation #935 merged at `4f2c25b1a50c2f5627f1e17b3e404ce008e574f5` after full
queue CI #38108184071 and exact-main CI #38108624643 passed. Release #38108624686
failed on `secretmanager.versions.access` in the broker preflight. Both service
deployment steps were skipped; the OFF compatibility revisions remain serving.
The failure is retained as a failed release, not a successful activation.

The deploy identity intentionally cannot read the Redis secret. This correction
uses the documented private diagnostic-job pattern under the existing runtime
service account, binding only `redis-url-prod` inside that job. No secret value is
exported to CI or the desktop, and no IAM permission is added. The job uses an
immutable image, explicit standalone probe entrypoint, one task, zero retries and
a 60-second limit. It does not import API/worker bootstrap or bind database,
payment, email or Gmail credentials. The read keeps `skipMetasUpdate=true`.

The preflight requires one completed successful execution with the expected
immutable image and runtime identity. It then deletes the exact owned execution
and job and requires successful metadata lists to prove absence before allowing
enabled service deployment. Uncertain/active executions are cancelled and their
terminal state checked; cleanup uncertainty refuses rollout. The helper emits an
ownership marker only after positive absence and immutable-image resolution,
before its create attempt. A separate always step retries cleanup of this
run/attempt's exact probe only when that marker exists; it cannot adopt or delete
a preexisting job after preflight refuses it. External runner termination may
still require operator recovery; it is
never counted as proof of cleanup. Runtime job permissions/broker compatibility
and real cleanup still require the next reviewed release's evidence.

Review identified and corrected three helper issues before release: Node's default
subprocess stderr forwarding is suppressed with explicit captured pipes, and
resource absence uses successful metadata lists instead of classifying a failed
`describe` as absence. Recovery now requires the owned-attempt marker. Ten
orchestration tests include a real subprocess privacy control and the actual
workflow's preexisting/unreadable ownership paths; five standalone probe tests
cover configuration, metadata-write exclusion,
failure cleanup and the read deadline. All 17 notice/probe tests, API typecheck,
touched lint, 16 serving-script controls and 23 existing deployment tests pass.
The real standalone Node/SWC command accepted a compatible actor and refused a
legacy actor against owned loopback Redis. No email provider or application
database was used; all test actors/connections and that Redis server were stopped.
Independent final review found no remaining material blocker and confirmed the
installed gcloud metadata projections. The expanded CI helper command passed
all 41 tests; both CI and manual releases now run the new regression tests.
Root owns this corrective preflight and integration; enrollment remains fixed at
`2026-10-11T03:15:41.000Z`, and automatic refund restoration remains OFF.

## Redacted production preflight diagnosis

Runtime-secret correction #936 merged at `2faa44067bfd806d99783441c1bef7d154b4b66f`.
Queue CI #38111192482 and exact-main CI #38111577157 passed, including all selected
release suites and browser journey assertions. Release #38111577109 built its
image but failed the preflight at `2026-10-11T04:34:11Z`, after absence/image
proof and the owned-attempt marker. Both service deployments were skipped. The
always recovery completed with `probeDeleted:true`; the failed run remains a
failed activation, and the underlying create-operation cause is unverified.

Fresh main-branch WIF snapshot #38112072598 at `2026-10-11T04:35:47Z` confirms the
OFF foundation API `declutrmail-api-00602-rob` and worker
`declutrmail-worker-00158-x9m` still serve 100%. Local reads remain separately
unavailable due to authentication. A temporary branch-only diagnostic
#38112268124 was refused by Workload Identity's attribute condition before a probe
ran; the main route remains available. The browser audit page separately requires
passkey verification. No IAM grant, credential export or billing policy change
has occurred.

The next correction holds both manifest notice flags OFF while preserving the
original enrollment instant. Current production notices are already OFF. This
restores ordinary service releases without adopting unverified broker access as
activation proof. The main-only `billing-queue-access-diagnosis.yml` uses existing
WIF, the reviewed built probe image, the same ownership/cleanup gates and the
shared production release lock. It never deploys a service or enables a producer.
The normal infra snapshot workflow is unchanged.

The helper emits only a fixed operation/category and allowlisted
permission names when a gcloud command fails. Its captured provider text and
arguments remain private. This preserves compatibility, source/identity checks,
ownership, cleanup and the producer gate; it does not claim to fix the underlying
runtime access issue. Root owns the two workflows, helper/test/record and
integration. The temporary snapshot
workflow replacement is confined to its diagnostic branch and is not included.
Independent final review found no blocker; all 36 helper/deployment tests,
touched lint, formatting and diff validation passed. No TypeScript runtime or
provider behavior changed in this correction. Re-enabling notices still requires
successful real broker/cleanup evidence and both enabled-serving checks.
The expanded hold/main-only diagnostic also passed independent review and all
32 actual serving-script controls across ON and OFF modes. The initial #938 queue
candidate was dequeued for this confirmed release-blocking defect; it is not a
production failure or serving proof.

The updated hold candidate's first CI #38113195202 failed the preexisting
JWT tampering fixture. Reconstructing its synthetic claims and test secret
confirmed that replacing the final two base64url characters with `XX` changed
only the encoding's unused padding bits; decoded signature bytes stayed equal
and the existing verifier correctly accepted the signature. The test now flips
one decoded signature byte, asserts that bytes changed, and re-encodes it before
requiring rejection. Authentication runtime is unchanged; the failed CI remains
recorded. Root also owns this bounded test repair; no other open PR touches it.
Independent review approved it; all 10 focused JWT tests, API typecheck, touched
lint, formatting and diff validation passed.
