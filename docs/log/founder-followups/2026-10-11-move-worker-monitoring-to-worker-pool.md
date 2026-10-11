### 2026-10-11 — Re-apply worker monitoring for the worker pool after cutover
**Source:** PR #972 (`cursor/worker-pool-migration-6392`)
**Why:** After the cutover the worker logs and reports metrics as `resource.type="cloud_run_worker_pool"` with `resource.labels.worker_pool_name="declutrmail-worker-pool"` ([monitored resource reference](https://cloud.google.com/monitoring/api/resources#tag_cloud_run_worker_pool)). PR #972 moves every repo definition to that resource, but live resources change only when the setup scripts are re-run. Until then the absence alerts (scheduler success, runtime observations, stuck-mailbox watchdog) fire falsely, and the threshold alerts on worker lines and worker memory go quiet.

**Where each one is defined.** Every definition found is a repo script. There is no Terraform, no JSON policy file and no workflow step that writes monitoring. The `/api/worker-readyz` uptime check (`setup-infra-alerts.mjs --worker`) probes the API, so it is unaffected.

| Live resource | Defined in | After #972 |
| --- | --- | --- |
| Log metrics `ops_*`; policies "DeclutrMail scheduler success overdue", "DeclutrMail runtime observations missing or failing", and the `ops_*` pressure alerts | `scripts/infra-runtime-metrics.mjs`, `scripts/setup-infra-alerts.mjs` | worker pool only |
| Policy "DeclutrMail Cloud Run memory pressure" | `scripts/setup-infra-alerts.mjs` | API condition plus a worker-pool condition |
| Log metrics `stuck_mailbox_unnoticed` and `stuck_mailbox_watchdog_completed`; policies "Mailbox stuck: broken past grace window, unnoticed" and "Stuck-mailbox watchdog silent" | `scripts/setup-stuck-mailbox-alert.mjs` | worker pool only |
| Dashboard "DeclutrMail — infrastructure, cost and recovery" | `scripts/setup-infra-dashboard.mjs` | worker log charts read the pool; Cloud Run charts show the API and the pool |
| Log metric `bullmq_max_requests_errors`; policy "BullMQ: Upstash max-requests limit exceeded (worker)" | `scripts/setup-billing-alerts.sh` (create-only) | worker pool only |
| Log metric `llm_provider_rejected`; policy "LLM provider refused our calls (credit, limit or key)" | `scripts/setup-llm-rejection-alert.mjs` | API or worker pool, one condition each |
| Log metric `mailbox_lock_errors`; policy "Mailbox lock: leak or acquisition failure" | `scripts/setup-mailbox-lock-alert.mjs` | API or worker pool, one condition each |
| Log metric `billing_provider_read_blocked`; policy "Billing: provider read blocked or refund verdict frozen" | `scripts/setup-billing-verdict-alert.sh` (create-only) | API or worker pool, one condition each |

An alert condition's filter names exactly one resource type ([alertPolicies reference](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies)). That is why signals both processes log get one condition per type.

**Console-only resources:** none are defined outside the repo as far as the repo shows. The live project was not inspected: this session had no `gcloud` credentials. To list anything live that still selects the old worker service, including policies, metrics or dashboards created in the console:

```sh
P=declutrmail-ai-prod
gcloud monitoring policies list --project=$P --format=json \
  | jq -r '.[] | select(tostring | test("declutrmail-worker([^-]|$)")) | .displayName'
gcloud logging metrics list --project=$P --format=json \
  | jq -r '.[] | select(tostring | test("declutrmail-worker([^-]|$)")) | .name'
gcloud monitoring dashboards list --project=$P --format=json \
  | jq -r '.[] | select(tostring | test("declutrmail-worker([^-]|$)")) | .displayName'
```

After the steps below, all three commands should print nothing. Anything they do print is console-only: change its `resource.type="cloud_run_revision"` to `resource.type="cloud_run_worker_pool"`, and `service_name="declutrmail-worker"` to `worker_pool_name="declutrmail-worker-pool"`.

**How:** Run from a checkout of `main` after #972 merges, authenticated to the project.

1. **Any time; these work before and after the cutover:**
   ```sh
   node scripts/setup-llm-rejection-alert.mjs declutrmail-ai-prod --apply
   node scripts/setup-mailbox-lock-alert.mjs declutrmail-ai-prod --apply
   gcloud logging metrics update billing_provider_read_blocked --project=declutrmail-ai-prod \
     --log-filter='(resource.type="cloud_run_revision" OR resource.type="cloud_run_worker_pool") AND (textPayload:"verdict_unreadable" OR textPayload:"api_read.failed" OR textPayload:"reconcile_read.failed")'
   ```
   Then replace the policy "Billing: provider read blocked or refund verdict frozen", because the script skips a policy that already exists. Either delete it (`gcloud monitoring policies list --project=declutrmail-ai-prod --filter='displayName="Billing: provider read blocked or refund verdict frozen"' --format='value(name)'`, then `gcloud monitoring policies delete <name>`) and run `bash scripts/setup-billing-verdict-alert.sh`, or in the console add a second condition matching the existing one, with `resource.type="cloud_run_worker_pool"`.
2. **Right after the first post-merge deploy has cut over** (the pool is serving and the legacy service is at zero):
   ```sh
   node scripts/setup-infra-alerts.mjs declutrmail-ai-prod --runtime --metrics-only --apply
   node scripts/setup-infra-dashboard.mjs declutrmail-ai-prod
   gcloud logging metrics update bullmq_max_requests_errors --project=declutrmail-ai-prod \
     --log-filter='resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="declutrmail-worker-pool" AND jsonPayload.kind="bullmq.error" AND jsonPayload.message=~"max requests limit exceeded"'
   ```
   Then replace the policy "BullMQ: Upstash max-requests limit exceeded (worker)" the same way as in step 1: delete it and run `bash scripts/setup-billing-alerts.sh`, or in the console change its condition's `resource.type` to `cloud_run_worker_pool`.
3. **About 20 minutes after the cutover**, once the pool has written fresh runtime observations and a `stuck_mailbox_watchdog.completed` line:
   ```sh
   node scripts/setup-infra-alerts.mjs declutrmail-ai-prod --runtime --apply   # add --worker if it was used before
   node scripts/setup-stuck-mailbox-alert.mjs declutrmail-ai-prod --apply
   ```
   Both scripts refuse to install an absence alert until the pool's data exists. If one refuses, wait one more tick and re-run it. The old absence policies may open once between steps 2 and 3. They close when step 3 replaces them.

**If the worker is rolled back to the legacy service**, the worker-only alerts in steps 2 and 3 go blind again: absence alerts fire and threshold alerts go quiet. The step 1 resources keep working. Re-apply steps 2 and 3 from the commit before #972, or accept the gap until the pool is restored.

**Verifies by:** The three listing commands print nothing. In Metrics Explorer, `logging.googleapis.com/user/ops_collection_completed` and `logging.googleapis.com/user/stuck_mailbox_watchdog_completed` show points on `cloud_run_worker_pool` / `declutrmail-worker-pool`. "DeclutrMail runtime observations missing or failing" and "Stuck-mailbox watchdog silent" are closed, and `node scripts/setup-llm-rejection-alert.mjs` and `node scripts/setup-mailbox-lock-alert.mjs` exit 0.
**Status:** Open
