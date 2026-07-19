# Secrets Inventory

Human-readable index of every secret DeclutrMail depends on. The source
of truth for each VALUE is the storage column — never paste secret
values into this file. Update this doc the same PR that adds a new
secret or rotates an existing one.

## Conventions

- **Vendor label**: the human-readable name in the vendor's console
  (Anthropic, Sentry, PostHog, Google Cloud, etc.). Follow the
  `declutrmail-<env>-<role>-<YYYYMM>` pattern. Date suffix = rotation
  audit trail; revoking by date is faster than by guesswork.
- **Storage**: where the canonical value lives at runtime.
  - `.env.local` — gitignored, dev machine only.
  - GH Actions secret — repo Settings → Secrets → Actions.
  - GCP Secret Manager — read by Cloud Run at boot via `--update-secrets`.
  - Vercel env var — Project Settings → Environment Variables (Production / Preview / Development).
- **Env var name**: what the code reads via `process.env.*`. Same name
  across all storages is intentional — code doesn't branch by env.
- **Rotated**: ISO date of last rotation. Calendar reminder in
  `FOUNDER-FOLLOWUPS.md` triggers a quarterly review.
- **Spend cap**: hard ceiling at the vendor side (Anthropic + paid
  APIs). Not all vendors support this; mark `n/a` where they don't.
- **Owner**: who can rotate this. Solo founder = `founder` everywhere
  today; multi-engineer ops add team identifiers.

## Personal backup

Mirror every row into a personal password manager vault (1Password /
Bitwarden / equivalent). One entry per row, fields = label + value +
vendor URL + rotation steps. The repo + GCP Secret Manager are the
operational source of truth, but if the laptop dies or a GCP project is
lost, the vault is the recovery path. **Do NOT keep secrets in Notion,
Drive, or plain-text files.**

## Inventory

### Anthropic (Claude API)

Three distinct keys — independent revoke, per-slot spend caps, blast
radius limited per slot.

| Slot        | Vendor label                     | Storage                                      | Env var                                      | Rotated    | Spend cap | Owner   |
| ----------- | -------------------------------- | -------------------------------------------- | -------------------------------------------- | ---------- | --------- | ------- |
| Local dev   | `declutrmail-local-202606`       | `.env.local`                                 | `ANTHROPIC_API_KEY`                          | 2026-06-08 | $20/mo    | founder |
| CI gates    | `declutrmail-ci-gates-202606`    | GH Actions secret                            | `ANTHROPIC_API_KEY`                          | 2026-05-19 | $50/mo    | founder |
| Prod worker | `declutrmail-prod-worker-202606` | GCP Secret Manager: `anthropic-api-key-prod` | `ANTHROPIC_API_KEY` (Cloud Run API + worker) | 2026-06-08 | $100/mo   | founder |

**Where the prod key is consumed:** `apps/api/src/worker.ts:442`
(`AnthropicHaikuAdapter`, D24 reasoning) +
`apps/api/src/adapters/brief-llm-anthropic.adapter.ts:228`
(`BriefLlmAnthropicAdapter`, D62 brief LLM). Cloud Run **worker**
service mounts it; the API service does NOT call Anthropic, and Vercel
web does NOT call Anthropic.

**Cloud Run wiring (one-time):**

```bash
echo -n "$PROD_KEY" | gcloud secrets create anthropic-api-key-prod --data-file=-
gcloud run services update declutrmail-worker \
  --update-secrets=ANTHROPIC_API_KEY=anthropic-api-key-prod:latest
```

**Spend caps:** Anthropic console → Plans & Billing → Set spend limit
per workspace. Caps are vendor-side hard limits, not advisory.

### Sentry

| Slot                         | Vendor label                                                                                                                                     | Storage                                                                           | Env var                               | Rotated                 | Owner   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- | ----------------------- | ------- |
| Web DSN                      | Sentry project: `declutrmail-web`                                                                                                                | `.env.local` + Vercel env (Production + Preview)                                  | `NEXT_PUBLIC_SENTRY_DSN`              | n/a (DSN, not a secret) | founder |
| Web release tag              | n/a                                                                                                                                              | Vercel auto-injects `VERCEL_GIT_COMMIT_SHA` → `NEXT_PUBLIC_SENTRY_RELEASE`        | `NEXT_PUBLIC_SENTRY_RELEASE`          | n/a                     | founder |
| Server DSN                   | Reuses FE DSN pre-launch (filter by `runtime:node` in Sentry UI); upgrade to separate project `declutrmail-api` post-launch                      | GCP Secret Manager: `sentry-dsn-api`                                              | `SENTRY_DSN` (Cloud Run API + worker) | 2026-06-08              | founder |
| Build-time source-map upload | Sentry **Organization Auth Token** `declutrmail-vercel-sourcemaps-202606`, scope `org:ci` (Source Map Upload + Release Creation + Code Mappings) | Vercel env (Production + Preview, encrypted) — `prj_hWYbyer4xJEWfCiSb9M3krrdh5D7` | `SENTRY_AUTH_TOKEN`                   | 2026-06-08              | founder |
| Build-time identity          | Sentry org slug                                                                                                                                  | GH Actions secret + Vercel build env                                              | `SENTRY_ORG`                          | n/a                     | founder |
| Build-time identity          | Sentry project slug                                                                                                                              | GH Actions secret + Vercel build env                                              | `SENTRY_PROJECT`                      | n/a                     | founder |

