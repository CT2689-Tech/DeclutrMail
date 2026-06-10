# Prod Infrastructure Bootstrap

Provision DeclutrMail's pre-launch infrastructure on GCP + Vercel. Idle
burn target: **~$10/mo** (Cloud KMS only). Everything else stays $0 until
traffic or `min_instances=1` flips at launch.

## What this runbook covers

Tier A from session 2026-06-07: free-while-idle infra so deploys work
and prod secrets live in the right places **before** real users. Tier B
(Cloud SQL, Upstash, `min_instances=1`, Vercel Pro, custom domain)
is intentionally OUT of scope — defer to pre-launch.

## What this runbook does NOT cover

- Cloud SQL Postgres provisioning (defer — local Postgres for dev)
- Upstash Redis paid plan (defer — local docker Redis for dev)
- Vercel Pro upgrade (defer — free Hobby tier for previews)
- Custom domain + DNS (defer — buy at launch)
- Migration replay on Cloud SQL (D152 — runs from CI when DB exists)

## Prerequisites

- Founder has a Google account with billing enabled
- `gcloud` CLI installed + authenticated (`gcloud auth login`)
- `gh` CLI installed + authenticated (for step 9)
- Local repo at `/Users/chintant/projects/DeclutrMail`
- Project name decided: `declutrmail-ai-prod` (already in `.env.local`)
- Region decided: `us-central1` (per D158)

---

## Step 1 — GCP project + billing + budget alert

**Cost:** $0 idle. Budget alert is the safety net for everything else.

```bash
# Create the project (skip if it exists already)
gcloud projects create declutrmail-ai-prod \
  --name="DeclutrMail Prod" \
  --set-as-default

# Link billing account (replace BILLING_ACCT_ID)
gcloud billing accounts list   # find your account id
BILLING_ACCT=XXXXXX-XXXXXX-XXXXXX
gcloud billing projects link declutrmail-ai-prod --billing-account=$BILLING_ACCT

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudkms.googleapis.com \
  pubsub.googleapis.com \
  iam.googleapis.com \
  --project=declutrmail-ai-prod

# Budget alert at $30/mo with 50/90/100% email triggers
gcloud billing budgets create \
  --billing-account=$BILLING_ACCT \
  --display-name="declutrmail-pre-launch-30" \
  --budget-amount=30USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --filter-projects=projects/declutrmail-ai-prod
```

**Verify:**

```bash
gcloud projects describe declutrmail-ai-prod --format="value(name,lifecycleState)"
# Expect: DeclutrMail Prod  ACTIVE

gcloud billing projects describe declutrmail-ai-prod --format="value(billingEnabled)"
# Expect: True

gcloud billing budgets list --billing-account=$BILLING_ACCT --filter="displayName:declutrmail-pre-launch-30"
# Expect: one row
```

**Disable APIs you don't yet need** (defaults differ):

```bash
# These are auto-enabled but unused at this stage. Disable to shrink
# attack surface + simplify audit logs.
gcloud services disable \
  bigquery.googleapis.com \
  bigquerymigration.googleapis.com \
  bigquerystorage.googleapis.com \
  storage.googleapis.com \
  --project=declutrmail-ai-prod \
  --force 2>/dev/null || true
# (--force needed because some APIs are auto-enabled by transitive deps)
```

---

## Step 2 — Service accounts + IAM

**Cost:** $0.

Two service accounts, each with the narrowest possible role:

- `declutrmail-deploy@…` — used by GH Actions to push images + update Cloud Run
- `declutrmail-runtime@…` — runtime identity for Cloud Run services (API + worker)

