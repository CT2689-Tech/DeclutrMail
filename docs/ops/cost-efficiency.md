# Launch-safe cost controls

## Preview builds

`apps/web/vercel.json` uses the dependency-free `scripts/vercel-ignore-build.mjs` before a Vercel build of the `declutr-mail` project (root `apps/web`, the only Vercel project reporting on this repository). A preview skips when its branch starts with `dependabot/`, or when nothing under the web build inputs changed: `apps/web`, every workspace package it depends on (read transitively from `package.json` `workspace:` dependencies, currently `packages/shared`), and root install/compile files (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `tsconfig*.json`, `turbo.json`, `patches/`, the script itself).

The diff base is `VERCEL_GIT_PREVIOUS_SHA` (the branch's last successful deployment) when it is set and present or fetchable in Vercel's shallow clone, otherwise `HEAD^`. Production, the `main` ref, unknown environments, same-commit redeploys, empty commits, a checkout that does not match the commit, missing history and unreadable manifests always build. `VERCEL_FORCE_BUILD=1` forces a build.

The `HEAD^` fallback trades a known gap for build minutes: when a branch's first deployment arrives as several commits at once, or every earlier deployment was skipped, only the last commit is compared, so an earlier web change can go unpreviewed. Production still builds every `main` commit, CI runs `next build` for web-changing PRs and every merge-queue candidate, and Vercel builds a queue candidate whenever its squashed change touches web inputs.

The project root must remain `apps/web` with files outside the root included. An ignored build marks the deployment canceled and posts a successful `Vercel` commit status ("Canceled by Ignored Build Step", observed on PRs #925, #927, #938 and #945), so the required check does not stay pending. `scripts/ensure-vercel-queue-preview.mjs` treats such a canceled queue preview as reported only when that status is `success`.

## Artifact retention

`scripts/pin-production-images.mjs` reads all serving and tagged Cloud Run traffic destinations and adds immutable, revision-specific `retain-` image tags. Old retention tags are never moved or deleted, preserving known-good rollback images even across failed or partial deployments. The deploy workflow invokes this after a successful image build, including when later deployment steps fail.

The initial `infra/artifact-cleanup-policy.json` is installed in **dry-run mode**. It considers images older than 30 days, while keeping the newest 20 versions and every `retain-` image. Release history intentionally remains retained: this is not a hard cap on registry size.

Before enabling deletion:

1. Confirm the protection step is deployed and current serving images have matching retention tags.
2. Inspect Artifact Registry's dry-run audit results after its background job runs. Keep any additionally required historical rollback image before activation.
3. Compare candidates with current serving digests. Do not infer unique storage savings from the sum of image sizes, because layers are shared.
4. Apply the reviewed policy without dry-run only after those checks. Re-read configuration and later storage usage; report realized savings only from resulting usage/billing.

Useful commands:

```sh
node scripts/pin-production-images.mjs
gcloud artifacts repositories set-cleanup-policies declutrmail --location=us-central1 --project=declutrmail-ai-prod --policy=infra/artifact-cleanup-policy.json --dry-run
node --test scripts/vercel-ignore-build.test.mjs scripts/pin-production-images.test.mjs
```

## Reliability boundaries

These controls do not reduce API/worker capacity, Redis limits, backup protection, launch analytics or test coverage. Runtime allocation changes need evidence from representative sync and authenticated latency measurements. A fixed-price Redis tier does not become cheaper merely by slowing background polling. Keep paid invoices, accrued usage and estimates separate when judging savings.

References: [Vercel ignored builds](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand), [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables), [Artifact Registry cleanup](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy).