**Note on DSNs:** A Sentry DSN is technically a URL that anyone with the
DSN can post events to. It is NOT a secret in the strict sense — it
sits in the browser bundle. Still inventory it here because rotation
(e.g., quota abuse from a leaked DSN) requires the same lookup.

**Note on auth token:** `SENTRY_AUTH_TOKEN` IS a real secret — it
authorizes source-map upload during builds. Treat like an API key.
Use a Sentry **Organization Auth Token** (Settings → Developer
Settings → Auth Tokens — NOT user-scoped Personal Tokens), scope
`org:ci` which bundles Source Map Upload + Release Creation + Code
Mappings. Org tokens survive team-membership changes; personal
tokens do not.

### PostHog

| Slot            | Vendor label                 | Storage                                          | Env var                    | Rotated | Owner   |
| --------------- | ---------------------------- | ------------------------------------------------ | -------------------------- | ------- | ------- |
| Project API key | `declutrmail-prod` project   | `.env.local` + Vercel env (Production + Preview) | `NEXT_PUBLIC_POSTHOG_KEY`  | n/a     | founder |
| Ingest host     | `us.i.posthog.com` (default) | `.env.local` + Vercel env (optional)             | `NEXT_PUBLIC_POSTHOG_HOST` | n/a     | founder |

**Note:** PostHog's project API key is the `phc_...` value shipped to
the browser. Like a Sentry DSN, it is NOT a hard secret in the strict
sense (a leaked phc\_ key lets attackers send events to your project,
not read data). Inventory it for rotation triage.

### Google OAuth (Gmail)

| Slot                | Vendor label                | Storage                                                                                  | Env var                   | Rotated             | Owner   |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- | ------------------- | ------- |
| GCP project ID      | `declutrmail-ai-prod`       | `.env.local` + GH Actions secret                                                         | `GOOGLE_CLOUD_PROJECT_ID` | n/a                 | founder |
| OAuth client ID     | OAuth consent screen client | `.env.local` + GH Actions secret                                                         | `GOOGLE_CLIENT_ID`        | n/a (public-facing) | founder |
| OAuth client secret | OAuth consent screen client | `.env.local` + GH Actions secret + GCP Secret Manager: `google-oauth-client-secret-prod` | `GOOGLE_CLIENT_SECRET`    | 2026-06-08          | founder |
| OAuth redirect URI  | n/a (config string)         | `.env.local` + GH Actions secret                                                         | `GOOGLE_REDIRECT_URI`     | n/a                 | founder |

**Rotation note:** Rotating `GOOGLE_CLIENT_SECRET` invalidates all
in-flight OAuth flows. Coordinate with a maintenance window. The
client ID can stay stable.

### Database (Postgres)

| Slot          | Storage                                                                                                                                                                                                                                                                                                                    | Env var                                 | Rotated                                                            | Owner   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ | ------- |
| Local dev URL | `.env.local`                                                                                                                                                                                                                                                                                                               | `DATABASE_URL`                          | n/a (local default `postgres:postgres@localhost:5432/declutrmail`) | founder |
| Prod DB URL   | GCP Secret Manager: `database-url-prod` version 2 — real Supabase pooled DSN (`aws-0-us-west-2.pooler.supabase.com:6543`, transaction-mode). Migration DSN (session pooler, port 5432) stays out of the runtime mount; founder runs `atlas migrate apply` locally. ADR-0022 documents this swap from Cloud SQL → Supabase. | `DATABASE_URL` (Cloud Run API + worker) | 2026-06-08                                                         | founder |

**Note:** Prod DB URL embeds the password. Treat as a secret. Atlas
migration apply runs from CI only — Atlas CI workflow reads the same
secret.

### Redis / BullMQ