```bash
PROJECT=declutrmail-ai-prod

# Deploy SA (used by GH Actions only)
gcloud iam service-accounts create declutrmail-deploy \
  --display-name="DeclutrMail GH Actions deploy" \
  --project=$PROJECT

# Runtime SA (used by Cloud Run at runtime)
gcloud iam service-accounts create declutrmail-runtime \
  --display-name="DeclutrMail Cloud Run runtime" \
  --project=$PROJECT

DEPLOY_SA=declutrmail-deploy@$PROJECT.iam.gserviceaccount.com
RUNTIME_SA=declutrmail-runtime@$PROJECT.iam.gserviceaccount.com

# Deploy SA: push images + update Cloud Run + act-as runtime SA
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$DEPLOY_SA" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$DEPLOY_SA" \
  --role="roles/run.developer"

gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA \
  --member="serviceAccount:$DEPLOY_SA" \
  --role="roles/iam.serviceAccountUser" \
  --project=$PROJECT

# Runtime SA: read secrets + decrypt with KMS + publish/subscribe Pub/Sub
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/pubsub.subscriber"
```

**Auth for GH Actions — Workload Identity Federation** (NOT a JSON key
— the GCP org policy `constraints/iam.disableServiceAccountKeyCreation`
blocks SA JSON keys, intentional security default):

```bash
PROJECT=declutrmail-ai-prod
DEPLOY_SA=declutrmail-deploy@$PROJECT.iam.gserviceaccount.com
REPO=CT2689-Tech/DeclutrMail
POOL_ID=github-actions
PROVIDER_ID=github

# Enable IAM credentials API (needed for STS token exchange)
gcloud services enable iamcredentials.googleapis.com --project=$PROJECT

# 1. Workload Identity Pool — the federation boundary
gcloud iam workload-identity-pools create $POOL_ID \
  --project=$PROJECT --location=global \
  --display-name="GitHub Actions"

# 2. OIDC provider trusting GitHub's token issuer, pinned to this repo
gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --project=$PROJECT --location=global \
  --workload-identity-pool=$POOL_ID \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '$REPO'"

# 3. Allow this repo's GH OIDC token to impersonate the deploy SA
POOL_NAME=$(gcloud iam workload-identity-pools describe $POOL_ID \
  --project=$PROJECT --location=global --format="value(name)")
gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA \
  --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository/$REPO"

# 4. Upload WIF identifiers as GH secrets (not the auth values
#    themselves — these are public-ish resource paths kept in secrets
#    for hygiene + repo-config consistency).
PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe $PROVIDER_ID \
  --project=$PROJECT --location=global \
  --workload-identity-pool=$POOL_ID --format="value(name)")
gh secret set GCP_WIF_PROVIDER --body "$PROVIDER_NAME" --repo=$REPO
gh secret set GCP_DEPLOY_SA --body "$DEPLOY_SA" --repo=$REPO
```

**Verify:**

```bash
gcloud iam service-accounts list --project=$PROJECT
# Expect both deploy + runtime listed

gh secret list --repo=$REPO | grep GCP_
# Expect GCP_WIF_PROVIDER + GCP_DEPLOY_SA
```

**Rotation note:** WIF has no long-lived secret to rotate. To revoke
access to the deploy SA from GH Actions, either delete the
`roles/iam.workloadIdentityUser` binding on the SA, or delete the WIF
provider. The workflow auth fails fast on next push.

---

## Step 3 — Artifact Registry

**Cost:** ~$0 idle (~$0.10/GB/mo for stored images; small).

```bash
PROJECT=declutrmail-ai-prod
REGION=us-central1

gcloud artifacts repositories create declutrmail \
  --repository-format=docker \
  --location=$REGION \
  --description="DeclutrMail container images" \
  --project=$PROJECT

# Configure local docker to push to AR
gcloud auth configure-docker $REGION-docker.pkg.dev
```

**Verify:**

```bash
gcloud artifacts repositories describe declutrmail \
  --location=$REGION --project=$PROJECT \
  --format="value(name,format)"
# Expect: …/declutrmail  DOCKER
```

---

## Step 4 — Secret Manager (populate all prod secrets)

**Cost:** ~$0.06/secret/mo. With ~15 secrets, ~$1/mo.

Create one secret per row from `docs/runbooks/secrets-inventory.md`.
Pattern: `gcloud secrets create NAME --data-file=-` then paste + Ctrl-D.

