# Billing Guardrails

Every metered vendor DeclutrMail depends on gets three layers of spend
protection and a daily watchdog. This runbook is the operator manual:
the guardrail matrix, the founder setup click-paths, and the incident
playbook for when a check fires.

**Why this exists.** 2026-06-09/10: the always-on Cloud Run worker
(BullMQ, 9 consumers polling) burned through Upstash Redis free tier's
500K-commands/month cap in ~1 day. The whole async layer was down 41h
and was found by hand, not by an alert. Root causes: (1) Redis commands
were never treated as a metered resource — no limiter, no alert;
(2) the 2026-06-08 `min-instances=1` + `--no-cpu-throttling` fix was
costed for Cloud Run dollars but not Upstash commands; (3) zero usage
monitoring on any vendor. Founder directive: guardrails on EVERY
metered vendor + daily visibility. Decision record: ADR-0023.

**Companion artifacts** (built alongside this doc):

- `scripts/check-vendor-limits.mjs` — read-only usage checks, one per
  vendor; exits non-zero on any breach.
- `.github/workflows/vendor-limits-watchdog.yml` — daily cron running
  the script; a failed run makes GitHub email the founder.
- `scripts/setup-billing-alerts.sh` — GCP log-based alert on the
  BullMQ "max requests limit exceeded" error (the exact failure mode
  of the 2026-06-09 incident).
- Env-driven BullMQ polling tuning in `packages/workers` — fewer idle
  commands regardless of which Redis plan is underneath.

---

## The three-layer principle

Ordered by trust. A layer only counts if it survives the failure of
the layers below it.

| Layer                               | What                                                                                                                                                            | Survives                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **1. Vendor-side hard cap**         | Spend physically cannot exceed $X (Upstash Fixed flat plan, PostHog billing limit, GitHub budget with stop-usage, Vercel auto-pause, Anthropic workspace limit) | Our bugs, our outages, a runaway loop we never notice            |
| **2. Vendor-side alert**            | Vendor emails the founder at 50-90% of a threshold                                                                                                              | Our watchdog being broken or its secret expired                  |
| **3. App limiter + daily watchdog** | Polling tuned down in code + `vendor-limits-watchdog.yml` daily check                                                                                           | Nothing external — but catches drift days before layers 1-2 trip |

Rules:

- Every metered vendor MUST have layer 1 **if the vendor offers it**
  (GCP famously does not — budgets never stop spend).
- Layer 2 is mandatory everywhere.
- Layer 3 covers every vendor in the matrix below; a missing watchdog
  secret makes the check skip with a warning, not pass silently.
- Prefer plans where the meter is a **rate limit, not a billing
  meter** (Upstash Fixed vs PAYG): a bug then degrades to throttling
  instead of a bill or a 41h outage.

---

## Guardrail matrix

One row per metered vendor. Owner is `founder` everywhere (solo).

