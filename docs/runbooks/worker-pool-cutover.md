# Worker on a Cloud Run worker pool

The BullMQ worker (`apps/api/src/worker.ts`) runs as the Cloud Run worker pool
`declutrmail-worker-pool` in `us-west1`. Until this change it ran as the
`declutrmail-worker` service at min/max 1 instance with CPU always allocated.
That service is kept, disabled, as the rollback path.

## Why a lease came with the move

The worker must never run its outbox dispatcher in two processes at once: the
dispatcher's orphan guard (D13) only knows about consumer calls abandoned by
its own process. Cloud Run does not promise stop-before-start for worker pools:

- "Instance allocation adjustments are not instantaneous… Cloud Run might
  direct these requests to either a new revision or a previous revision during
  the transition period."
  ([instance splits and rollbacks](https://docs.cloud.google.com/run/docs/managing/workerpool-instance-splits-rollbacks))
- `gcloud run worker-pools deploy` takes no probe flags (checked against
  gcloud 588.0.0 `--help`). Probes have to be configured separately
  ([worker pool health checks](https://docs.cloud.google.com/run/docs/configuring/workerpools/healthchecks)),
  and this workflow configures none.
- "A successful worker pools deployment doesn't indicate a deployment health
  check was performed or that the runtime container health was validated."
  ([deploying worker pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools))

So every rollout can briefly run two worker processes. Service revision
rollouts already overlapped, and nothing guarded that either.
`OutboxDispatcherWorker` now claims rows only while it holds a Redis lease
(`packages/workers/src/outbox-dispatcher-lease.ts`, key
`declutrmail:outbox-dispatcher:lease`). The lease has a 30 s TTL, renews every
10 s from before the first claim, and treats itself as held for 5 s less
than Redis does, on a monotonic clock. Lease commands use a fail-fast Redis
connection, so a command that timed out is never replayed later. A stopping
process keeps it until its own abandoned consumer calls settle. A standby
takes over within one renewal interval of the holder releasing, or within
the TTL if the holder dies.

The one remaining risk: a holder that loses Redis for longer than the TTL
while its own abandoned call is still running cannot stop another process
from acquiring. Orphans mostly come from Redis or database timeouts, so this
risk is correlated with its trigger rather than independent of it.

## Cutover order (automated in `deploy-cloud-run.yml`)

1. The billing queue probe runs first, as before. It requires at least one
   worker on `email-send`, and every one of them must be compatible.
2. **Give the serving legacy worker the outbox lease.** While the
   `declutrmail-worker` service still serves, it is rolled to the new image
   (image and `SENTRY_RELEASE` only). Without this, the first overlap would
   pair a lease-aware pool with a service whose code ignores the lease. The
   step then checks that the new revision serves 100% of traffic, so a
   pinned older revision fails the deploy. Once the service is disabled,
   this step is a no-op.
3. **Record serving worker-pool revision** and its instance count. This is
   the rollback target if verification fails. It is empty on the first
   deploy.
4. **Deploy `declutrmail-worker-pool`** with `--instances=1`, 1 vCPU / 1Gi,
   the same runtime service account, env, secrets, and `node src/worker.ts`.
5. **Smoke worker-pool revision.** The pool must be Ready, reconciled, at
   manual scaling with 1 instance, and assigning 100% to its newest revision,
   within 3 minutes. That revision must then log `worker.listening` with
   `queue=outbox-dispatcher` within 10 minutes. `worker.boot_failed` fails
   the step at once.
6. **Verify billing notice worker.** This is the same env contract as before,
   read from the pool revision, plus the deployed image.
7. If step 4, 5 or 6 fails or the run is cancelled, **restore** the instance
   count and then the instance split recorded in step 3. A pool stopped by a
   rollback therefore stays stopped. On a first deploy, set the pool to `--instances=0`
   instead. The legacy service is still serving at that point.
8. **Disable the legacy worker service** with
   `gcloud run services update declutrmail-worker --scaling=0`. gcloud
   writes this as service-level annotations, leaving the revision template
   (and its 1/1 bounds) untouched, and nothing is deleted. Cloud Run: "To disable a service, you set scaling to zero"
   ([manual scaling](https://docs.cloud.google.com/run/docs/configuring/services/manual-scaling)).
9. The API deploys, unchanged.

## Before the first deploy (manual)

- Grant the deploy SA `roles/logging.viewer`. Step 5 reads logs, and the
  documented deploy grants in `prod-infra-bootstrap.md` do not include log
  read (the live policy was not checked). Without the
  grant the step fails and names this role, the first-deploy rollback
  disables the pool, and the legacy service keeps running.

  ```sh
  gcloud projects add-iam-policy-binding declutrmail-ai-prod \
    --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com \
    --role=roles/logging.viewer --condition=None
  ```

- Nothing else. `roles/run.developer` already includes
  `run.workerpools.create/get/list/update` and `run.services.update`
  ([Cloud Run roles and permissions](https://cloud.google.com/iam/docs/roles-permissions/run)).
  `roles/iam.serviceAccountUser` on `declutrmail-api@` (actAs) is the same
  grant the service deploy and the billing probe job use today.

## After the first deploy

```sh
gcloud run worker-pools describe declutrmail-worker-pool --region=us-west1 --project=declutrmail-ai-prod
gcloud run services describe declutrmail-worker --region=us-west1 --project=declutrmail-ai-prod \
  --format='value(metadata.annotations)'   # scalingMode=manual, manualInstanceCount=0
node scripts/check-billing-queue-runtime.mjs   # needs the deploy-workflow env; or rerun the workflow
```

Also confirm that `/api/worker-readyz` stays green. The worker's DB heartbeat
does not depend on where the process runs.

## Rollback to the service

Run these in order. Starting the service before stopping the pool avoids a
gap with no worker, and both sides run lease-aware code after step 2 of the
cutover.

```sh
# 1. Resume the legacy service. `auto` restores the revision's min/max 1/1.
gcloud run services update declutrmail-worker --scaling=auto \
  --region=us-west1 --project=declutrmail-ai-prod
gcloud run services describe declutrmail-worker --region=us-west1 --project=declutrmail-ai-prod \
  --format='yaml(spec.template.metadata.annotations,status.conditions)'
# expect autoscaling.knative.dev/minScale: '1', maxScale: '1', Ready True

# 2. Stop the pool.
gcloud run worker-pools update declutrmail-worker-pool --instances=0 \
  --region=us-west1 --project=declutrmail-ai-prod
```

**A rollback does not survive the next release.** Every main deploy redeploys
the pool at `--instances=1` and disables the service again. To hold a
rollback, disable the "Deploy to Cloud Run" workflow, or revert the workflow
change. A plain `gcloud run deploy declutrmail-worker` does not change a
service's scaling mode, so step 1 must already have run before a reverted
workflow deploys.

To roll the pool back to an earlier pool revision instead:

```sh
gcloud run worker-pools update-instance-split declutrmail-worker-pool \
  --to-revisions=<revision>=100 --region=us-west1 --project=declutrmail-ai-prod
```

## Monitoring that still targets the service

These scripts filter on `resource.type="cloud_run_revision"` and
`service_name="declutrmail-worker"`, so they stop seeing the worker after the
cutover: `setup-infra-alerts.mjs`, `setup-infra-dashboard.mjs`,
`setup-stuck-mailbox-alert.mjs`, `setup-mailbox-lock-alert.mjs`,
`setup-billing-alerts.sh`, `infra-runtime-metrics.mjs`. Pool logs carry
`resource.type="cloud_run_worker_pool"` and
`resource.labels.worker_pool_name`.

- Absence alerts on worker log metrics (scheduler success, runtime
  observations, stuck-mailbox watchdog) will fire.
- Threshold alerts on worker logs or container metrics (memory, Upstash
  request limit) will go quiet.
- The worker heartbeat uptime check is unaffected.

Moving them needs a live re-apply. It is tracked in
`docs/log/founder-followups/2026-10-11-move-worker-monitoring-to-worker-pool.md`.

## Cost

These are list prices from [Cloud Run pricing](https://cloud.google.com/run/pricing)
(Tier 1, instance-based billing), for 1 vCPU and 1 GiB over a 30-day month
(2,592,000 s), before free tier:

|                               | vCPU-second  | GiB-second   | Month    |
| ----------------------------- | ------------ | ------------ | -------- |
| Service, CPU always allocated | $0.000018    | $0.000002    | ≈ $51.84 |
| Worker pool                   | $0.000011244 | $0.000001235 | ≈ $32.35 |

That is about $19.50/mo less. The service's actual bill was $50.51/mo (cited
in `deploy-cloud-run.yml`), consistent with the list price. The disabled
service costs nothing while it runs no instances. Rollout overlap adds
seconds of a second instance per release.