```bash
PROJECT=declutrmail-ai-prod

# Anthropic prod key (paste the declutrmail-prod-worker-202606 value)
echo -n "$PROD_ANTHROPIC_KEY" | gcloud secrets create anthropic-api-key-prod \
  --project=$PROJECT --data-file=-

# Sentry server DSN
echo -n "$SENTRY_SERVER_DSN" | gcloud secrets create sentry-dsn-api \
  --project=$PROJECT --data-file=-

# Google OAuth client secret
echo -n "$GOOGLE_CLIENT_SECRET" | gcloud secrets create google-oauth-client-secret-prod \
  --project=$PROJECT --data-file=-

# JWT secrets — generate fresh prod values
openssl rand -base64 48 | gcloud secrets create jwt-access-secret-prod \
  --project=$PROJECT --data-file=-

openssl rand -base64 48 | gcloud secrets create jwt-refresh-secret-prod \
  --project=$PROJECT --data-file=-

# Database URL placeholder (real value lands when Cloud SQL ships)
echo -n "postgresql://placeholder:placeholder@unset/declutrmail" | \
  gcloud secrets create database-url-prod \
  --project=$PROJECT --data-file=-

# Redis URL placeholder (real value lands when Upstash ships)
echo -n "redis://placeholder:6379" | \
  gcloud secrets create redis-url-prod \
  --project=$PROJECT --data-file=-

# Admin allowlist (your founder email)
echo -n "chintan.a.thakkar@gmail.com" | gcloud secrets create admin-email-allowlist-prod \
  --project=$PROJECT --data-file=-
```

**Verify:**

```bash
gcloud secrets list --project=$PROJECT
# Expect: anthropic-api-key-prod, sentry-dsn-api, google-oauth-client-secret-prod,
#         jwt-access-secret-prod, jwt-refresh-secret-prod, database-url-prod,
#         redis-url-prod, admin-email-allowlist-prod
```

**Update `docs/runbooks/secrets-inventory.md`** — flip the `Rotated`
column to today's date for every secret created in this step.

---

## Step 5 — Cloud KMS (D14 OAuth-token encryption)

**Cost:** ~$5-10/mo. Required before any prod data lands.

```bash
PROJECT=declutrmail-ai-prod
REGION=us-central1

gcloud kms keyrings create declutrmail \
  --location=$REGION --project=$PROJECT

gcloud kms keys create oauth-token-kek \
  --keyring=declutrmail \
  --location=$REGION \
  --purpose=encryption \
  --rotation-period=365d \
  --next-rotation-time=$(date -v+1y -u +%Y-%m-%dT%H:%M:%SZ) \
  --project=$PROJECT
```

**KMS resource name** (paste into prod env vars + secret inventory):

```
projects/declutrmail-ai-prod/locations/us-central1/keyRings/declutrmail/cryptoKeys/oauth-token-kek
```

**Verify:**

```bash
gcloud kms keys list --keyring=declutrmail --location=$REGION --project=$PROJECT
# Expect one key, purpose=ENCRYPT_DECRYPT, rotation enabled
```

---

## Step 6 — Pub/Sub topic + subscription (D229)

**Cost:** $0 idle (10GB/mo free tier).

```bash
PROJECT=declutrmail-ai-prod

# Gmail history push topic
gcloud pubsub topics create gmail-push --project=$PROJECT

# Service account that Pub/Sub uses to authenticate to your API
gcloud iam service-accounts create gmail-webhook-oidc \
  --display-name="Gmail Pub/Sub OIDC pusher" \
  --project=$PROJECT

# Give Gmail's project the right to publish to your topic
# (Gmail's service account is gmail-api-push@system.gserviceaccount.com)
gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project=$PROJECT
```

**Subscription is created LATER** — needs the Cloud Run API URL as push
endpoint. Defer to step 8.

**Verify:**

```bash
gcloud pubsub topics describe gmail-push --project=$PROJECT \
  --format="value(name)"
# Expect: projects/declutrmail-ai-prod/topics/gmail-push
```

---

## Step 7 — Dockerfiles

**Cost:** $0 (build only).

Create two minimal Dockerfiles. Repo root.

`apps/api/Dockerfile`:

```dockerfile
# Multi-stage build — keep final image lean
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/workers/package.json packages/workers/
COPY packages/events/package.json packages/events/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @declutrmail/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/packages ./packages
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
```

