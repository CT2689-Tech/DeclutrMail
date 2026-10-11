# Email runtime adoption, recovery, and rollback

Executable procedure for the sealed adoption witness. Production steps are
run by "Validate this" after a separate authorization. This document does
not authorize them. Fixture seals are not production certification.

Related record: [ownership, 2026-10-11](../execution/runtime-admission-ownership-2026-10-11.md).

## States

| State              | Meaning                                                                                                               | Current                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Ready              | PR checks green, not merged                                                                                           | This branch, when CI is green |
| Merged             | Squash is on main                                                                                                     | Not this change               |
| Deployed           | That main SHA is the serving revision                                                                                 | Not this change               |
| Adoption certified | A witness sealed from provider reads in the same command, rechecked before and after, with positive legacy retirement | No                            |
| Activation enabled | `BILLING_APP_NOTICES_ENABLED=true` on the serving API and worker                                                      | No. Leave this off            |

The incident stays open until adoption is certified from provider evidence.
Passing the local rehearsal does not certify it.

## Hosting

Supported enrollment is the Cloud Run service `declutrmail-worker` in
`us-west1`, identity `K_SERVICE` + `K_REVISION`. The API preference writer is
`declutrmail-api` in `us-central1`.

Worker pools (`CLOUD_RUN_WORKER_POOL`, `CLOUD_RUN_REVISION`) are refused.
Do not point the lease at `CLOUD_RUN_REVISION`. PR #972 is not a prerequisite
and is not adopted here.

## What the release gate does

`scripts/check-billing-queue-runtime.mjs` on an ordinary release:

- Requires the existing image-ref and project scope.
- Requires `BILLING_APP_NOTICES_ENABLED=false`.
- Refuses lease enrollment, a held revision, or `CLIENT_LIST_COMPATIBLE` /
  `BILLING_QUEUE_COMPATIBLE`.
- Does not call gcloud, does not list broker clients, does not mint a witness.
- Returns `release: allowed-off`, `adoptionCertified: false`,
  `activationEnabled: false`, `clientListConsulted: false`,
  `imageDigestVerified: false`.

`apps/api/src/billing/verify-billing-queue.ts` still exists for a private
task. It pings Redis and reads the lease registry with no witness, then
exits `110` (`adoption_unverified`). An env-supplied witness is refused
before connect. The deploy workflow does not launch that task.

Cleanup of a previously owned probe job remains `node
scripts/check-billing-queue-runtime.mjs --cleanup` with
`BILLING_NOTICE_PROBE_OWNED=true`. The OFF gate does not set that output.

## Witness predicates

`attestEmailRuntimeAdoption` seals evidence only when all of these hold.
`readEmailRuntimeLeases` recomputes the seal. A boolean bag, a mutated
digest, or a stale `observedAt` (outside 120s of the broker clock, valid for
5 minutes) is `runtime_adoption_unverified`.

- Reviewed source is 40 hex and matches the worker revision, the API
  revision, every workload, and the probe.
- Image digest is `sha256:` plus 64 hex, on both hosting snapshots and the
  probe.
- Hosting kind is `cloud-run-service` for project `declutrmail-ai-prod`.
  Worker region `us-west1`, API region `us-central1`.
- Configured generation equals observed generation on each service.
  Before and after snapshots hash equal (`observation_drift` otherwise).
- Traffic is 100 and tag routes are 0.
- Admission guard is `on` for the worker and the API. `off`, `unset`,
  `malformed`, and `held` refuse. A held worker must not enroll.
- Workloads cover `email-send`, `brief-email`, `outbox`, and
  `api-preference-writer`. `billing-email` is required when
  `billingConsumerRequired` is set. Worker identities are UUIDs on the
  worker revision. The API identity is the API revision.
- At least one legacy credential holder, none of them the new worker or API
  revision. Coverage `authoritative`, and process retirement, request drain,
  and external I/O settlement are each `true`. `unavailable` and `denied`
  stay failures. Provider revision status `retired` alone is not retirement.
- Outstanding work is `settled`.
- Retirement boundary is `positive-process-drain-io`. `password-reset`,
  `revision-metadata`, `namespace-migration`, and `registry-absence` are
  refused. Namespace migration does not fence an older shared outbox router.
- Probe id is owned and cleaned before and after, bound to the same source
  and digest.

Registry absence does not exclude an unregistered process. Rollback writes
the seal digest to `{prefix}:invalidated`. A later read of that seal is
`rollback_invalidated` and does not enable activation.

## API validation boot

The API process has no admission-held mode and does not write email
preferences during startup (`API_VALIDATION_START`). Cloud Run still boots a
new revision to validate it. The boundary is traffic: leave the new API
revision at 0% until the worker and outbox are attested. Do not add a flag
for this.

## Local rehearsal

Owned loopback Redis, BullMQ, and Postgres. No provider credentials.

