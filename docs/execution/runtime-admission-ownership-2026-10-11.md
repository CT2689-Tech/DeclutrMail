# Runtime admission ownership — 2026-10-11

This session cannot read the Codex chat "Validate this"
(`01a124bf-d0bb-7213-a199-8cafa74fb60b`). Ownership, dependencies, and
integration instructions are here and in the PR body.

## Ownership

| Surface                                                                                                                                                                                                             | Owner                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sealed adoption witness, hosting classifier, retirement predicates, release-gate decision, isolated Redis/BullMQ/Postgres rehearsal, this record, and [the adoption runbook](../runbooks/email-runtime-adoption.md) | This session (`cursor/runtime-admission-witness-2985`)                       |
| Upstash provider rehearsal, billing manifest, production release coordination, and activation                                                                                                                       | "Validate this", until an explicit transfer                                  |
| Cloud Run worker-pool cutover (PR #972)                                                                                                                                                                             | That PR's session. It is not merged. This change does not rebase or merge it |

This session is the integration owner for the coupled witness, gate, and
rehearsal. Do not land those pieces as separate competing PRs.

## Hosting decision

Production worker hosting is still the Cloud Run **service**
`declutrmail-worker`. PR #972 (`cursor/worker-pool-migration-6392`, head
`9eb9c1cffcc48e30694323234526b2ecf31f398b` at inspection) is open and
conflicting. It was not used as a base.

Admission enrolls only when `classifyEmailRuntimeHosting` returns
`cloud-run-service`: `K_SERVICE=declutrmail-worker` and `K_REVISION` matching
`declutrmail-worker-*`. `CLOUD_RUN_WORKER_POOL` or `CLOUD_RUN_REVISION` is
unsupported (`worker_pool`). Both styles together are `mixed`. There is no
fallback from one variable to the other. A pool revision is not admitted,
drained, or retired by this witness.

#972 must keep that refusal. Adding `CLOUD_RUN_REVISION` as the lease
revision does not prove pool admission, drain, or retirement. Pool cutover
waits until those three are implemented and tested on their own. Until then
a pool deploy invalidates any service adoption proof.

## Shared files

| File                                             | Also touched by | Instruction                                                                                            |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/workers/src/email-runtime-lease.ts`    | none open       | Witness seal is required. Do not accept boolean bags again                                             |
| `packages/workers/src/email-runtime-adoption.ts` | none            | Predicate source of truth                                                                              |
| `packages/workers/src/index.ts`                  | #972            | Re-export the classifier; do not drop it in a rebase                                                   |
| `apps/api/src/worker.ts`                         | #972            | Lease identity comes from the classifier. Do not restore `requireEnv('K_REVISION')` as a pool fallback |
| `apps/api/src/billing/verify-billing-queue.ts`   | none            | Must not list broker clients or accept an env witness                                                  |
| `scripts/check-billing-queue-runtime.mjs`        | none            | OFF release gate. Do not recreate a client-list success path                                           |
| `.github/workflows/deploy-cloud-run.yml`         | #972            | Step stays, but it no longer launches a probe job                                                      |

## Dependencies and questions for "Validate this"

1. Provider rehearsal result is still absent. Credential retirement via
   password reset is an unsupported boundary until that result exists.
   Native Redis behavior is not a substitute.
2. Do not feed fixture seals (`sealedWitness` / `adoptionEvidence`) to
   production. A seal proves the predicates held for the object that was
   passed. It does not prove Cloud Run or Upstash said so.
3. Refresh serving revisions, generations, image digest, traffic, and flags
   before any production adoption step. The 18:22–18:24 UTC baseline in the
   handoff was not re-read here.
4. Activation stays off. This gate returns `activationEnabled: false` for
   every OFF release and refuses `BILLING_APP_NOTICES_ENABLED=true`.

## What this does not do

- It does not merge, queue, or deploy.
- It does not close the runtime-probe incident.
- It does not create a provider resource, reset a password, or pause production.
- It does not add a feature flag. `EMAIL_RUNTIME_LEASE_ENABLED` and
  `WORKER_ADMISSION_HELD` already exist and stay unset/off in the manifest.
