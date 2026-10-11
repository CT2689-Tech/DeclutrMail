# Worker on a Cloud Run worker pool

The BullMQ worker (`apps/api/src/worker.ts`) runs as the Cloud Run worker pool
`declutrmail-worker-pool` in `us-west1`. Until this change it ran as the
`declutrmail-worker` service at min/max 1 instance with CPU always allocated.
That service is kept, stopped, as a rollback target and is never deleted.

## Never two workers: stop, prove zero, then start

Every worker process runs the outbox dispatcher, 15+ interval schedulers
(billing reconcile, account-deletion sweep, Brief, undo expiry…) and the cron
consumers. Two processes at once would run each of them twice, so no
transition may overlap. Cloud Run does not prevent it:

- "Instance allocation adjustments are not instantaneous… Cloud Run might
  direct these requests to either a new revision or a previous revision during
  the transition period."
  ([instance splits and rollbacks](https://docs.cloud.google.com/run/docs/managing/workerpool-instance-splits-rollbacks))
- "A successful worker pools deployment doesn't indicate a deployment health
  check was performed or that the runtime container health was validated."
  ([deploying worker pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools))
- `worker.ts` (#974) records that Cloud Run validates a new revision even at
  manual zero instances, so `worker-pools deploy --instances=0` still boots one
  worker briefly.

So every transition — release, first cutover, failed-release restore,
cancellation and the manual rollbacks below — follows one order: scale whatever
runs to zero, prove zero running instances, and only then start exactly one
executor. The gap with no worker costs latency only: BullMQ jobs wait in Redis,
and outbox rows wait in Postgres.

The release workflow does this through `scripts/worker-executor.mjs`.

### How zero is proven

The Cloud Run Admin API reports a desired count, never a running count. A zero
is proven for each executor in two parts:

1. The desired count is 0 (`scalingMode=manual`, `manualInstanceCount=0`) and
   reconciled (`status.observedGeneration == metadata.generation`). A resource
   that does not exist runs nothing. This moment is the reference.
2. `run.googleapis.com/container/instance_count` for that resource, aligned to
   60 s windows (max per series, summed): the latest window that starts after
   the reference must be 0. The metric is "sampled every 60 seconds" and "not
   visible for up to 120 seconds"
   ([Cloud Run metrics](https://cloud.google.com/monitoring/api/metrics_gcp_p_z#gcp-run)),
   so this takes about 3–4 minutes.

The metric's docs do not say whether a resource with no instances reports 0 or
nothing. Silence therefore counts as zero only 5 minutes after the last running
window, and only if `declutrmail-api` (min 1 instance, us-central1) has a
sample in the same period, which proves Monitoring is current. Anything else
is unverified, and unverified never starts an executor.

Each release also runs a positive control before it is marked verified: the
started pool instance must appear in the pool's own `instance_count` series. A
series that never shows a running instance could not show one stopping.

### What the outbox lease adds

`OutboxDispatcherWorker` claims rows only while it holds a Redis lease
(`packages/workers/src/outbox-dispatcher-lease.ts`, key
`declutrmail:outbox-dispatcher:lease`; 30 s TTL, renewed every 10 s, held
locally 5 s less than in Redis on a monotonic clock). It is defense in depth
for whatever bypasses the release order, such as a manual start or scale-up,
and it has limits:

- It covers the outbox only. Schedulers and cron consumers take no lease.
- It is not a fence. No token travels with a claimed row or consumer call, so
  nothing downstream rejects a stale holder. A holder that loses Redis for
  longer than the TTL while its own call still runs cannot stop a successor
  from dispatching beside that call.

Renewal starts after the dispatcher's `onReady` hook, where #974's email
runtime admission enrolls consumers, so a takeover cannot claim before
enrollment. #974's `EmailRuntimeLease` is separate and OFF; its enable path
reads the service-only `K_REVISION`, and #974 requires it to stay off under
worker pools until pool identity and drain are added. The pool deploy's
`--set-env-vars` replaces the whole environment, so neither
`EMAIL_RUNTIME_LEASE_ENABLED` nor `WORKER_ADMISSION_HELD` is set there.

## Release order (automated in `deploy-cloud-run.yml`)

1. The billing queue probe runs first, as before. It requires at least one
   worker on `email-send`, and every one of them must be compatible.
2. **Plan.** Records the rollback target: the pool at its serving revision and
   count when the pool runs, otherwise the legacy service when it runs,
   otherwise nothing. It reads Monitoring and Logging first, so a missing
   permission fails before anything changes.
3. **Stop every worker and prove zero.** `services update declutrmail-worker
--scaling=0` and `worker-pools update --instances=0`, then the zero proof for
   both.
4. **Deploy** `declutrmail-worker-pool` at `--instances=0`, 1 vCPU / 1Gi, the
   same runtime service account, env, secrets and `node src/worker.ts`.
5. **Start.** `update-instance-split --to-latest` (an earlier split onto a
   named revision persists across deploys), check the latest revision runs the
   built image, prove zero again (the validation boot), set `--instances=1`,
   and wait until that revision is Ready with 100% of one instance.
6. **Smoke.** That revision must log `worker.listening` with
   `queue=outbox-dispatcher` after the start, within 10 minutes.
   `worker.boot_failed` at any time fails it.
7. **Verify billing notice worker**, the same env contract as before, plus the
   deployed image.
8. **Mark verified** after the positive control above.
9. **Reconcile**, under `if: always()` (see below).
10. The API deploys, unchanged.

## Failure and cancellation

Each step writes its phase to a state file before it changes anything:
`planned → stopping → stopped → starting → verified`. The reconcile step runs on
success, failure and cancellation, and acts on the phase:

| Phase at reconcile              | Action                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| none / `planned`                | Nothing changed; nothing to do.                                        |
| `verified`                      | Assert the legacy service is stopped and the pool serves one instance. |
| `stopping`/`stopped`/`starting` | Roll back: stop all, prove zero, then start the recorded target.       |
| `rollback_*`                    | Repeat the rollback; every step is idempotent.                         |
| `rolled_back`                   | Nothing to do.                                                         |

A pool rollback is stop, prove zero, `update-instance-split
--to-revisions=<previous>=100`, wait for that split, then restore the previous
count. The failed revision never gets an instance back. A legacy rollback is
stop, prove zero, then `services update --scaling=auto`.

What can still go wrong, and what it leaves:

- **Zero cannot be proven** (Monitoring down, an instance that will not stop):
  nothing is started. That is an outage, not an overlap. The "DeclutrMail
  worker heartbeat stale" alert pages.
- **A second cancel, or the 120-minute job timeout,** kills reconcile mid-way.
  Since nothing starts before zero is proven, at most one executor is running.
- **No worker running blocks the next release** at step 1: the billing probe
  exits `no_workers`. Recover by starting the target manually (below), then
  re-run the workflow.

## Before the first deploy (manual)

Grant the deploy SA two read roles. Neither is in the documented deploy grants
in `prod-infra-bootstrap.md` (the live policy was not checked). Without them the
plan step fails before changing anything, the legacy service keeps running,
and the API is not deployed.

```sh
for role in roles/logging.viewer roles/monitoring.viewer; do
  gcloud projects add-iam-policy-binding declutrmail-ai-prod \
    --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com \
    --role="$role" --condition=None
done
```

Nothing else. `roles/run.developer` already includes
`run.workerpools.create/get/list/update` and `run.services.update`
([Cloud Run roles and permissions](https://cloud.google.com/iam/docs/roles-permissions/run)).
`roles/iam.serviceAccountUser` on `declutrmail-api@` (actAs) is the same grant
the service deploy and the billing probe job use today.

## After the first deploy

```sh
gcloud run worker-pools describe declutrmail-worker-pool --region=us-west1 --project=declutrmail-ai-prod
gcloud run services describe declutrmail-worker --region=us-west1 --project=declutrmail-ai-prod \
  --format='value(metadata.annotations)'   # scalingMode=manual, manualInstanceCount=0
node scripts/check-billing-queue-runtime.mjs   # needs the deploy-workflow env; or rerun the workflow
```

Also confirm that `/api/worker-readyz` stays green. The worker's DB heartbeat
does not depend on where the process runs.

## Manual transitions

Pause the "Deploy to Cloud Run" workflow first, or the next release replaces
the result: it stops everything and starts the pool on the latest revision
(`--to-latest`), which also undoes an in-pool rollback.

### Prove zero by hand

Run this after the stop, for the resource you stopped. Desired 0 and reconciled:

```sh
gcloud run worker-pools describe declutrmail-worker-pool --region=us-west1 \
  --project=declutrmail-ai-prod --format=json | jq '{
    count: .metadata.annotations["run.googleapis.com/manualInstanceCount"],
    reconciled: (.status.observedGeneration == .metadata.generation)}'
# the service: `gcloud run services describe declutrmail-worker …`, same jq
```

Running instances (per 60 s window). For the service, use
`resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker"`:

```sh
FILTER='metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="declutrmail-worker-pool"'
curl -sG -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  https://monitoring.googleapis.com/v3/projects/declutrmail-ai-prod/timeSeries \
  --data-urlencode "filter=$FILTER" \
  --data-urlencode "interval.startTime=$(date -u -d '-15 min' +%FT%TZ)" \
  --data-urlencode "interval.endTime=$(date -u +%FT%TZ)" \
  --data-urlencode aggregation.alignmentPeriod=60s \
  --data-urlencode aggregation.perSeriesAligner=ALIGN_MAX \
  --data-urlencode aggregation.crossSeriesReducer=REDUCE_SUM |
  jq '[.timeSeries[]?.points[] | {end: .interval.endTime, n: .value.int64Value}]'
```

Zero is proven when the newest window that starts after the reconciled stop
reads `0`. Empty output proves nothing on its own: accept it only 5 minutes
after the last non-zero window, and only if the same query for
`resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-api"`
returns recent points.

### Roll back to the service

```sh
# 1. Stop the pool, then prove zero for the pool (above).
gcloud run worker-pools update declutrmail-worker-pool --instances=0 \
  --region=us-west1 --project=declutrmail-ai-prod
# 2. Only then start the service. `auto` restores the revision's min/max 1/1.
gcloud run services update declutrmail-worker --scaling=auto \
  --region=us-west1 --project=declutrmail-ai-prod
gcloud run services describe declutrmail-worker --region=us-west1 --project=declutrmail-ai-prod \
  --format='yaml(spec.template.metadata.annotations,status.conditions)'
# expect autoscaling.knative.dev/minScale: '1', maxScale: '1', Ready True
```

A plain `gcloud run deploy declutrmail-worker` does not change a service's
scaling mode, so a reverted workflow that deploys the service needs step 2 to
have run already.

### Roll back to an earlier pool revision

Stop, prove zero, split, then count. Restoring the count before the split would
start an instance of the bad revision.

```sh
gcloud run worker-pools update declutrmail-worker-pool --instances=0 \
  --region=us-west1 --project=declutrmail-ai-prod
# prove zero for the pool (above), then:
gcloud run worker-pools update-instance-split declutrmail-worker-pool \
  --to-revisions=<revision>=100 --region=us-west1 --project=declutrmail-ai-prod
gcloud run worker-pools update declutrmail-worker-pool --instances=1 \
  --region=us-west1 --project=declutrmail-ai-prod
```

The split onto `<revision>` persists across later deploys
([instance splits and rollbacks](https://docs.cloud.google.com/run/docs/managing/workerpool-instance-splits-rollbacks)).
The release workflow resets it with `--to-latest` while the pool is at zero.
Run the same by hand before any manual deploy:

```sh
gcloud run worker-pools update-instance-split declutrmail-worker-pool \
  --to-latest --region=us-west1 --project=declutrmail-ai-prod
```

### Recover from zero workers

Prove zero for both the pool and the service, then start exactly one of them
with the last command of either rollback above.

## Monitoring

The monitoring scripts select the worker as
`resource.type="cloud_run_worker_pool"` with
`resource.labels.worker_pool_name="declutrmail-worker-pool"`. The selectors
live in `scripts/worker-pool-monitoring.mjs`, and
`scripts/worker-pool-monitoring.test.mjs` fails if any definition still
selects the old service. Signals that both the API and the worker log are
watched on both resource types.

Live resources change only when the scripts are re-run. Until they are
re-run after the cutover, absence alerts on worker log metrics fire and
threshold alerts on worker lines go quiet. The order and the manual commands
for the create-only scripts are in
`docs/log/founder-followups/2026-10-11-move-worker-monitoring-to-worker-pool.md`.
After a rollback to the service, the worker-only alerts go blind again.

## Cost

These are list prices from [Cloud Run pricing](https://cloud.google.com/run/pricing)
(Tier 1, instance-based billing), for 1 vCPU and 1 GiB over a 30-day month
(2,592,000 s), before free tier:

|                               | vCPU-second  | GiB-second   | Month    |
| ----------------------------- | ------------ | ------------ | -------- |
| Service, CPU always allocated | $0.000018    | $0.000002    | ≈ $51.84 |
| Worker pool                   | $0.000011244 | $0.000001235 | ≈ $32.35 |

That is about $19.50/mo less. The service's actual bill was $50.51/mo (cited
in `deploy-cloud-run.yml`), consistent with the list price. The stopped
service costs nothing while it runs no instances. Each release now leaves
roughly 10 minutes with no worker running (two zero proofs of 3–4 minutes
each, plus the deploy), and no overlap.