```bash
export OUTBOX_TEST_PG_URL='postgres://postgres:postgres@127.0.0.1:5432/declutrmail_outbox_test'
pnpm --filter @declutrmail/workers exec vitest run \
  src/email-runtime-adoption.test.ts \
  src/email-runtime-lease.test.ts
node --test scripts/check-billing-queue-runtime.test.mjs
pnpm --filter @declutrmail/api exec vitest run \
  src/billing/__tests__/verify-billing-queue.spec.ts
```

The rehearsal creates `adoption_fx_<32 hex>` in the outbox test database,
drops it, and checks `to_regclass` is null. It does not point at production
Redis. CI sets `OUTBOX_TEST_PG_URL` and `TEST_REDIS_URL` on the workers job.

Covered there, and in the existing lease suite once the witness is sealed:

- Compatible processing on the real queue.
- Empty, malformed, stale, expired, mixed, held, and unknown actors.
- Late invalidation before send, lost BEGIN, readiness loss.
- Refusal leaves the job delayed with zero attempts and no provider call.
- Accepted acknowledgement is not sent again.
- Uncertain delivery stays retained.
- Real I/O still settling across shutdown.
- Source and generation drift, incomplete inventory, denied and unavailable
  coverage.
- Held install, API reopen, rollback, and table cleanup.

## Production procedure

Do not run this section from an unapproved session. Refresh every
observation in the same command that would seal a witness. Historical
revisions from 2026-10-11 18:22 UTC are not current.

1. Pause. Confirm serving env, do not change it yet:
   - `BILLING_APP_NOTICES_ENABLED=false`
   - `EMAIL_RUNTIME_LEASE_ENABLED` unset
   - `WORKER_ADMISSION_HELD` unset
   - Record project `declutrmail-ai-prod`, API `declutrmail-api` in
     `us-central1`, worker `declutrmail-worker` in `us-west1`, revision,
     generation, traffic percent, tag routes, image digest, and
     `SENTRY_RELEASE` for both. A denied read is `unavailable`, not absent.
     Four historical `me-central2` denials stay unverified.
2. Capture an immutable rollback baseline from those reads (revision, digest,
   source). Do not use `:latest`.
3. Install the worker revision with enrollment still off. A held revision
   (`WORKER_ADMISSION_HELD=true`) may answer health and must not open Redis,
   poll, or enroll. Do not treat HTTP 200 as an adopted worker.
4. When the attested worker and outbox are ready, enroll only that service
   revision (`EMAIL_RUNTIME_LEASE_ENABLED=true` is a separate manifest change
   and is not made by this runbook's gate). Re-read generations. Before and
   after snapshots must match.
5. Reopen the attested API by moving traffic only after the worker and outbox
   reads match the seal. Keep notices false.
6. Rollback: deploy the baseline revision and digest, write the seal into the
   invalidation record, and keep notices false. Rollback invalidates adoption
   proof. It does not enable activation.

Provider "Retired" on a revision is recorded and is not step 4.

## Provider evidence still pending

Upstash password reset is not a supported retirement boundary. "Validate this"
saw Pay as You Go and Fixed on the signed-in Personal account, no Free plan,
and a $1 budget rejected with "Budget must be at least $20". The form was not
submitted. No database, key, reset, or deletion was performed. Authorized
budget remains $0. Other free routes are unverified, not proven absent.

Until that rehearsal returns an actual result for already-authenticated TCP
connections, a new connection with the old credential, a new connection with
the new credential, and the old REST token, credential-holder retirement stays
fail-closed.

## Paid-test proposal — not approved, not started

Run only if "Validate this" cannot find a free route or an authoritative
provider contract that answers the connection-reset question.

- Resource: one empty Upstash Redis database, unique name, TLS on,
  auto-upgrade off. No production data and no production URL.
- Why: rejecting new connections is not enough, and a native Redis password
  change does not establish Upstash behavior for sessions that already
  authenticated.
- Cap: $20. That figure is the console minimum budget the account showed,
  not an observed charge. Do not exceed it. Do not treat it as a predicted
  invoice.
- Sequence: create the empty database; open two authenticated TCP sessions;
  reset the password; record whether each old session still commands, with
  timing and without secrets; open a new TCP session with the old credential;
  open one with the new credential; try the old REST token; delete the
  database; list databases and confirm the name is gone.
- Cleanup: deletion plus a follow-up list that does not contain the name.
  Stop if deletion cannot be verified.
- Recommendation: do not purchase yet. The code and rehearsal do not need
  this resource. Wait for an explicit approval.
- Confidence the paid database is required to finish credential retirement: 72. Free routes are unverified, not exhausted.
- Safety if the cap, empty database, and verified deletion are honored: 86.
  The score is not higher because a paid account change is still a provider
  write.

No production pause is proposed. OFF releases stay allowed. Activation stays
refused.