| Vendor              | Metered on                                                 | Plan + hard cap                                                                                                               | Vendor-side alert (console path)                                                    | App-side limiter                                                                                                 | Watchdog check + required secret                                                                                                                                                                                                             | Owner   |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Upstash Redis**   | Commands (rate), storage, bandwidth                        | **Fixed 250MB $10/mo** — flat rate, hard cap by design; overage = throttling, never billing                                   | PAYG-only budget emails (70/90%) — n/a on Fixed; eyeball console → database → Usage | BullMQ polling tuned via worker env (`packages/workers`)                                                         | `GET api.upstash.com/v2/redis/stats/{id}` — `daily_net_commands` + storage (db id discovered via `GET /v2/redis/databases`) · `UPSTASH_EMAIL` + `UPSTASH_API_KEY`                                                                            | founder |
| **Anthropic**       | Tokens → USD                                               | Tier 2, $500/mo invoice ceiling + per-workspace spend limits (hard: requests 4xx past limit)                                  | Console → Settings → Workspaces → [workspace] → Limits                              | Job-driven only (BullMQ concurrency); 3 key slots with per-slot caps ($20/$50/$100 — see `secrets-inventory.md`) | `GET /v1/organizations/cost_report` — sums month-to-date cost vs `ANTHROPIC_MTD_COST_WARN_USD` (default $50) · `ANTHROPIC_ADMIN_KEY`                                                                                                         | founder |
| **GCP**             | Cloud Run vCPU/mem (worker `min-instances=1`), KMS, egress | **No hard cap exists** — budgets are alert-only                                                                               | Billing → Budgets & alerts — `declutrmail-pre-launch-30` ($30, 50/90/100% emails)   | Cloud Run `max-instances`; `setup-billing-alerts.sh` log-based alert                                             | `gcloud billing budgets list` — asserts a budget EXISTS (UNCONFIGURED in CI today: the workflow has no WIF auth step; pulling budget spend via Pub/Sub message is future work) · `GOOGLE_APPLICATION_CREDENTIALS` + `GCP_BILLING_ACCOUNT_ID` | founder |
| **Supabase**        | DB disk, egress                                            | Free tier — cannot bill (pauses/restricts instead); on Pro: Spend Cap toggle                                                  | Free tier emails on resource exhaustion; Pro: Cost Control page                     | D7 allowlist bounds row size (no bodies stored)                                                                  | psql `SELECT pg_database_size(current_database())` vs threshold (default 400MB, env `SUPABASE_DB_SIZE_WARN_MB`) · `SUPABASE_SESSION_DSN`                                                                                                     | founder |
| **Vercel**          | Bandwidth, function invocations, builds                    | Hobby — cannot bill (hard-stops); on Pro: Spend Management + auto-pause                                                       | Pro-only: Settings → Billing → Spend Management (50/75/100% emails)                 | Static-leaning frontend; no server $ paths                                                                       | `GET /v1/billing/charges` `BilledCost` sum — **skip until Pro** (endpoint is team-scoped) · `VERCEL_TOKEN` + `VERCEL_TEAM_ID`                                                                                                                | founder |
| **Sentry**          | Accepted events per category                               | Free Developer tier — quota-drops, cannot bill; paid: on-demand budget $0 = hard stop                                         | Settings → Spike Protection (org-wide toggle)                                       | SDK sample rates in web/api init                                                                                 | `GET /organizations/{org}/stats_v2/` `outcome=accepted` daily count · `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`                                                                                                                                     | founder |
| **PostHog**         | Ingested events                                            | Free tier allowance; billing limit per product = hard cap (drops data past it)                                                | Auto-emails to org owner at 80/100% of billing limit                                | Events fired from web only, no server-side firehose                                                              | `GET /api/projects/{id}/quota_limits/` — any `limited: true` fails · `POSTHOG_API_KEY` + `POSTHOG_PROJECT_ID`                                                                                                                                | founder |
| **GitHub Actions**  | Runner minutes                                             | Free org plan, 2000 min/mo; budget with "stop usage" = true hard stop                                                         | Org Settings → Billing & licensing → Budgets and alerts (threshold emails)          | CI runs on PR only; `concurrency` groups cancel superseded runs                                                  | `GET /organizations/CT2689-Tech/settings/billing/usage` — `netAmount > 0` for `product=actions` fails · `GH_BILLING_PAT`                                                                                                                     | founder |
| **Resend** (future) | Emails/mo                                                  | Not provisioned — add row + watchdog check in the PR that wires it (D-billing emails)                                         | TBD at signup                                                                       | TBD                                                                                                              | TBD · `RESEND_API_KEY` reserved                                                                                                                                                                                                              | founder |
| **Paddle** (D117)   | Revenue (merchant-of-record, ~5% fees) — no spend meter    | n/a — fees scale with revenue; the risk is silent WEBHOOK death (auto-deactivated after sustained failures → tier flips stop) | Paddle emails account owner on payout/dispute anomalies (default)                   | Webhook handler is replay-safe (insert-first dedup on `subscription_events`); checkout rate-limited 10/min/user  | `GET /notification-settings` — BREACH when zero ACTIVE destinations · `PADDLE_API_KEY` (+ `PADDLE_ENV` var)                                                                                                                                  | founder |
| **Razorpay** (D117) | Revenue (India: UPI/cards, ~2-3% fees) — no spend meter    | n/a — same posture as Paddle; Razorpay disables a webhook failing consistently for ~24h                                       | Razorpay emails account owner when it disables a failing webhook                    | Same replay-safe webhook handler + checkout rate limit                                                           | `GET /v1/webhooks` — BREACH when zero ACTIVE webhooks · `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`                                                                                                                                            | founder |