`apps/api/Dockerfile.worker`:

```dockerfile
# Same base; CMD swaps to worker.ts entrypoint
FROM declutrmail-api-base:latest
CMD ["node", "apps/api/dist/worker.js"]
```

(Adjust paths if your build output differs — verify locally first with
`pnpm --filter @declutrmail/api build && ls apps/api/dist/`.)

**Cloud Run expects PORT env var = $PORT.** The API must listen on
`process.env.PORT` (not hardcoded 4000) in production. Check
`apps/api/src/main.ts` — confirm it reads `process.env.PORT ?? 4000`. If
not, add it.

**Local smoke build (free):**

```bash
docker build -f apps/api/Dockerfile -t declutrmail-api:local .
docker run --rm -p 8080:8080 -e PORT=8080 declutrmail-api:local
# Hit http://localhost:8080/api/auth/me → expect 401 Unauthorized
```

---

## Step 8 — Cloud Run services (`min_instances=0`, `max_instances=3`)

**Cost:** $0 if no traffic. Real bill kicks in only on requests OR when
you flip `min_instances=1` at launch.

```bash
PROJECT=declutrmail-ai-prod
REGION=us-central1
RUNTIME_SA=declutrmail-runtime@$PROJECT.iam.gserviceaccount.com

# Build + push images (first time — later steps automated via GH Actions)
docker build -f apps/api/Dockerfile -t $REGION-docker.pkg.dev/$PROJECT/declutrmail/api:bootstrap .
docker push $REGION-docker.pkg.dev/$PROJECT/declutrmail/api:bootstrap

docker build -f apps/api/Dockerfile.worker -t $REGION-docker.pkg.dev/$PROJECT/declutrmail/worker:bootstrap .
docker push $REGION-docker.pkg.dev/$PROJECT/declutrmail/worker:bootstrap

# Deploy API
gcloud run deploy declutrmail-api \
  --image=$REGION-docker.pkg.dev/$PROJECT/declutrmail/api:bootstrap \
  --region=$REGION \
  --service-account=$RUNTIME_SA \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --cpu=1 \
  --port=8080 \
  --no-allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,WEB_URL=https://app.declutrmail.com" \
  --update-secrets="ANTHROPIC_API_KEY=anthropic-api-key-prod:latest,SENTRY_DSN=sentry-dsn-api:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret-prod:latest,JWT_ACCESS_SECRET=jwt-access-secret-prod:latest,JWT_REFRESH_SECRET=jwt-refresh-secret-prod:latest,DATABASE_URL=database-url-prod:latest,REDIS_URL=redis-url-prod:latest,ADMIN_EMAIL_ALLOWLIST=admin-email-allowlist-prod:latest" \
  --project=$PROJECT

# Deploy worker
gcloud run deploy declutrmail-worker \
  --image=$REGION-docker.pkg.dev/$PROJECT/declutrmail/worker:bootstrap \
  --region=$REGION \
  --service-account=$RUNTIME_SA \
  --min-instances=1 \
  --max-instances=3 \
  --memory=2Gi \
  --cpu=2 \
  --cpu-boost \
  --no-cpu-throttling \
  --no-allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,REASONING_RATE_PER_MIN=400,WORKER_DRAIN_DELAY_SEC=10,WORKER_STALLED_INTERVAL_MS=60000,WORKER_CRON_DRAIN_DELAY_SEC=60,WORKER_CRON_STALLED_INTERVAL_MS=300000" \
  --update-secrets="ANTHROPIC_API_KEY=anthropic-api-key-prod:latest,DATABASE_URL=database-url-prod:latest,REDIS_URL=redis-url-prod:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret-prod:latest,JWT_ACCESS_SECRET=jwt-access-secret-prod:latest,JWT_REFRESH_SECRET=jwt-refresh-secret-prod:latest,SENTRY_DSN=sentry-dsn-api:latest" \
  --project=$PROJECT
```

