### 2026-10-11 — Grant the deploy SA Monitoring read access before the worker-pool deploy
**Source:** worker-pool migration PR (`cursor/worker-pool-migration-6392`), review blockers B1–B6
**Why:** Every worker transition now stops all workers and proves zero running instances before one starts. The Cloud Run Admin API reports only the desired count, so the proof reads `run.googleapis.com/container/instance_count` through `monitoring.timeSeries.list`. The documented deploy SA grants (`roles/run.developer`, `roles/artifactregistry.writer`, actAs on the runtime SA) do not include that permission; the live policy was not checked. Without it, "Plan worker transition" fails its Monitoring preflight before anything changes: the legacy worker keeps running and the API is not deployed.
**How:** Before the PR merges, run:
`gcloud projects add-iam-policy-binding declutrmail-ai-prod --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com --role=roles/monitoring.viewer --condition=None`
**Verifies by:** The first post-merge "Deploy to Cloud Run" run logs `declutrmail-worker: zero running instances` in "Stop every worker and prove zero running instances".
**Status:** Open
