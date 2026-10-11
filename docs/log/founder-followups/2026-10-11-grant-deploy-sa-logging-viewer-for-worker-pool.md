### 2026-10-11 — Grant the deploy SA log read access before the worker-pool deploy
**Source:** worker-pool migration PR (`cursor/worker-pool-migration-6392`)
**Why:** A worker pool has no startup probe in this workflow, so the deploy proves boot by reading the new revision's `worker.listening` log line. The deploy SA's documented grants (`docs/runbooks/prod-infra-bootstrap.md`: `roles/run.developer`, `roles/artifactregistry.writer`, actAs on the runtime SA) do not include `logging.logEntries.list`. The live policy was not checked; if it already grants log read, this step is a no-op. Without it, the first deploy after merge fails at "Smoke worker-pool revision", disables the new pool, and leaves the legacy worker service running.
**How:** Before the PR merges, run:
`gcloud projects add-iam-policy-binding declutrmail-ai-prod --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com --role=roles/logging.viewer --condition=None`
**Verifies by:** The first post-merge "Deploy to Cloud Run" run logs `finished bootstrap (worker.listening queue=outbox-dispatcher)` and then `Legacy worker service disabled`.
**Status:** Open