> **Worker secrets list correction (2026-06-08 session).** An earlier
> version of this runbook mounted only `ANTHROPIC_API_KEY`,
> `DATABASE_URL`, and `REDIS_URL` on the worker. `worker.ts` ALSO calls
> `requireEnv('GOOGLE_CLIENT_SECRET')` (for Gmail refresh-token rotation),
> `requireEnv('JWT_ACCESS_SECRET')` / `_REFRESH_SECRET` (for token
> validation in the brief snapshot flow), and reads `SENTRY_DSN`
> (observability). The full list above is what `worker.ts` actually
> needs — leaving any of these unmounted causes a silent bootstrap
> hang (`worker.boot.env_check` line surfaces which ones are missing).

> **`REASONING_RATE_PER_MIN=400` is mandatory on the worker (2026-06-09 session).**
> The score worker fans out one `llm.explain()` call per active sender;
> a fresh mailbox can be 6000+ senders. A burst above the org's
> Anthropic RPM cap returns 429, which the adapter catches → null →
> template fallback. Verified prod-degradation 2026-06-09: 70 × 429 in
> 15min, ~25% of decisions written as `generated_by='template'` even
> with a wired Haiku key. `400` is the Tier 2 value (Tier 2 is live;
> matches `deploy-cloud-run.yml`) — the original `40` was calibrated to
> Tier 1's 50 RPM cap. Unit tests skip pacing automatically —
> env-unset path returns `Infinity` from `resolveReasoningRatePerMin`.

**Note on `--no-allow-unauthenticated`**: requires IAM auth to invoke.
For Gmail Pub/Sub push to reach the API, the Pub/Sub OIDC SA needs
`run.invoker` on the API service. For browser traffic at launch, flip
to `--allow-unauthenticated` and rely on app-level auth.

**Get API URL** for the Pub/Sub subscription created next:

```bash
API_URL=$(gcloud run services describe declutrmail-api \
  --region=$REGION --project=$PROJECT \
  --format="value(status.url)")
echo $API_URL
# Expect: https://declutrmail-api-XXXXX-uc.a.run.app
```

**Create the Pub/Sub push subscription (now that API URL exists):**

```bash
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=$API_URL/api/webhooks/gmail \
  --push-auth-service-account=gmail-webhook-oidc@$PROJECT.iam.gserviceaccount.com \
  --push-auth-token-audience=$API_URL \
  --ack-deadline=60 \
  --message-retention-duration=7d \
  --project=$PROJECT

# Allow the OIDC SA to invoke the Cloud Run service
gcloud run services add-iam-policy-binding declutrmail-api \
  --member="serviceAccount:gmail-webhook-oidc@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=$REGION --project=$PROJECT
```

**Verify:**

```bash
gcloud run services list --region=$REGION --project=$PROJECT
# Expect both declutrmail-api + declutrmail-worker, status=Ready

# Smoke API (will 401 without auth — proves the service runs):
curl -i $API_URL/api/auth/me 2>&1 | head -5
# Expect: HTTP/2 401  + Missing session body
```

---

## Step 9 — GitHub Actions deploy workflow (D160)

**Cost:** $0 (free OSS minutes).

The canonical workflow lives at
[`.github/workflows/deploy-cloud-run.yml`](../../.github/workflows/deploy-cloud-run.yml).
Read that file for the authoritative source — this section explains
what it does + the design choices baked in.

**Trigger:** every push to `main` whose changes touch `apps/api/**`,
`packages/**`, or build config. Also manual via `workflow_dispatch`
(useful after a Secret Manager rotation that needs the existing image
re-deployed to pick up the new secret version).

**Auth:** Workload Identity Federation. Provider + deploy SA email are
read from GH secrets `GCP_WIF_PROVIDER` + `GCP_DEPLOY_SA` (set in Step
2 of this runbook). No long-lived JSON key — the org policy blocks
those anyway.

**Image strategy:** one image, two services. The image is built once
per workflow run, tagged `:${{ github.sha }}` (immutable) + `:latest`
(movable). `declutrmail-api` uses the image's default CMD
(`src/main.ts`). `declutrmail-worker` overrides via `--command="node"`