**Informational — Gmail API quota (not billing, but a hard limit):**
`declutrmail-ai-prod` has 15,000 units/min/user and 1,200,000
units/min/project; `messages.get`/`list` cost 5 units each, so the
effective ceiling is ~3,000 calls/min/user. Exceeding it 429s, it
never bills. The ADR-0005 rate limiter is the app-side guardrail;
no watchdog row needed.

---

## Current known limits

What we are actually on today (2026-06-10). Update this table in the
same PR as any plan change.

| Vendor         | Plan           | Limit that matters                                                                        | Cost today                     |
| -------------- | -------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Upstash Redis  | Fixed 250MB    | 10K commands/sec rate limit · 250MB storage · 50GB bandwidth/mo — all throttle, none bill | $10/mo flat                    |
| Anthropic      | Tier 2         | $500/mo invoice limit · 1000 RPM `claude-haiku-4-5` · per-slot key caps $20/$50/$100      | usage-based under caps         |
| GCP            | Pay-as-you-go  | $30/mo budget — **alert-only, never stops spend**                                         | ~$15-25/mo (KMS + warm worker) |
| Supabase       | Free           | 500MB DB · 2GB egress/mo · pauses idle projects after 7d                                  | $0                             |
| Vercel         | Hobby          | Hard-stops at included usage, cannot bill                                                 | $0                             |
| Sentry         | Free Developer | Drops events past monthly quota, cannot bill                                              | $0                             |
| PostHog        | Free           | Free monthly event allowance, no card on file                                             | $0                             |
| GitHub Actions | Free (org)     | 2000 minutes/mo included                                                                  | $0                             |
| Gmail API      | n/a (quota)    | 15K units/min/user · 1.2M units/min/project (informational)                               | $0                             |
| Paddle         | Sandbox        | Revenue vendor (~5% + $0.50/txn as merchant-of-record); no spend meter                    | $0 until revenue               |
| Razorpay       | Test mode      | Revenue vendor (~2-3%/txn, India); subscriptions need Razorpay activation                 | $0 until revenue               |

---

## Founder setup, per vendor

Each subsection: (a) create the token the watchdog needs, (b) enable
the vendor's built-in cap/alert. All `gh secret set` commands run from
the repo root and prompt for the value (paste, Enter, Ctrl-D) — never
put the value on the command line.

### 1. Upstash Redis

**(a) Watchdog token** — Management API key:

1. `https://console.upstash.com/account/api` (console → Account →
   Management API) → **Create API Key**. Label
   `declutrmail-watchdog-202606`.
2. ```bash
   gh secret set UPSTASH_EMAIL     # the Upstash account email
   gh secret set UPSTASH_API_KEY   # the key from step 1
   ```
   (No database-id secret needed — the check lists databases via
   `GET /v2/redis/databases` and uses the single prod Redis.)

**(b) Built-in cap** — already structural: the **Fixed 250MB plan is
the hard cap** (flat $10/mo; exceeding 10K cmd/sec rate-limits, never
bills). If the database is ever moved back to pay-as-you-go, set the
**Budget** cap on the database/plan settings in the console (PAYG
only; 70%/90% emails included) before the first deploy. Eyeball usage
anytime at console → `declutrmail-v2-bullmq` → Usage.

### 2. Anthropic

**(a) Watchdog token** — Admin key (NOT a regular `sk-ant-api...` key;
the cost endpoints require `sk-ant-admin...` and an org account):

1. `https://platform.claude.com/settings/admin-keys` (Console →
   Settings → Admin keys; needs the admin role) → create
   `declutrmail-watchdog-202606`.