| Slot             | Storage                                                                                                                                                                                                              | Env var                              | Rotated                                                      | Owner   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ | ------- |
| Local dev URL    | `.env.local`                                                                                                                                                                                                         | `REDIS_URL`                          | n/a (local default `redis://localhost:6379`, docker-compose) | founder |
| Prod Upstash URL | GCP Secret Manager: `redis-url-prod` version 2 — real Upstash `declutrmail-v2-bullmq` (AWS us-west-1, Free tier, TLS `rediss://`, 256MB / 500K cmd/mo soft cap). Endpoint `coherent-jaybird-134126.upstash.io:6379`. | `REDIS_URL` (Cloud Run API + worker) | 2026-06-08                                                   | founder |

**Note:** Local must NOT point at Upstash — BullMQ idle polling burns
through the free tier in days. See `.env.example` lines 122-128.

### KMS / OAuth-token encryption (D14)

| Slot                    | Storage                                                                                                                                                   | Env var                | Rotated                         | Owner   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------- | ------- |
| KMS key resource (prod) | Plain env var on Cloud Run (resource path, not a secret); KMS access via runtime SA `declutrmail-api@…` with `roles/cloudkms.cryptoKeyEncrypterDecrypter` | `KMS_KEY_RESOURCE`     | 2026-06-08 (key + binding live) | founder |
| Local-dev fallback key  | `.env.local`                                                                                                                                              | `ENCRYPTION_LOCAL_KEY` | per-laptop, never shared        | founder |

**Rotation note:** Rotating the KMS KEK requires re-encrypting every
existing `mailbox_accounts.encrypted_oauth_*` blob with the new key.
This is a planned operation — see D14 + the to-be-written
`docs/runbooks/kms-rotation.md`.

### Session JWT secrets (D155)

| Slot                        | Storage                                       | Env var                                       | Rotated    | Owner   |
| --------------------------- | --------------------------------------------- | --------------------------------------------- | ---------- | ------- |
| Access token secret (prod)  | GCP Secret Manager: `jwt-access-secret-prod`  | `JWT_ACCESS_SECRET` (Cloud Run API + worker)  | 2026-06-08 | founder |
| Refresh token secret (prod) | GCP Secret Manager: `jwt-refresh-secret-prod` | `JWT_REFRESH_SECRET` (Cloud Run API + worker) | 2026-06-08 | founder |
| Local dev secrets           | `.env.local`                                  | `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`    | per-laptop | founder |

**Rule:** The two secrets MUST DIFFER — boot throws if equal (D155).
Generate fresh values with `openssl rand -base64 48`. Rotating either
in prod invalidates all active sessions (every user must re-login);
coordinate with a maintenance window or pair with refresh-token grace.

### Gmail Pub/Sub (D229)

| Slot                 | Storage                                                | Env var                       | Rotated | Owner   |
| -------------------- | ------------------------------------------------------ | ----------------------------- | ------- | ------- |
| Pub/Sub topic        | GH Actions secret + GCP Secret Manager (config string) | `GMAIL_PUBSUB_TOPIC`          | n/a     | founder |
| OIDC audience        | GH Actions secret + GCP Secret Manager (config string) | `PUBSUB_OIDC_AUDIENCE`        | n/a     | founder |
| OIDC service account | GH Actions secret + GCP Secret Manager (config string) | `PUBSUB_OIDC_SERVICE_ACCOUNT` | n/a     | founder |

**Note:** These are config identifiers, not secrets per se. Inventory
them because they are required at API boot and rotation requires a
coordinated Pub/Sub topic recreate.

### Admin allowlist

| Slot                               | Storage                                                                             | Env var                 | Rotated                                                                              | Owner   |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | ------- |
| Operator-facing read API allowlist | GH Actions secret + GCP Secret Manager: `admin-email-allowlist-prod` + `.env.local` | `ADMIN_EMAIL_ALLOWLIST` | 2026-06-08 (`chintan.a.thakkar@gmail.com`); update on every founder-headcount change | founder |

**Note:** Comma-separated allowlist of exact emails. Unset →
fail-closed (all admin routes return 404). The route is intentionally
indistinguishable from a non-existent route — see `.env.example` 72-79.

### Beta invite gate (buildout F7)

| Slot                  | Storage                                                      | Env var              | Rotated | Owner   |
| --------------------- | ------------------------------------------------------------ | -------------------- | ------- | ------- |
| Beta invite allowlist | GCP Secret Manager: `beta-invite-emails-prod` + `.env.local` | `BETA_INVITE_EMAILS` | TBD     | founder |

**Note:** Comma-separated, case-insensitive invite allowlist consumed
by the private-beta signup gate (`apps/api/src/auth/beta-gate.ts`).
With the gate enabled and this unset/empty, every new signup is denied
(fail-closed). The secret is NOT yet referenced by
`deploy-cloud-run.yml` — a referenced secret that doesn't exist fails
the whole deploy, so the `--update-secrets` binding ships in the same
PR that flips `BETA_GATE_ENABLED=true`, AFTER the founder creates the
secret. Create + bind:

```bash
echo -n "chintan.a.thakkar@gmail.com" | gcloud secrets create beta-invite-emails-prod \
  --project=declutrmail-ai-prod --data-file=-
gcloud secrets add-iam-policy-binding beta-invite-emails-prod \
  --project=declutrmail-ai-prod \
  --member="serviceAccount:declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Invite-list rotation = `gcloud secrets versions add` + a manual
`workflow_dispatch` re-deploy (Cloud Run pins the secret at revision
creation). The gate itself flips ONLY by editing `BETA_GATE_ENABLED`
in `deploy-cloud-run.yml` — never live `--update-env-vars` (the API
deploy uses full-replace `--set-env-vars`; a live flip silently
reverts on the next routine deploy → open signup, the PR #188
incident class).

### GitHub

| Slot                                    | Vendor label             | Storage                              | Env var                                     | Rotated    | Owner   |
| --------------------------------------- | ------------------------ | ------------------------------------ | ------------------------------------------- | ---------- | ------- |
| Personal access token (founder local)   | `declutrmail-cli-202606` | macOS Keychain via `gh auth login`   | n/a (consumed by `gh`)                      | TBD        | founder |
| GH Actions → GCP auth (WIF provider)    | n/a (resource path)      | GH Actions secret `GCP_WIF_PROVIDER` | resolved by `google-github-actions/auth@v2` | 2026-06-08 | founder |
| GH Actions → GCP auth (deploy SA email) | n/a (identifier)         | GH Actions secret `GCP_DEPLOY_SA`    | resolved by `google-github-actions/auth@v2` | 2026-06-08 | founder |

**Note:** Used for `gh pr create`, agent CI dispatch, etc. Scopes
required: `repo` + `workflow`. Stored in macOS Keychain by `gh auth
login`, not in `.env.local`.

**WIF (Workload Identity Federation):** The GitHub Actions deploy
workflow (`.github/workflows/deploy-cloud-run.yml`) authenticates to
GCP via WIF, NOT a long-lived SA JSON key. The GCP org policy
`constraints/iam.disableServiceAccountKeyCreation` blocks JSON keys
(intentional security default). WIF exchanges GitHub's OIDC token for
a short-lived GCP access token impersonating the deploy SA. The two GH
secrets are NOT secret values per se — they are the WIF provider
resource path and the deploy SA email. Listed here for inventory
completeness. To revoke: remove the
`roles/iam.workloadIdentityUser` binding on the deploy SA, or delete
the WIF pool/provider.

### Future / not-yet-configured

These will become real entries when the corresponding feature ships.
Listed here so a missing row is a known gap, not an oversight.

| Slot                                          | Status    | Trigger to wire                                |
| --------------------------------------------- | --------- | ---------------------------------------------- |
| Paddle live API key + webhook secret          | Not wired | Billing go-live §9 (D117; runbook 2026-07-17)  |
| Razorpay live key pair + webhook secret       | Not wired | Same go-live sequence (D117)                   |
| Vercel deploy token (CI)                      | Not wired | First Cloud Run + Vercel pairing PR (D160)     |
| GCP service account JSON for Cloud Run deploy | Not wired | Same PR                                        |
| Atlas Cloud token                             | Not wired | If Atlas Cloud is adopted post-migration count |

## Rotation cadence

Quarterly review (track in `FOUNDER-FOLLOWUPS.md`):

1. Anthropic keys — rotate annually unless a leak is suspected; update
   the date suffix in the vendor label.
2. Sentry auth token — rotate annually.
3. Google `GOOGLE_CLIENT_SECRET` — rotate annually with a maintenance
   window for in-flight OAuth.
4. JWT secrets — rotate annually with refresh-token grace; never both
   at once.
5. KMS KEK — defer to D14's rotation runbook (write before first prod
   data lands).
6. Paddle / Razorpay keys — rotate annually; webhook secrets rotated
   separately (D117).

After every rotation:

- Update the `Rotated` column above with the ISO date.
- Update the vendor label's date suffix (`-YYYYMM`) so the old key is
  obvious in audit logs.
- Mirror the new value into the personal vault.
- Run the affected service's smoke test from CLAUDE.md §8.

## On adding a new secret

1. Add a placeholder row to `.env.example` with `[local]` / `[gh]` /
   `[gcp]` tags.
2. Add a row to this inventory in the same PR.
3. Wire the GCP Secret Manager secret + Cloud Run mount (or Vercel env
   var) in the same PR if production needs it.
4. Mirror to the personal vault.
5. If the secret is leaky-by-design (DSN, public API key), still
   inventory it — rotation triage uses this doc.
