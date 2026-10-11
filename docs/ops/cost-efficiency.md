# Launch-safe cost controls

## Preview builds

`apps/web/vercel.json` uses the dependency-free `scripts/vercel-ignore-build.mjs` before a Vercel build of the `declutr-mail` project (root `apps/web`, the only Vercel project reporting on this repository). A preview skips only when its diff since `VERCEL_GIT_PREVIOUS_SHA` (the branch's last successful deployment, fetched if Vercel's shallow clone lacks it) contains no web build input:

- `apps/web` and every workspace package it depends on, read transitively from `package.json` `workspace:` dependencies (currently `packages/shared`);
- every workspace `package.json`, because a manifest without its matching lock importer breaks the frozen workspace install;
- every root-level file except Markdown (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `tsconfig*.json` and any new install configuration), plus `patches/` and the script itself.

There is no `HEAD^` fallback: it would hide web changes in earlier commits that were never built. A missing, invalid or unfetchable previous SHA builds, so first previews and merge-queue candidates always build. Dependabot branches follow the same rules; their dependency bumps change the lockfile and build. Production, the `main` ref, unknown environments, same-commit redeploys, empty commits, a checkout that does not match the commit, git errors and unreadable manifests always build. `VERCEL_FORCE_BUILD=1` forces a build.