2. ```bash
   gh secret set ANTHROPIC_ADMIN_KEY
   ```

**(b) Built-in cap** — Console → Settings → Workspaces → [workspace]
→ **Limits** → set monthly spend limit. Per-slot caps ($20 local /
$50 CI / $100 prod worker) are already live — see
`docs/runbooks/secrets-inventory.md`. Verify each slot still has its
cap after any key rotation.

### 3. Google Cloud

**(a) Watchdog auth** — **UNCONFIGURED in CI today, by design.** The
check (when configured) runs `gcloud billing budgets list` and only
asserts that a budget EXISTS — i.e. Google's own threshold emails are
armed. It does NOT read current spend. To activate it in CI, the
workflow needs a `google-github-actions/auth` WIF step (which exports
`GOOGLE_APPLICATION_CREDENTIALS`) + a service account holding
`roles/billing.viewer` on the billing account + the
`GCP_BILLING_ACCOUNT_ID` secret:

```bash
gh secret set GCP_BILLING_ACCOUNT_ID   # from `gcloud billing accounts list`
```

**Future work — read actual spend:** budgets have no "current spend"
REST endpoint; Pub/Sub is the canonical channel (attach a topic to the
budget via Billing → Budgets & alerts → `declutrmail-pre-launch-30` →
Manage notifications → **Connect a Pub/Sub topic**, then have the
watchdog pull the latest `costAmount` / `budgetAmount` message). Not
implemented in `check-vendor-limits.mjs` today.

**(b) Built-in alert** — the $30 budget with 50/90/100% emails is
live (see `prod-infra-bootstrap.md` Step 1). **GCP has no hard cap**
— a budget never stops spend. The compensating control is
`scripts/setup-billing-alerts.sh` (log-based alert on the BullMQ
"max requests limit exceeded" error) + the Cloud Run `max-instances`
flag on both services.

### 4. Supabase

**(a) Watchdog token** — none needed. The check reuses
`SUPABASE_SESSION_DSN` (already a GH Actions secret for the
sync-stuck watchdog + Atlas migrations) and runs
`SELECT pg_database_size(current_database())` via psql, comparing
against a warn threshold (default 400MB, env
`SUPABASE_DB_SIZE_WARN_MB`). No Management API token, no project ref.

**(b) Built-in cap** — Free tier today: the project pauses/restricts
instead of billing, so the cap is structural. **The moment the org
upgrades to Pro:** Dashboard → Organization → Settings → Billing →
**Cost Control** → toggle **Spend Cap ON** (throttles instead of
billing overages) — in the same sitting as the upgrade, before
anything else.

### 5. Vercel

**(a) Watchdog token:**

1. `https://vercel.com/account/tokens` (avatar → Account Settings →
   Tokens) → **Create**, scope to the DeclutrMail team, label
   `declutrmail-watchdog-202606`.
2. ```bash
   gh secret set VERCEL_TOKEN
   gh secret set VERCEL_TEAM_ID
   ```
   The `/v1/billing/charges` endpoint is team-scoped; on today's
   Hobby plan the watchdog skips Vercel (Hobby hard-stops and cannot
   bill). Wire both secrets when Pro lands.

**(b) Built-in cap** — on Pro upgrade day: Dashboard → Settings →
Billing → **Spend Management** → toggle on → set USD amount per
billing cycle → enable **"Pause production deployment"** (auto-pause
at 100%; web/email alerts at 50/75/100%). Caveat: checks run every
few minutes, pausing is not instantaneous; unpausing is manual
per-project.

### 6. Sentry

**(a) Watchdog token** — Organization Auth Token (NOT a personal
token; org tokens survive membership changes):

1. sentry.io → Settings → **Developer Settings** → Organization
   Tokens → create `declutrmail-watchdog-202606` with `org:read`.
2. ```bash
   gh secret set SENTRY_AUTH_TOKEN
   gh secret set SENTRY_ORG   # the org slug, e.g. from the sentry.io URL
   ```

**(b) Built-in cap** — two layers:

