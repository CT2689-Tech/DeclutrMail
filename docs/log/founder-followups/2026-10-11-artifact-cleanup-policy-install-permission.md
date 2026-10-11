### 2026-10-11 — Let the cleanup workflow install the Artifact Registry policy
**Source:** session (Artifact Registry growth fix, `.github/workflows/artifact-cleanup-policy.yml`)
**Why:** The registry keeps every deployed `api` image forever. The new policy and serving tags fix that, but installing a policy (`gcloud artifacts repositories set-cleanup-policies`, dry run or live) needs `artifactregistry.repositories.update`. The deploy SA has only `roles/artifactregistry.writer`, which lacks it (as does `roles/artifactregistry.repoAdmin`). Without the grant, the workflow's `dry-run` and `live` modes print the report and then fail at the install step; `report` mode works.
**How:** Either grant a repository-scoped custom role to the deploy SA:

```sh
gcloud iam roles create artifactCleanupPolicyEditor --project=declutrmail-ai-prod \
  --title="Artifact Registry cleanup policy editor" \
  --permissions=artifactregistry.repositories.get,artifactregistry.repositories.update
gcloud artifacts repositories add-iam-policy-binding declutrmail --location=us-central1 \
  --project=declutrmail-ai-prod \
  --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com \
  --role=projects/declutrmail-ai-prod/roles/artifactCleanupPolicyEditor
```

or skip the grant and run `node scripts/artifact-cleanup-policy.mjs --mode=dry-run` locally as an Artifact Registry admin. Optional: to see the provider's own dry-run verdict, enable DATA_WRITE Data Access audit logs for `artifactregistry.googleapis.com` and grant the deploy SA `roles/logging.privateLogViewer`.
**Verifies by:** The **Artifact Registry cleanup policy** workflow with `mode=dry-run` ends with "Installed in dry-run mode", and the readback passes.
**Status:** Open