The project root must remain `apps/web` with files outside the root included. An ignored build marks the deployment canceled and posts a successful `Vercel` commit status ("Canceled by Ignored Build Step", observed on PRs #925, #927, #938 and #945), so the required check does not stay pending. `scripts/ensure-vercel-queue-preview.mjs` accepts a canceled queue preview only when the latest `Vercel` status is that exact `vercel[bot]` success and its target URL names the same `declutr-mail` deployment.

## Artifact retention

As reported on 2026-10-11, the repository `declutrmail` (us-central1, package `api`) held about 17 GiB in 134 versions, and its cleanup policy had dry run **off** since 2026-09-24. The policy was live but deleted nothing deployed: its keep rule retained every `retain-` tag forever, and every serving image got one.

### Protection

`scripts/pin-production-images.mjs` protects images with `serving-` tags. Two writers run it, each in its own namespace, and neither moves the other's tags:

| Writer                                                                                                | Namespace           | Serialized by                 |
| ----------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------- |
| deploy workflow, after every image build (`--namespace=deploy`)                                       | `serving-`          | `deploy-cloud-run-production` |
| **Artifact Registry cleanup policy** workflow: hourly schedule, `rollback`, `dry-run`/`report`/`live` | `serving-observed-` | `artifact-registry-pins`      |

A stale run therefore cannot undo a newer one: a deploy's tags stay put while a slow reconciler run writes its own. After writing, the script re-reads every source and fails ("serving state changed during the pin; run it again") if traffic moved meanwhile, so it never reports success for an image set that is no longer current.

For each release source (`SOURCES`) it moves, within its namespace:

- `<ns><role>` to the primary serving image (highest traffic share);
- `<ns><role>-route-1`…`-4` to any other live or tagged traffic destination (more than four fails closed);
- `<ns><role>-rollback-1`…`-5` to the five newest distinct images deployed before the primary revision. Images that served traffic (they have a `retain-` tag) come first; unserved ones only fill remaining slots. A candidate staged at 0% behind a `verify-` tag is protected as a route while it is smoked, but gets no `retain-` tag, so a candidate that fails its smoke never displaces a known-good rollback.

`SOURCES` are the API service (us-central1), the legacy worker service (us-west1, kept as the worker pool's rollback path) and the `declutrmail-worker-pool` worker pool (us-west1). The pool is optional only until it exists: only gcloud's exact "Cannot find worker pool" error skips it, and any other error fails closed. A test reads `deploy-cloud-run.yml` and fails if it deploys a Cloud Run resource that is not a required source, so the pool must become required in the change that deploys it (open PR #972 changes the same file; whichever merges second reconciles them).

It also protects every image referenced by a Cloud Run job in any region (`<ns>job-1`…`-4`), such as a billing-probe job a cancelled run left behind, and keeps `<ns>pinned-billing-probe` on the image `.github/workflows/billing-queue-access-diagnosis.yml` runs by tag (`PINNED`; a test fails if the workflow's image and `PINNED` drift). A job image it cannot resolve, more than four job images, or a missing pinned source makes the script protect everything else, then fail by name.

Unused slots point at the primary image, so the set of `serving-` tags is exact and none can keep an old build forever. Any other `serving-` tag is reported; the reconciler run fails on it, and the cleanup script refuses to report or install until an admin deletes it. A slot moves only once its current image is unwanted or also held by another `serving-` tag. When slots swap images, one image is first parked on `<ns>spare`, so no still-wanted image is ever without a tag; tests interrupt the run at every write to check this. Tags are created or moved with `gcloud artifacts tags create`/`update`, which the deploy service account's `roles/artifactregistry.writer` allows (`artifactregistry.tags.create`, `artifactregistry.tags.update`). Nothing is ever deleted, so `artifactregistry.tags.delete` is not needed. The script still adds the per-revision `retain-` tag as an immutable record.

Worker pools are read through the same v1 Run API, with `status.instanceSplits` instead of `status.traffic` and `gcloud run worker-pools revisions list --worker-pool=…`. That path is covered by fixture tests only until the first pool release runs it.

**Rollbacks.** Roll production back with the workflow's `mode=rollback` (`rollback_role`, `rollback_revision`). It tags the target image on `serving-observed-spare` first, moves 100% of traffic only once that tag reads back, then re-pins; if the target cannot be protected, traffic is not moved. A rollback made directly in Cloud Run (console or `gcloud run services update-traffic`) is protected only at the next hourly re-pin. In that window, an image older than 14 days that is outside the newest 20 versions and the five rollback slots can be deleted while it serves, so use `mode=rollback`.

### Policy

`infra/artifact-cleanup-policy.json` deletes `api` versions older than 14 days unless a keep rule matches:

| Rule                    | Keeps                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `recent-rollbacks`      | the newest 20 versions                                                                       |
| `latest-image`          | the image tagged `latest`                                                                    |
| `serving-images`        | any `serving-` tag: current, live routes and five rollbacks per role                         |
| `recent-retention-tags` | `retain-` tags newer than 14 days (redundant with the delete age; kept as an explicit bound) |

At several deploys a day the newest 20 cover only a short window, so the 14-day age and the `serving-` tags provide the rollback window. The names `old-builds`, `recent-rollbacks` and `serving-images` are reused deliberately, so installing overwrites the old keep-forever rule even if gcloud merges by name. The readback still requires exactly the file's rules.

`scripts/artifact-cleanup-policy.mjs` validates the file and previews it against the live registry. Its tests (`node --test scripts/artifact-cleanup-policy.test.mjs scripts/pin-production-images.test.mjs`, run in CI) pin the contract and prove that a pinned release never loses its current or five rollback images.

### Rollout

Run the **Artifact Registry cleanup policy** workflow (`.github/workflows/artifact-cleanup-policy.yml`) from `main`:

1. **Dry run:** `mode=dry-run`. It moves the serving tags, prints the repository size, the installed policy, and every version the new policy would delete now. It then installs the policy with `--dry-run`, which stops the current live policy from deleting anything, and reads the configuration back. It refuses to install if a protected image would be deleted or is missing from the listing.
2. **Review:** after about a day (Artifact Registry evaluates policies in a daily background job), run `mode=report`. Compare the printed list with the "Artifact Registry's own dry-run verdict" step (`--mode=verdict`). It reads the provider's audit log entries written after the repository's last update (the installed configuration), marks any listed image that holds a `serving-` tag, and fails if there is one. It fails as `UNVERIFIED` if there is no such entry: DATA_WRITE Data Access audit logs must be enabled for `artifactregistry.googleapis.com`, and the deploy account must be able to read them (`roles/logging.privateLogViewer`).
3. **Go live:** `mode=live` with `confirm_live=delete-unprotected-api-images`. The job waits for a reviewer on the `artifact-registry-live` GitHub environment and refuses if that environment has no required reviewer. Before installing it requires a receipt:
   - this exact policy is installed in dry-run mode;
   - a provider verdict exists for that installation;
   - the verdict names no image that holds a `serving-` tag;
   - the verdict names nothing the local preview keeps.

   Anything else, `UNVERIFIED` included, stops before `--no-dry-run`. Deletion then happens within about a day. Re-read the repository size afterwards, and report realized savings only from the resulting usage or billing. The sum of image sizes overstates savings because layers are shared.

**IAM prerequisite.** Installing a policy (dry run or live) needs `artifactregistry.repositories.update`. Neither `roles/artifactregistry.writer` nor `roles/artifactregistry.repoAdmin` includes it, so until it is granted, steps 1 and 3 fail at the install step after printing the report. `mode=report` and `mode=rollback` need only the writer role. The narrowest grant is a custom role bound on this repository only:

```sh
gcloud iam roles create artifactCleanupPolicyEditor --project=declutrmail-ai-prod \
  --title="Artifact Registry cleanup policy editor" \
  --permissions=artifactregistry.repositories.get,artifactregistry.repositories.update
gcloud artifacts repositories add-iam-policy-binding declutrmail --location=us-central1 \
  --project=declutrmail-ai-prod \
  --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com \
  --role=projects/declutrmail-ai-prod/roles/artifactCleanupPolicyEditor
```

Alternatively, run the same script locally with an account that holds `roles/artifactregistry.admin`: `node scripts/artifact-cleanup-policy.mjs --mode=dry-run`, or `CLEANUP_CONFIRM=delete-unprotected-api-images node scripts/artifact-cleanup-policy.mjs --mode=live`. A local live run still requires the receipt, but skips the GitHub environment approval.

## Reliability boundaries

These controls do not reduce API/worker capacity, Redis limits, backup protection, launch analytics or test coverage. Runtime allocation changes need evidence from representative sync and authenticated latency measurements. A fixed-price Redis tier does not become cheaper merely by slowing background polling. Keep paid invoices, accrued usage and estimates separate when judging savings.

References: [Vercel ignored builds](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand), [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables), [Artifact Registry cleanup](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy).