- Settings → **Spike Protection** → toggle on org-wide (auto
  rate-limits sudden event-volume spikes). Do this now, free tier
  included.
- If/when on a paid plan: Settings → Subscription → **On-Demand
  Budget** → set $0 (hard-stops overage spend).

### 7. PostHog

**(a) Watchdog token:**

1. `https://us.posthog.com/settings/user-api-keys` (Settings → User →
   Personal API Keys) → create with scope `project:read`, label
   `declutrmail-watchdog-202606`.
2. ```bash
   gh secret set POSTHOG_API_KEY
   gh secret set POSTHOG_PROJECT_ID
   ```

**(b) Built-in cap** — `https://app.posthog.com/organization/billing`
(Organization → Billing) → bottom of each product → **"Set billing
limit"**. This is THE PostHog guardrail: a hard cap that stops
ingestion past the limit (data over the cap is lost forever; owner
emails at 80% and 100%). Set it the day a card goes on file. There is
no API to set/read the limit amount — in-app only; the watchdog
instead reads `quota_limits` to detect `limited: true` (which means
data is already being dropped).

### 8. GitHub Actions

**(a) Watchdog token** — the workflow's default `GITHUB_TOKEN` CANNOT
read billing (repo-scoped, no billing permission), so a fine-grained
PAT is required:

1. github.com → Settings → Developer settings → Personal access
   tokens → **Fine-grained tokens** → Generate new token. Resource
   owner: `CT2689-Tech`. Permission: **Plan: read-only** (the
   documented permission for the enhanced billing usage endpoints).
   Label `declutrmail-watchdog-202606`. (Classic-PAT equivalent:
   `manage_billing:org`.)
2. ```bash
   gh secret set GH_BILLING_PAT
   ```

**(b) Built-in cap** — org Settings → **Billing & licensing** →
Budgets and alerts → **New budget** → scope to "Actions" → amount
**$0** → check **"Stop usage when budget limit is reached"** + email
alerts. A $0 Actions budget is a true hard stop: included free
minutes (2000/mo) keep working, paid minutes are blocked.

### 9. Resend (future)

Not provisioned. The PR that wires transactional email MUST: add the
matrix row above with real values, add the watchdog check, set the
sending quota/plan cap at signup, and add the secret row to
`secrets-inventory.md`. Reserved secret name: `RESEND_API_KEY`.

### 10. Paddle (billing provider, D117)

Revenue vendor — fees are a % of revenue, so there is no spend cap to
arm. The guardrail target is WEBHOOK DELIVERY: Paddle auto-deactivates
a notification destination after sustained delivery failures, after
which subscription tier flips silently stop. The watchdog asserts ≥1
active destination daily.

**(a) Watchdog/API key** — Paddle dashboard → Developer tools →
Authentication → **API keys** → create (label
`declutrmail-watchdog-202606`). Sandbox and live are separate
accounts with separate keys.

```bash
gh secret set PADDLE_API_KEY      # server-side API key
gh secret set PADDLE_CLIENT_TOKEN # client-side (publishable) token
```

Set the repo **variable** `PADDLE_ENV=production` (Settings → Secrets
and variables → Actions → Variables) once the live account is wired;
leave unset for sandbox.

**(b) Webhook destination** — Developer tools → Notifications →
**New destination** → URL
`https://<api-host>/api/webhooks/billing/paddle`, type webhook,
events: `subscription.*`, `transaction.completed`,
`transaction.payment_failed`, `adjustment.created`. Copy the
destination's **secret key**:

```bash
gh secret set PADDLE_WEBHOOK_SECRET
```

**(c) Vendor-side alert** — Paddle emails the account owner on
payout/dispute anomalies by default; webhook-failure visibility is the
watchdog row (layer 3).

### 11. Razorpay (billing provider, D117)

Same posture as Paddle: revenue vendor, webhook delivery is the
guardrail. Razorpay disables a webhook that fails consistently for
~24h; the watchdog asserts ≥1 active webhook daily.

**(a) Watchdog/API keys** — Razorpay dashboard → Account & Settings →
**API keys** → generate key pair (test mode `rzp_test_…` / live
`rzp_live_…`; live requires account activation + subscriptions
feature enablement).

