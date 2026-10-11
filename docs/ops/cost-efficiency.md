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

`scripts/pin-production-images.mjs` runs after every successful image build in the deploy workflow, including when later deployment steps fail. For each release source (`SOURCES`: the API service and the worker) it:

- moves `serving-<role>` to the primary serving image (highest traffic share);
- moves `serving-<role>-route-1`…`-4` to any other live or tagged traffic destination (more than four fails closed);
- moves `serving-<role>-rollback-1`…`-5` to the five newest distinct images deployed before the primary revision.

Unused slots point at the primary image, so the set of `serving-` tags is fixed (nine per role) and none can keep an old build forever. Slots are written oldest first, so an image shifting from `rollback-1` to `rollback-2` is never left untagged. Tags are created or moved with `gcloud artifacts tags create`/`update`, which the deploy service account's `roles/artifactregistry.writer` allows (`artifactregistry.tags.create`, `artifactregistry.tags.update`). Nothing is ever deleted, so `artifactregistry.tags.delete` is not needed. The script still adds the per-revision `retain-` tag as an immutable record.

When the worker moves to the `declutrmail-worker-pool` Cloud Run worker pool, change its `SOURCES` entry to `{ role: 'worker', kind: 'workerPool', name: 'declutrmail-worker-pool', region: 'us-west1' }`. gcloud reads worker pools through the same v1 Run API: it uses `status.instanceSplits` instead of `status.traffic`, and `gcloud run worker-pools revisions list --worker-pool=…` instead of `gcloud run revisions list --service=…`. This path is covered by fixture tests only until the first pool release runs it.

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
2. **Review:** after about a day (Artifact Registry evaluates policies in a daily background job), run `mode=report`. Compare the printed list with the "Artifact Registry's own dry-run verdict" step, which reads the provider's audit log. That step prints `UNVERIFIED` unless DATA_WRITE Data Access audit logs are enabled for `artifactregistry.googleapis.com` and the deploy account can read them (`roles/logging.privateLogViewer`). Without it, the local preview is the only evidence; it implements the documented rules, not the provider's code.
3. **Go live:** `mode=live` with `confirm_live=delete-unprotected-api-images`. This installs with `--no-dry-run`, and deletion happens within about a day. Re-read the repository size afterwards, and report realized savings only from the resulting usage or billing. The sum of image sizes overstates savings because layers are shared.

**IAM prerequisite.** Installing a policy (dry run or live) needs `artifactregistry.repositories.update`. Neither `roles/artifactregistry.writer` nor `roles/artifactregistry.repoAdmin` includes it, so until it is granted, steps 1 and 3 fail at the install step after printing the report. `mode=report` works today. The narrowest grant is a custom role bound on this repository only:

```sh
gcloud iam roles create artifactCleanupPolicyEditor --project=declutrmail-ai-prod \
  --title="Artifact Registry cleanup policy editor" \
  --permissions=artifactregistry.repositories.get,artifactregistry.repositories.update
gcloud artifacts repositories add-iam-policy-binding declutrmail --location=us-central1 \
  --project=declutrmail-ai-prod \
  --member=serviceAccount:declutrmail-deploy@declutrmail-ai-prod.iam.gserviceaccount.com \
  --role=projects/declutrmail-ai-prod/roles/artifactCleanupPolicyEditor
```

Alternatively, run the same script locally with an account that holds `roles/artifactregistry.admin`: `node scripts/artifact-cleanup-policy.mjs --mode=dry-run`, or `CLEANUP_CONFIRM=delete-unprotected-api-images node scripts/artifact-cleanup-policy.mjs --mode=live`.

## Reliability boundaries

These controls do not reduce API/worker capacity, Redis limits, backup protection, launch analytics or test coverage. Runtime allocation changes need evidence from representative sync and authenticated latency measurements. A fixed-price Redis tier does not become cheaper merely by slowing background polling. Keep paid invoices, accrued usage and estimates separate when judging savings.

References: [Vercel ignored builds](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand), [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables), [Artifact Registry cleanup](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy).
