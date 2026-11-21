### 2026-07-10 — Give the worker its own service account and remove project-wide secret read

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entries dated 2026-07-10 and 2026-07-26.
**Why:** The API and the worker both run as `declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com` (`.github/workflows/deploy-cloud-run.yml:116`), and that account can read every secret in the project. A break-in to the public API would expose every production secret, including the email-sending and billing keys. You accepted this risk for launch on 2026-07-26; this entry is the fix for after launch.
**How (in this order; revoking first takes production down):**
1. `gcloud iam service-accounts create declutrmail-worker --project=declutrmail-ai-prod`
2. Grant it KMS decrypt on the `oauth-token-kek` key (key level), then secret read on each secret the worker's deploy step binds.
3. Grant the API account secret read on each of its own secrets (resource level).
4. Point the worker's deploy step in `deploy-cloud-run.yml` at the new account, deploy, and confirm a real sync and an Archive both succeed.
5. Only then remove the API account's project-level `roles/secretmanager.secretAccessor` and its redundant project-level KMS role.
**Verifies by:** `./scripts/launch-preflight.sh secrets` prints "declutrmail-api and declutrmail-worker run as distinct service accounts" and "project IAM: no service account has project-wide secret read".
**Who:** Founder
**Status:** Open
