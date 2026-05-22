# DeclutrMail — Services & Credentials Registry

Reference inventory of every external service the project depends on.
**No actual keys or passwords live here** — those go in 1Password (or
equivalent) and GitHub repo secrets. This file records _what_ we use,
_why_, _which tier_, and _where the credential lives_.

---

## Legend

| Status      | Meaning                                 |
| ----------- | --------------------------------------- |
| ✅ Active   | Account created, service wired up       |
| ⏳ Not yet  | Will be needed; account not created yet |
| ➕ Optional | Nice-to-have; not on the critical path  |

---

## Services

### Anthropic (Claude API)

| Field                | Value                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Status**           | ✅ Active                                                                                                                      |
| **Purpose**          | Powers the 8-agent gate network in CI (`subagent-gate.yml`)                                                                    |
| **Account email**    | Personal Gmail                                                                                                                 |
| **Plan / tier**      | Pay-as-you-go (no committed spend yet)                                                                                         |
| **Approximate cost** | $0 so far                                                                                                                      |
| **Key name**         | `ANTHROPIC_API_KEY`                                                                                                            |
| **Key location**     | 1Password → _Anthropic_ item + GitHub repo secret                                                                              |
| **D-reference**      | CLAUDE.md §7 gate network                                                                                                      |
| **Notes**            | Key added to GitHub secrets unblocks real agent invocations in CI. See `FOUNDER-FOLLOWUPS.md` → "Configure ANTHROPIC_API_KEY". |

---

### GitHub

| Field                | Value                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Status**           | ✅ Active                                                                                                  |
| **Purpose**          | Source control, CI/CD (GitHub Actions), PR gate network                                                    |
| **Account**          | Personal account → `CT2689-Tech` org                                                                       |
| **Plan / tier**      | Free (public repo)                                                                                         |
| **Approximate cost** | $0                                                                                                         |
| **Key / secret**     | Personal access token or SSH key for pushes                                                                |
| **Key location**     | 1Password → _GitHub_ item                                                                                  |
| **D-reference**      | D158, D160                                                                                                 |
| **Notes**            | Code Security (CodeQL) must be enabled for the repo — see `FOUNDER-FOLLOWUPS.md` → "Enable Code Security". |

---

### Vercel

| Field                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| **Status**           | ⏳ Not yet                                                     |
| **Purpose**          | Hosts the Next.js web app (`apps/web`)                         |
| **Account email**    | —                                                              |
| **Plan / tier**      | Hobby (free) at launch; Pro ($20/mo) when custom domain needed |
| **Approximate cost** | $0–$20/mo                                                      |
| **Key / secret**     | `VERCEL_TOKEN` (for CI deploys)                                |
| **Key location**     | 1Password → _Vercel_ item (once created)                       |
| **D-reference**      | D158, D160                                                     |
| **Notes**            | Needed for PR #4's staging deploy workflow to go live.         |

---

### Google Cloud (Gmail OAuth + Pub/Sub)

| Field                | Value                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ⏳ Not yet                                                                                                                                                                                                                |
| **Purpose**          | Gmail OAuth credentials (client ID/secret) + Cloud Pub/Sub push for webhook notifications                                                                                                                                 |
| **Account email**    | —                                                                                                                                                                                                                         |
| **Plan / tier**      | Free tier covers dev volume; pay-as-you-go for Pub/Sub above free limit                                                                                                                                                   |
| **Approximate cost** | ~$0 in dev                                                                                                                                                                                                                |
| **Key / secret**     | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Pub/Sub service account JSON                                                                                                                                                  |
| **Key location**     | 1Password → _Google Cloud — DeclutrMail_ item (once created)                                                                                                                                                              |
| **D-reference**      | D6, D229 (Pub/Sub OIDC auth)                                                                                                                                                                                              |
| **Notes**            | Requires a GCP project, OAuth consent screen, and Pub/Sub topic. Pub/Sub webhook auth uses OIDC JWT — never `x-goog-authenticated-user-email` (D229). Stop condition — do not create OAuth scopes without founder review. |

---

### Supabase (Postgres)

| Field                | Value                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ⏳ Not yet                                                                                                                    |
| **Purpose**          | Managed Postgres 16 — the production database                                                                                 |
| **Account email**    | —                                                                                                                             |
| **Plan / tier**      | Free (500 MB, 2 projects) at launch; Pro ($25/mo) when needed                                                                 |
| **Approximate cost** | $0–$25/mo                                                                                                                     |
| **Key / secret**     | `DATABASE_URL` (connection string)                                                                                            |
| **Key location**     | 1Password → _Supabase — DeclutrMail_ item (once created)                                                                      |
| **D-reference**      | D150, D152, D235                                                                                                              |
| **Notes**            | Atlas runs migrations against this. `DATABASE_URL` also needed in `.env.local` for local development against a remote branch. |

---

### Stripe