- `--args="--import,@swc-node/register/esm-register,src/worker.ts"` so
  both services share the same registry tag. Rollback = redeploy with an
  older SHA tag.

**Workflow-injection safety:** every `${{ ... }}` value (even
git-generated ones like `github.sha`) is routed through `env:` before
reaching a `run:` shell. See the top-of-file comment in
`deploy-cloud-run.yml` for the full rationale.

**Smoke gates** in the workflow itself:

- `Smoke API revision` curls `/api/auth/me` and asserts HTTP 401. Any
  5xx fails the deploy (but Cloud Run keeps the previous revision
  serving traffic — failed deploys don't drop service).
- `Smoke worker revision` queries the Cloud Run control plane for
  `status.conditions[0].status == True` on the latest worker revision.
  Worker URL is private so we can't curl it directly.

**Verify (after first push to main):** Actions tab → workflow runs
green → both smoke steps pass → Cloud Run console shows new revisions
tagged with the commit SHA → `curl $API_URL/api/auth/me` from your
laptop returns 401.

---

## Step 10 — End-to-end smoke

**Cost:** $0 (one curl request).

```bash
PROJECT=declutrmail-ai-prod
REGION=us-central1
API_URL=$(gcloud run services describe declutrmail-api \
  --region=$REGION --project=$PROJECT \
  --format="value(status.url)")

# Confirm API booted (will fail auth — that's the point)
curl -i $API_URL/api/auth/me 2>&1 | head -5
# Expect: HTTP/2 401  body: {"error":{"code":"UNAUTHORIZED",...}}

# Confirm worker boot logs (no jobs to process yet)
gcloud run services logs read declutrmail-worker \
  --region=$REGION --project=$PROJECT --limit=20
# Expect: worker.listening log lines for each queue, no errors
```

**Stop conditions** — abort the rollout + escalate if any of these fire:

- `curl` returns 5xx — boot is broken
- Worker log shows `bullmq.error` — Redis URL is the placeholder; expected to fail until Tier B (Step `redis-url-prod` real value). Document this expected failure in the bootstrap PR body so reviewers don't flag it.
- Cloud Run service status ≠ `Ready` — image or env config bad

---

## Post-bootstrap checklist

After all 10 steps succeed, update the following in the same PR:

- [ ] `docs/runbooks/secrets-inventory.md` — `Rotated` column reflects today's date for all created secrets
- [ ] `IMPLEMENTATION-LOG.md` — mark D160 🔵 (shipped, awaiting verify)
- [ ] `FOUNDER-FOLLOWUPS.md` — close "Wire prod Anthropic key to Cloud Run worker" entry
- [ ] `FOUNDER-FOLLOWUPS.md` — open follow-ups for Tier B (Cloud SQL, Upstash, Vercel Pro, `min_instances=1` flip)
- [ ] Personal vault — mirror every secret created in step 4

## Costs after this runbook

| Item                          | Monthly     |
| ----------------------------- | ----------- |
| Cloud KMS CryptoKey           | ~$5-10      |
| Secret Manager (~8 secrets)   | ~$0.50      |
| Artifact Registry storage     | ~$0.50      |
| Cloud Run (idle, min=0)       | $0          |
| Pub/Sub (idle)                | $0          |
| GH Actions (free OSS minutes) | $0          |
| **Total**                     | **~$10/mo** |

Compare against the Tier B burn we deferred (~$80-200/mo) — that's the
discipline this runbook buys.

## Flipping to launch (NOT part of this runbook)

When ready for real users:

1. Provision Cloud SQL Postgres (regional HA, db-g1-small)
2. Provision Upstash Redis paid plan
3. Update `database-url-prod` + `redis-url-prod` Secret Manager versions
4. Set Cloud Run `min_instances=1` on both services (D193)
5. Run Atlas migration apply against Cloud SQL via CI
6. Upgrade Vercel to Pro
7. Buy + DNS-configure `declutrmail.com` + `app.declutrmail.com`
8. Smoke the full user flow end-to-end

That step set is a SEPARATE runbook — write
`docs/runbooks/prod-launch.md` when you're 2-4 weeks from inviting
users.