```bash
gh secret set RAZORPAY_KEY_ID
gh secret set RAZORPAY_KEY_SECRET
```

**(b) Webhook** — Account & Settings → **Webhooks** → Add new webhook
→ URL `https://<api-host>/api/webhooks/billing/razorpay`, set a strong
secret, events: `subscription.activated`, `subscription.charged`,
`subscription.updated`, `subscription.pending`, `subscription.halted`,
`subscription.cancelled`, `subscription.completed`,
`subscription.paused`, `subscription.resumed`.

```bash
gh secret set RAZORPAY_WEBHOOK_SECRET
```

**(c) Vendor-side alert** — Razorpay emails the account owner when it
disables a failing webhook; keep that address monitored.

---

## Incident playbook — when the watchdog fires

The watchdog fails its workflow run on any breach; GitHub emails the
founder. First moves, always:

1. Open the failed `vendor-limits-watchdog` run → the failing step
   names the vendor and prints the offending metric.
2. Confirm at the vendor console (links below) — the watchdog is
   read-only and could itself be stale.
3. Stop the bleeding with the vendor-specific flip below, THEN
   diagnose. Caps and pauses are reversible; a runaway meter is not.
4. Afterwards: append the incident to `MISTAKES.md` and check whether
   the breached threshold or a missing limiter needs a code change.

| Vendor             | Where to look                                                                              | What to flip                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Upstash**        | console → `declutrmail-v2-bullmq` → Usage (`daily_net_commands` trend, storage, bandwidth) | Fixed plan can't bill — breach means throttling risk. Stop the pollers: `gcloud run services update declutrmail-worker --min-instances=0 --max-instances=0 --region=us-central1`. If storage near 250MB: clean completed/failed BullMQ jobs before scaling back up |
| **Anthropic**      | Console → Usage + Cost pages; `cost_report` groups by `api_key_id` to find the hot slot    | Disable the runaway key slot in Console → API keys (3 slots = small blast radius; prod worker key only stops LLM jobs, not the app). Workspace spend limit already hard-stops at the cap                                                                           |
| **GCP**            | Billing → Reports, group by service (Cloud Run vs KMS vs egress)                           | No cap exists: scale the offending service down (`gcloud run services update <svc> --min-instances=0`), and if spend is truly runaway, Billing → Account management → disable billing on the project (nuclear — takes everything down)                             |
| **Supabase**       | Dashboard → org → Usage (disk, egress)                                                     | Free tier self-limits. If disk is the issue: investigate `mail_messages` growth vs D7 allowlist; ADR-0022 migration triggers may be firing early. Pro: verify Spend Cap is still ON                                                                                |
| **Vercel**         | Dashboard → Usage; Spend Management webhook payload if configured                          | Hobby self-stops. Pro: Spend Management pauses production automatically at 100%; manual unpause per-project after the cause is fixed                                                                                                                               |
| **Sentry**         | Stats page (`stats_v2`, `outcome=accepted` by project)                                     | Spike Protection should have auto-throttled; if a leaked DSN is the source, rotate the DSN (see `secrets-inventory.md`). Lower SDK sample rates in the offending app                                                                                               |
| **PostHog**        | Organization → Billing (quota bars)                                                        | `limited: true` = data already dropping. Decide: raise the billing limit (spend) or accept the gap (free). Check for an event-firing loop in `apps/web` before raising anything                                                                                    |
| **GitHub Actions** | Org Settings → Billing & licensing → Usage (per-repo minutes)                              | Budget already hard-stops paid minutes. Find the hot workflow (`gh run list --limit 50`), disable it (`gh workflow disable <name>`), fix, re-enable                                                                                                                |

**Cross-vendor rule of thumb:** the worker is the only always-on
compute and was the cause of the founding incident — when in doubt,
`--min-instances=0 --max-instances=0` on `declutrmail-worker` is the
universal circuit breaker. The API service is request-driven and
self-quiets; the web app is static-leaning on Vercel.
