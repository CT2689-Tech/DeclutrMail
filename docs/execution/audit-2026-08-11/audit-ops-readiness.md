# DeclutrMail — Operational launch readiness

**Audited** 2026-08-11 · read-only · live probes + `gh` reads + repo

> **Checkout drift during the audit.** The working copy started this audit on `main` @ `40e73a4f`
> and ended on `chore/bootstrap-correct-ci-note` @ `55000d2b` ("absorb derived implementation-log
> drift") — a **concurrent session** is committing in this same checkout, and it also left an
> uncommitted `IMPLEMENTATION-LOG.md` change. Nothing in this audit wrote to the repo. The moved
> commits touch CI notes and the derived impl-log only, so no finding below is affected — but this
> is the known "checkout switched under a running smoke" trap, and it means any _behavioural_ smoke
> run in parallel with this audit is untrustworthy.

---

## Verdict: CONDITIONAL-GO

**Single most important reason:** the operational guard layer is now broad, but **three live guards
report green without having verified anything**, and the most exposed of them covers the one asset
that cannot be rebuilt after the fact. Production backups are provider-default only (Supabase Pro,
daily, 7-day retention, **PITR deliberately off**), the claim rests on **one dashboard reading from
2026-07-26 — 16 days stale** — and **no restore has ever been performed**. Nothing in CI, the
preflight, the watchdog, or the drift snapshot asserts a backup exists.

**Four of the six gates from the 2026-07-22 audit are closed:** branch protection, dependency-outage
detection, CASA/OAuth verification, and the backup _question_ (answered, though not verified since).
The two that remain open are the billing posture (live, zero events ever processed) and the
bouncing-mailbox tail.

---

## Gate table

| gate                                            | state                            | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             | who can close it                                                  | severity           |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| **DB backups exist**                            | 🟡 provider-default, unmonitored | `FOUNDER-FOLLOWUPS.md:1955-1960` — Supabase **Pro**, daily physical backups, 7 days retained, newest `25 Jul 2026 09:30:23 +0000`. Zero backup code in repo. Absent from `launch-preflight.sh` (all 8 groups), from `infra-snapshot`, and from `check-vendor-limits.mjs` — which checks DB **size** (live: 291.8 MB / 400 MB warn), not recoverability                                                                                                               | founder (dashboard) + agent (add check)                           | **launch-blocker** |
| **Restore verified**                            | 🔴 never tested                  | Grep `restore drill\|recovery drill\|pg_restore\|RPO\|RTO` across `docs/ scripts/ .github/` → **zero hits**. No restore runbook, no drill record                                                                                                                                                                                                                                                                                                                     | founder + agent (drill into throwaway project)                    | **launch-blocker** |
| **PITR**                                        | ⚪ off by decision               | `FOUNDER-FOLLOWUPS.md:1960` — "PITR deliberately OFF — founder decision… turn it on when losing 24 h would mean losing something not reconstructible from Gmail or the billing providers"                                                                                                                                                                                                                                                                            | founder                                                           | hygiene (accepted) |
| **API dependency detection**                    | 🟢 closed                        | `docs/execution/product-launch-audit-2026-07-25.md:47-49,177` — "**CLOSED 2026-07-26.** `/readyz` uptime check and 'API not ready' alert policy now exist and are enabled, with a **VERIFIED** notification channel." `setup-uptime-monitoring.sh:83-84` probes **both** `/healthz` and `/readyz` at 1-min period, asserting 2xx **and** body `"status":"ok"` — the 46-day-Redis lesson is encoded. **Live GCP state UNVERIFIABLE-FROM-HERE**                        | — (`FOUNDER-FOLLOWUPS.md:348` is stale bookkeeping, still "Open") | hygiene            |
| **`/readyz` asserts real deps**                 | 🟢 verified live                 | `curl https://api.declutrmail.com/api/readyz` → `{"status":"ok","checks":{"database":"ok","redis":"ok"}}` (200). `readiness.controller.ts:70,74` probes `select 1` + `redis.ping()` behind 2s timeouts; `:89-93` treats Redis `not_configured` as a **fault in production** → 503 `degraded`. `/healthz` asserts nothing, by design (`health.controller.ts:12-15`)                                                                                                   | —                                                                 | —                  |
| **Sentry alert rules**                          | 🔴 open; ~795 errors/day         | `FOUNDER-FOLLOWUPS.md:628-641` **Open since 2026-06-07** — "Errors land in Sentry but nothing pages on them." Live watchdog 2026-08-11: `Sentry 🟢 OK 80% — 795 accepted errors last 24h (warn 1,000)`. Rules are UI-only — **not verifiable from the repo**                                                                                                                                                                                                         | founder (Sentry UI)                                               | **revenue-risk**   |
| **Web uptime monitoring**                       | 🔴 none                          | `setup-uptime-monitoring.sh:26` hardcodes `API_HOST="api.declutrmail.com"`; no `checkly/betterstack/pingdom/uptimerobot` anywhere. `launch-preflight.sh check_web` is manual-run only. A bad Vercel deploy notifies nobody                                                                                                                                                                                                                                           | founder / agent (extend the script)                               | **revenue-risk**   |
| **Watchdog alert channel**                      | 🟡 failed-CI-email only          | `sync-stuck-watchdog.yml` (*/5 min) + `vendor-limits-watchdog.yml` (daily) alert **only** by failing a run — no issue, no page. Precedent it is ignored: `infra-snapshot` failed **8 consecutive** runs unnoticed (`FOUNDER-FOLLOWUPS.md:1987`), 43 before that                                                                                                                                                                                                      | founder (GH notification settings)                                | hygiene            |
| **Branch protection**                           | 🟢 closed                        | `gh api …/branches/main/protection` — 11 required checks, `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`, `required_conversation_resolution: true`; ruleset `protect main` **active**                                                                                                                                                                                                                                                 | —                                                                 | —                  |
| **Secret scanning**                             | 🔴 disabled on a PUBLIC repo     | `gh api …/secret-scanning/alerts` → _"Secret scanning is disabled on this repository"_. `visibility: public`. Dependabot open alerts: **0**                                                                                                                                                                                                                                                                                                                          | founder (one toggle)                                              | **security**       |
| **Dev-login off in prod**                       | 🟢 triple-guarded                | `DEV_AUTH*` absent from live Cloud Run env names (snapshot `2026-08-11`) **and** from `deploy-cloud-run.yml`; `main.ts:119-120` boot-refuses if set with `NODE_ENV=production`                                                                                                                                                                                                                                                                                       | —                                                                 | —                  |
| **CAN-SPAM postal address**                     | 🟡 unset → 3 kinds blocked       | `packages/shared/src/copy/postal-address.ts:43` — `BUSINESS_POSTAL_ADDRESS: readonly string[] = []`. Gate: `email-send.worker.ts:278` `if (COMMERCIAL_KINDS.has(payload.kind) && !hasPostalAddress())` → skip + `dead_letter_jobs` row + Sentry `email.refused_no_postal_address`. **Blocked:** `sync-reminder-24h`, `lapse-reengagement`, `weekly-value-receipt`. **Sends:** `sync-complete`, `sync-failed`, `deletion-scheduled`, `deletion-receipt`               | founder (obtain address) + agent (~20 min)                        | **compliance**     |
| **SPF / DKIM / bounce MX**                      | 🟢 closed                        | `send.declutrmail.com` TXT `v=spf1 include:amazonses.com ~all`; `resend._domainkey.send` 1024-bit RSA present; MX `10 feedback-smtp.us-east-1.amazonses.com`. Apex MX → Google Workspace. All three gaps at `founder-launch-checklist.md:99-104` are now filled                                                                                                                                                                                                      | —                                                                 | —                  |
| **DMARC enforcement**                           | 🟡 monitor-only                  | Apex `_dmarc` = `v=DMARC1; p=none; rua=mailto:<personal gmail>`. **No `_dmarc` on `send.declutrmail.com`** → sending subdomain inherits `p=none`. `declutrmail.com._report._dmarc.gmail.com` absent → aggregate reports likely silently dropped                                                                                                                                                                                                                      | founder (Squarespace DNS panel — founder-only, permanently)       | hygiene            |
| **support@ / privacy@ on `.com`**               | 🔴 unverified                    | Aliases added on **`.ai`** 2026-07-19; "`.com` delivery pending the declutrmail.com domain-alias add" — `FOUNDER-FOLLOWUPS.md`, marked Done but hedged. MX resolves, but **MX ≠ mailbox**. Corroborating: `EMAIL_REPLY_TO` still unset in prod because "a bouncing Reply-To is worse than none" (`email.service.ts:103-106`). Both addresses are published on the live legal pages                                                                                   | founder only (send a real email)                                  | **compliance**     |
| **Legal pages live**                            | 🟢 verified                      | `/privacy` `/terms` `/refunds` `/security` `/cookies` `/contact` → **200** on apex and app                                                                                                                                                                                                                                                                                                                                                                           | —                                                                 | —                  |
| **Cookie consent**                              | 🟢 fail-closed                   | `cookie-consent.ts` — no stored choice ⇒ analytics off; localStorage/cookie disagreement resolves to the **restrictive** value (`:84`). `posthog.ts:63` returns _before_ `await import('posthog-js')` (`:69`) — the SDK never downloads pre-consent. No `@vercel/analytics`, no `gtag`, **no browser Sentry SDK at all**                                                                                                                                             | —                                                                 | —                  |
| **Data deletion reachable**                     | 🟢 trap fixed                    | `apps/web/src/app/(app)/layout.tsx:115-122` — `/settings`, `/settings/privacy`, `/billing` render **through** the no-active-mailbox gate; comment cites D216 reachability at zero mailboxes. Founder re-verified 2026-07-19                                                                                                                                                                                                                                          | —                                                                 | —                  |
| **Gmail data inventory**                        | 🟢 runtime source of truth       | `gmail-data-inventory.ts` (475 lines) → `GMAIL_MESSAGE_STORAGE_LABELS:467` → `PRIVACY_STORAGE_ITEMS` → `/security`, `/privacy`, `/help`. `GMAIL_METADATA_HEADERS:454` drives the live adapter allowlist (`gmail-client.service.ts:256`); contract-tested                                                                                                                                                                                                             | —                                                                 | —                  |
| **CASA / OAuth verification**                   | 🟢 approved                      | `FOUNDER-FOLLOWUPS.md:2272-2283` — approved **21 Apr 2026**, project 387835380133, scope `gmail.modify`. **Recert deadline 21 Apr 2027**, start ~20 Feb 2027. Source artifact is an email, not a repo file                                                                                                                                                                                                                                                           | founder (diary the 2027-02 reminder)                              | compliance         |
| **Cost guardrails — Anthropic**                 | 🔴 zero layers, no watchdog row  | `ANTHROPIC_API_KEY` bound in prod (`deploy-cloud-run.yml:276`) and on the worker. Check **removed** from the watchdog (`check-vendor-limits.mjs:33-34`; `FOUNDER-FOLLOWUPS.md:2392` "removed … (PR #188)"), yet `billing-guardrails.md:63` still **declares a check that does not exist**. Spend cap never set. Only layer present: `REASONING_RATE_PER_MIN=400`                                                                                                     | founder (Anthropic console cap) + agent (re-add check)            | **revenue-risk**   |
| **Cost guardrails — Resend**                    | 🔴 zero layers, no watchdog row  | `RESEND_API_KEY=resend-api-key-prod` live (`deploy-cloud-run.yml:276`), but Resend is absent from `VENDORS`, and `billing-guardrails.md:70,295-300` still reads "(future) — Not provisioned". Its own runbook §9 required the shipping PR to add the row; it never did                                                                                                                                                                                               | agent (add check + row)                                           | **revenue-risk**   |
| **Cost guardrails — GCP**                       | 🟡 alert, no hard cap            | Live: `budgets armed — declutrmail-pre-launch-30: 20 USD` (alert only; name says 30, value is 20 — `FOUNDER-FOLLOWUPS.md:1983`). Kill-switch function **written but never deployed** (`infra/billing-hard-cap/index.js:52-53`; `git grep billing-hard-cap -- .github/` → empty). Open since 2026-06-08                                                                                                                                                               | founder                                                           | **revenue-risk**   |
| **Cost guardrails — Vercel / PostHog / Sentry** | 🟡 no hard caps                  | `FOUNDER-FOLLOWUPS.md:523-533` **Open since 2026-06-10**. Vercel is now demonstrably billable — live `MTD billed $1.61` — against a runbook row (`:94`) claiming Hobby "cannot bill"                                                                                                                                                                                                                                                                                 | founder (3 vendor toggles)                                        | hygiene            |
| **Cost guardrails — covered vendors**           | 🟢 9/9 reporting                 | Live run 2026-08-11T14:13Z: Supabase 73%, GCP armed, Upstash 35% ($3.55 MTD, $30 cap, Fixed plan so the suspend-kill-switch is gone), Vercel 8%, Sentry 80%, PostHog 0%, GH Actions $0 (public repo), Paddle 1-of-2 destinations, Razorpay 2/2. **Nothing UNCONFIGURED today**                                                                                                                                                                                       | —                                                                 | —                  |
| **`setup-billing-alerts.sh`**                   | 🔴 never run + stale filter      | Not invoked anywhere (`git grep setup-billing-alerts -- .github/ scripts/ package.json` → only its own header); no snapshot section could record it; no Done entry. **Even if run**, its log filter greps `"max requests limit exceeded"` (`:37`) — the 2026-06 string — while the 2026-07-25 recurrence was `ERR This database has been suspended for exceeding the defined budget limit` (`FOUNDER-FOLLOWUPS.md:2318`, 30,597 events/hr), which it would not count | founder (run it) + agent (fix filter)                             | **revenue-risk**   |
| **Billing enabled**                             | 🟢 live, both providers          | `deploy-cloud-run.yml:275` — `BETA_GATE_ENABLED=false,BILLING_ENABLED=true,PADDLE_ENV=production`. Both Paddle and Razorpay secrets bound (`:276`). Routing: `billing-region.ts:19` — `country === 'IN' ? 'razorpay' : 'paddle'`, geo sets the default only, user-overridable, unknown → Paddle. Catalog IDs are **real production IDs** (`pricing.config.ts:12`, LIVE-provisioned 2026-07-25)                                                                       | —                                                                 | —                  |
| **Billing ever processed**                      | 🔴 zero events, ever             | `billing-test-matrix-2026-07-29.md:5-6` — prod DB: `subscriptions=0 · subscription_events=0 · billing_customers=0 · pending_checkouts=0`; `:7` "The first person to pay is currently the test case". `FOUNDER-FOLLOWUPS.md:267-273` **Open — needs the founder's card**. Sandbox path **is** verified end-to-end (`:1768` free→plus in 37s; 26 PASSED rows in the matrix)                                                                                            | founder (one real $9 purchase, then refund)                       | **revenue-risk**   |
| **Webhook signature verification**              | 🟢 real, fail-closed             | Paddle `paddle.adapter.ts:749-792` — HMAC-SHA256 over `` `${ts}:`+rawBody ``, `timingSafeEqual`, ≤5s skew, multi-`h1` rotation. Razorpay `razorpay.adapter.ts:427-442` — same shape. Missing secret ⇒ **503**, unresolved event ⇒ **503 never 200** ("a 2xx retires the event from Paddle's retry queue and strands a real payment"). No stubs, no TODOs                                                                                                             | —                                                                 | —                  |
| **Paddle destination coupling**                 | 🟡 latent revenue risk           | Watchdog reads `1 active webhook destination(s) of 2` every run and asserts only `active.length >= 1` (`check-vendor-limits.mjs:440`) — it never checks the active destination's **URL**. With one per-destination `PADDLE_WEBHOOK_SECRET`, activating the wrong destination = money taken, entitlement never granted, and the check still passes                                                                                                                    | agent (assert URL)                                                | **revenue-risk**   |
| **Refund policy drift**                         | 🟢 resolved                      | 30-day money-back stated identically on `/refunds:47`, landing FAQ `:59`, hero `:164`, pricing teaser `:106`, `/help:104`, in-app `/billing:465`, shared constant `billing-model.ts:163`. Guard tests ban "14-day/pro-rata" (`legal-pages.test.tsx:92-113`). Cancel modal omits it deliberately (founder, 2026-07-31). Residual cosmetic gap: public `/pricing` carries no money-back line                                                                           | —                                                                 | hygiene            |

---

## Anti-blind-guard findings

The repo's dominant defect class — a guard reporting clean because its input was empty — is **still
live in four places**. Each returns green having verified nothing.

| guard                     | blind case                                                                                                                                                                                                                                                                                                                                 | evidence                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `check-vendor-limits.mjs` | **A vendor missing from the hardcoded registry is invisible** — no row, no failure. Nothing reconciles `VENDORS` against the runbook matrix. **This is exactly how Anthropic and Resend stayed unguarded.** Separately, `UNCONFIGURED` (empty secret) is excluded from the failure filter ⇒ exit 0; already fired once (`MISTAKES.md:820`) | `:536-567` (registry), `:569-573` (UNCONFIGURED), `:674-677` (failure filter)                 |
| `check-sync-stuck.sh`     | **Zero rows ⇒ exit 0.** Empty `provider_sync_state` prints `OK — no stuck syncs found`. It detects _stuck_ syncs, never _"the worker is dead and nothing was enqueued"_. Against the 46-day Redis outage it fires only if someone connected a mailbox inside the window                                                                    | `:86-89`. Credit: psql failure exits **2**, never conflated with the exit-1 signal (`:78-83`) |
| `launch-preflight.sh`     | **The monitoring group SKIPs wholesale on stale gcloud, and SKIP does not fail the run.** Reproduced live: `monitoring / pubsub / secrets / env-cloudrun` all skipped — i.e. _every_ uptime and alert-policy assertion — while the summary read a reassuring "26 passed"                                                                   | this audit's run, 2026-08-11T20:12Z                                                           |
| `infra-snapshot`          | Captures Cloud Run, Secret Manager, Atlas, IAM, GH secret **names** — but has **no monitoring/alert-policy section**. Someone deleting the uptime checks or alert policies is invisible to the drift detector                                                                                                                              | `docs/infra-snapshots/2026-07-26.json` top-level keys                                         |

### Two guard defects found live this run

1. **`infra-snapshot` was blind 2026-07-26 → 2026-08-10 (15 days).** Scheduled runs failed four days
   straight (Aug 7-10) fetching `refs/heads/infra-snapshots` — a branch that did not exist. Branch
   bootstrapped 2026-08-10; healthy now (`2026-08-10.json`, `2026-08-11.json` on branch).
2. **`launch-preflight.sh` emits a false FAIL.** Its `web` group reported _"sitemap canonical host is
   https://declutrmail.com, which is not DeclutrMail"_ while its `dns` group **passed** the identical
   assertion on the identical URL. Verified by hand: the apex **does** serve `Full bodies fetched: 0`
   and the sitemap `<loc>` **is** `https://declutrmail.com`. This is the transient-empty-response
   flake the script's own header warns about (`:47-50`). A preflight that cries wolf trains the
   founder to ignore preflight failures.

---

## Open gates, ordered by severity

### 1. No verified restore — launch-blocker

**Founder's next click:** Supabase dashboard → `declutrmail-prod` → Database → Backups. Confirm the
plan is still Pro and the newest backup is <48 h old. Last recorded reading: 2026-07-26.

**Agent command:** add a `checkSupabaseBackups` vendor to `scripts/check-vendor-limits.mjs` failing
when the newest backup is >48 h old — it **must exit 1 on an empty or unreadable backup list**, not
0, or it becomes the next instance of the class. Then run one restore drill into a throwaway project
and record timestamp + duration.

### 2. Two live metered vendors have zero guardrails — revenue-risk

Anthropic and Resend are both bound in production, both billed, and neither appears in the watchdog.
**Founder's next click:** Anthropic console → Settings → Limits → set a monthly spend cap on the prod
workspace; Resend → Settings → usage cap.
**Agent command:** add both to `VENDORS` in `scripts/check-vendor-limits.mjs`, and add a test that
fails when a vendor in `docs/runbooks/billing-guardrails.md` has no registry entry — that
reconciliation is the missing mechanism, not the two rows.

### 3. Nothing pages on ~795 errors/day — revenue-risk

**Founder's next click:** Sentry → Alerts → Create Alert Rule → "Number of errors" > 50 in 1 h →
notify email/Slack. Open since 2026-06-07.

### 4. Billing is live and has never processed one event — revenue-risk

**Founder's next click:** buy **Plus monthly ($9)** on production with a real card, confirm
`subscriptions.status=active` + `workspaces.tier=plus` + a `subscription_events` row, then refund the
**full** amount from the Paddle dashboard. Everything except the card entry can be agent-driven.
Live API keys, the live notification destination and its secret, the live catalog IDs and the live
webhook URL are the only surfaces sandbox never exercised.

### 5. `support@` / `privacy@` on `.com` unverified — compliance

**Founder's next click:** from a non-Google outside account, send one mail to
`support@declutrmail.com` and one to `privacy@declutrmail.com`; confirm both land. If they bounce:
Google Admin → Domains → Manage domains → **Add a domain alias** for `declutrmail.com`. Both
addresses are published on the live `/privacy`, `/terms` and `/contact`, so a bounce is a compliance
failure, not an inconvenience. Closing this also unblocks `EMAIL_REPLY_TO`.

### 6. Secret scanning disabled on a PUBLIC repo — security

**Founder's next click:** GitHub → Settings → Code security → **Secret scanning: Enable**, plus Push
protection. Free for public repos. Committing here is publishing.

### 7. Zero uptime monitoring on the web app — revenue-risk

**Agent command:** extend `scripts/setup-uptime-monitoring.sh` with a third check on
`https://declutrmail.com/` asserting body `Full bodies fetched: 0` — the trust badge, already the
preflight's content assertion, so the probe cannot go green on a parked page.

### 8. GCP has no hard cap — revenue-risk

**Founder's next click:** deploy the written-but-dormant kill switch at `infra/billing-hard-cap/`, or
accept the $20 alert-only budget explicitly. Open since 2026-06-08. Vercel / PostHog / Sentry hard
caps are three more vendor-console toggles, open since 2026-06-10.

### 9. CAN-SPAM postal address — compliance

Working gate, not a leak. Three commercial kinds are refused in prod on a recurring cron
(`worker.ts:1640,1713`), each refusal writing a dead-letter row + Sentry event. Marketing, onboarding
and all transactional mail are **not** gated.
**Founder's next click:** rent a virtual business address; a ~20-minute agent change then fills
`packages/shared/src/copy/postal-address.ts:43` and publishes it on `/contact`.
`FOUNDER-FOLLOWUPS.md:319`: "must close before the first non-founder send."

### 10. DMARC has no enforcement — hygiene

**Founder's next click:** Squarespace domains panel → add TXT `_dmarc.send` =
`v=DMARC1; p=none; rua=…` for subdomain-specific reporting, and TXT
`declutrmail.com._report._dmarc.gmail.com` = `v=DMARC1` so aggregate reports are accepted at all.
Move the apex to `p=quarantine` once reports are clean.

---

## Could not verify

| item                                           | why                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GCP uptime checks + alert policies exist       | **UNVERIFIABLE-FROM-HERE** — `gcloud monitoring uptime list-configs` → _"Reauthentication failed. cannot prompt during non-interactive execution."_ Best evidence is the dated founder record (2026-07-26, channel "VERIFIED"), contradicted only by a stale Open followup |
| Sentry alert rules                             | UI-only config with no repo representation; the Sentry MCP server is unauthorized in this non-interactive session                                                                                                                                                          |
| Supabase backup freshness today                | Requires dashboard auth; last reading 2026-07-26                                                                                                                                                                                                                           |
| `support@` / `privacy@` `.com` delivery        | Requires **sending** mail — outside a read-only audit, and founder-only                                                                                                                                                                                                    |
| GitHub "notify on failed workflow" setting     | Account-level, not repo-visible — yet it is the sole alert channel for both watchdogs                                                                                                                                                                                      |
| Live **values** of prod env vars               | Snapshot captures **names only**, by design (public repo). Values quoted here (`BILLING_ENABLED=true`, `PADDLE_ENV=production`, `BETA_GATE_ENABLED=false`) come from `deploy-cloud-run.yml:275`, which is authoritative for prod because `--set-env-vars` full-replaces    |
| Whether `provider_sync_state` has rows in prod | No prod DB access — this determines whether the sync-stuck watchdog's blind case is live or merely theoretical                                                                                                                                                             |
| Prod billing row counts today                  | Read-only audit, no billing API calls; newest recorded counts are 2026-07-29 (all zero)                                                                                                                                                                                    |

---

## Stale docs that would mislead an operator mid-incident

| file:line                                           | says                                                                | reality                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/execution/Implementation-Plan.md:4076-4077`   | "Cloud SQL Postgres… Daily backups + 7-day PITR"                    | Wrong provider (**Supabase**) and wrong PITR posture (**off**)       |
| `docs/services.md:90,93`                            | Supabase "Status: ⏳ Not yet", "Plan: Free (500 MB)"                | Live on **Pro**; 291.8 MB would already have blown a 500 MB Free cap |
| `docs/runbooks/billing-guardrails.md:63`            | Anthropic watchdog check + `ANTHROPIC_ADMIN_KEY`                    | Check removed (PR #188); declares a guard that does not exist        |
| `docs/runbooks/billing-guardrails.md:70,295-300`    | Resend "(future) — Not provisioned"                                 | Live in prod since D162                                              |
| `docs/runbooks/billing-guardrails.md:94`            | Vercel "Hobby — cannot bill · $0"                                   | Watchdog reads `MTD billed $1.61` on 6 consecutive runs              |
| `docs/runbooks/billing-guardrails.md:99,100`        | Paddle "Sandbox", Razorpay "Test mode"                              | Both **live** since 2026-07-25                                       |
| `docs/runbooks/billing-guardrails.md:64`            | GCP "UNCONFIGURED in CI today: no WIF auth step"                    | WIF step exists (`vendor-limits-watchdog.yml:58-63`); row is green   |
| `docs/execution/founder-launch-checklist.md:99-104` | "`support@`/`privacy@` currently bounce"; send SPF/MX "**Missing**" | DNS gaps all closed; apex MX present                                 |
| `docs/execution/d-break-ledger-2026-07-11.md`       | CASA cycle "in progress"                                            | Approved 21 Apr 2026                                                 |
| `FOUNDER-FOLLOWUPS.md:348-353`                      | readiness uptime check **Open**                                     | Closed 2026-07-26 per the newer audit; never moved to Done           |
