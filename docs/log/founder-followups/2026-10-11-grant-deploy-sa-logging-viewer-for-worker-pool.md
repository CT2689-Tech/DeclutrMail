### 2026-10-11 — Grant the deploy SA log read access before the worker-pool deploy
**Source:** worker-pool migration PR (`cursor/worker-pool-migration-6392`)
**Why:** A worker pool has no startup probe in this workflow, so the deploy proves boot by reading the new revision's `worker.listening` log line. The deploy SA's documented grants (`docs/runbooks/prod-infra-bootstrap.md`: `roles/run.developer`, `roles/artifactregistry.writer`, actAs on the runtime SA) do not include `logging.logEntries.list`. The live policy was not checked; if it already grants log read, this step is a no-op. Without it, "Plan worker transition" fails its log-read preflight before anything changes: the legacy worker keeps running and the API is not deployed.
**How:** Before the PR merges, run:
`gcloud projects add-iam-policy-binding declutrmail-ai-prod --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com --role=roles/logging.viewer --condition=None`
Also apply `2026-10-11-grant-deploy-sa-monitoring-viewer-for-worker-pool.md`.
**Verifies by:** The first post-merge "Deploy to Cloud Run" run passes "Plan worker transition" and logs `finished bootstrap (worker.listening queue=outbox-dispatcher)`.
**Status:** Open