| Field                | Value                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ⏳ Not yet                                                                                                                                                              |
| **Purpose**          | Subscription billing (Free / Plus / Pro tiers)                                                                                                                          |
| **Account email**    | —                                                                                                                                                                       |
| **Plan / tier**      | Stripe Pay-as-you-go (2.9% + 30¢ per transaction)                                                                                                                       |
| **Approximate cost** | Revenue-proportional                                                                                                                                                    |
| **Key / secret**     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                                                                            |
| **Key location**     | 1Password → _Stripe — DeclutrMail_ item (once created)                                                                                                                  |
| **D-reference**      | D17–D21, D77, D81                                                                                                                                                       |
| **Notes**            | Stop condition — billing webhook wiring requires founder review before going live. `STRIPE_WEBHOOK_SECRET` used for HMAC signature verification on all incoming events. |

---

### Sentry

| Field                | Value                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ⏳ Not yet                                                                                                                                    |
| **Purpose**          | Error monitoring + performance tracing (D159)                                                                                                 |
| **Account email**    | —                                                                                                                                             |
| **Plan / tier**      | Free (5K errors/mo) at launch; Team ($26/mo) when volume grows                                                                                |
| **Approximate cost** | $0–$26/mo                                                                                                                                     |
| **Key / secret**     | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (for source maps)                                                                                           |
| **Key location**     | 1Password → _Sentry — DeclutrMail_ item (once created)                                                                                        |
| **D-reference**      | D159                                                                                                                                          |
| **Notes**            | Privacy-auditor gates ensure no email body data ever reaches Sentry. `SENTRY_AUTH_TOKEN` is for upload-sourcemaps in the build pipeline only. |

---

### PostHog

| Field                | Value                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Status**           | ⏳ Not yet                                                                                                               |
| **Purpose**          | Product analytics — funnel tracking, feature flags (D159)                                                                |
| **Account email**    | —                                                                                                                        |
| **Plan / tier**      | Free (1M events/mo)                                                                                                      |
| **Approximate cost** | $0                                                                                                                       |
| **Key / secret**     | `POSTHOG_API_KEY` (public — safe to commit to frontend env)                                                              |
| **Key location**     | `.env.local` + GitHub repo secret                                                                                        |
| **D-reference**      | D159                                                                                                                     |
| **Notes**            | PostHog key is a _write-only_ ingest key — safe to expose in client-side code. No personal email content sent (D7/D228). |

---

### Atlas Cloud

| Field                | Value                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ➕ Optional                                                                                                                                                                                                               |
| **Purpose**          | Migration history dashboard + drift detection via Atlas Cloud UI                                                                                                                                                          |
| **Account email**    | —                                                                                                                                                                                                                         |
| **Plan / tier**      | Free tier available                                                                                                                                                                                                       |
| **Approximate cost** | $0                                                                                                                                                                                                                        |
| **Key / secret**     | `ATLAS_CLOUD_TOKEN`                                                                                                                                                                                                       |
| **Key location**     | 1Password → _Atlas Cloud_ item (once created)                                                                                                                                                                             |
| **D-reference**      | D152                                                                                                                                                                                                                      |
| **Notes**            | CI linting works without this (currently configured without token). Add token + re-wire `migration-lint.yml` only if cloud reporting UI is wanted. See `FOUNDER-FOLLOWUPS.md` → "(Optional) Configure ATLAS_CLOUD_TOKEN". |

---

### Upstash (Redis)

| Field                | Value                                                                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | ✅ Active                                                                                                                                                                                                                                                                                                            |
| **Purpose**          | Serverless Redis — backs the BullMQ queue for the Gmail sync workers (PR-C/D)                                                                                                                                                                                                                                        |
| **Account**          | **GitHub SSO** — signed up via "Continue with GitHub"; no separate Upstash password. Account recovery is tied to the GitHub account.                                                                                                                                                                                 |
| **Plan / tier**      | Free (256 MB data, 10 GB/mo bandwidth)                                                                                                                                                                                                                                                                               |
| **Approximate cost** | $0                                                                                                                                                                                                                                                                                                                   |
| **Key / secret**     | `REDIS_URL`                                                                                                                                                                                                                                                                                                          |
| **Key location**     | 1Password → _Upstash — DeclutrMail_ item + GitHub repo secret + GCP Secret Manager                                                                                                                                                                                                                                   |
| **D-reference**      | D157 (BullMQ on Redis)                                                                                                                                                                                                                                                                                               |
| **Notes**            | Eviction policy must be `noeviction` — BullMQ requires it or queued jobs can be silently dropped. Free tier is fine for dev + early launch; large initial syncs are command-heavy — watch the Upstash command count and move to Pay-as-You-Go if it caps. Provisioning steps: `docs/ops/sync-infra-setup.md` Step 3. |

---

## Adding a new service

1. Add a row to this file (PR preferred, or commit directly to `main` for docs-only changes).
2. Store the actual credential in **1Password** under a vault item named `<Service> — DeclutrMail`.
3. If CI needs it: add it as a **GitHub repo secret** at https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions.
4. If it's a stop-condition service (OAuth, billing, webhooks): add a **FOUNDER-FOLLOWUPS.md** entry before wiring it up.
