# Launch-safe cost controls

## Preview builds

`apps/web/vercel.json` uses the dependency-free `scripts/vercel-ignore-build.mjs` before a Vercel build. Only subsequent previews whose changes since the last successful branch deployment are entirely in known documentation/backend paths may skip. Production, first previews, manual same-commit redeploys, marketing/shared code, dependency manifests, unknown files and incomplete history always build. `VERCEL_FORCE_BUILD=1` forces a build.

The project root must remain `apps/web` with files outside the root included. The command compares the complete repository, including removed/moved web paths. It does not use HEAD's parent as a substitute for the last successful deployment. Existing GitHub checks remain required. This repository has observed Vercel reporting a successful commit status for an ignored build, despite the deployment itself being marked canceled.

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
