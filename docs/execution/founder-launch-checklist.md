# Founder launch checklist

**Verified against production on 2026-07-09.** Every claim below was probed,
not assumed. Re-derive current state at any time with:

```bash
./scripts/launch-preflight.sh            # all groups
./scripts/launch-preflight.sh dns mail   # one or more of: dns mail web api env
```

Exit 0 means every check in the selected groups passed. That script is the
contract: **an item is done when its preflight group goes green**, not when
someone remembers doing it. Agents (Claude, Cursor, Codex) should run it
before claiming any infra work is complete.

---

## 0. Corrections to the previous checklist

The prior draft was written from memory and has drifted. Do not follow it.

| Prior claim                                                                               | Reality (probed 2026-07-09)                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "At your DNS host (Cloudflare/registrar)…"                                                | Close enough, with a trap. `whois` → **Squarespace Domains LLC**; nameservers are `ns-cloud-a{1..4}.googledomains.com`, which is _legacy Google Domains infrastructure Squarespace inherited_, **not** Google Cloud DNS. `gcloud dns managed-zones list` returns nothing in any of your three projects. Edit records in the **Squarespace domains panel**. Agents cannot touch DNS.                                                   |
| "Add apex + www in Vercel → Domains"                                                      | `declutrmail.com` was **already added to the Vercel team 31 days ago**. It needs attaching to the `declutr-mail` project + the DNS records flipped — not a fresh domain add.                                                                                                                                                                                                                                                          |
| "Confirm `GMAIL_CONNECT_ENABLED=true`"                                                    | **That flag no longer exists.** `apps/api/src/app.module.ts:43` — _"old `GMAIL_CONNECT_ENABLED` flag is gone; auth is core."_ Remove it from every runbook.                                                                                                                                                                                                                                                                           |
| "Do **not** set the PostHog key first"                                                    | **Already set**, in Vercel Production, 34 days ago. The privacy promise is kept in code, not by withholding the key: `hasAnalyticsConsent()` must return `'all'` before `posthog-js` is even imported, and it is re-checked on _every_ `track()` call. The banner is mounted in the `(marketing)`, `(app)`, and `onboarding` layouts. This item is now **verify**, not **sequence**.                                                  |
| "Rotate any exposed Resend key… trigger a test"                                           | It is **two** secrets, not one, and they belong to **different services**. `RESEND_API_KEY` (worker only — the sender) and `RESEND_WEBHOOK_SECRET` (api only — signature verification) both exist as **GitHub Actions secrets only**, which the running services cannot read. `EmailService` **fails closed in prod today**. Binding needs Secret Manager secrets + a PR to `deploy-cloud-run.yml`. Not a console toggle. See item 6. |
| "`curl https://declutrmail.com/help`" as a verify step                                    | Fine, but `curl -sL … \| grep` is invisible to an agent unless something aggregates the exit codes. All verify steps now live in `scripts/launch-preflight.sh`.                                                                                                                                                                                                                                                                       |
| Implied: rate limiting is off in prod (`RATE_LIMIT_ENABLED=false` in the deploy workflow) | **False alarm, re-confirmed.** `rate-limit.module.ts` only honours the opt-out when `!isProd`. Production keeps the limiter on. See "Known footguns" below — the flag is still worth removing.                                                                                                                                                                                                                                        |
| "Growth SEO is shipped in PR #309"                                                        | Correct — `/vs`, `/how-to`, `/answers`, `/methodology`, `/changelog`, `/inbox-simulator` are all in #309. But #309 is a **draft**, is titled `docs(execution):`, and touches 60 files including `activity`, `autopilot`, `senders`, and `triage` feature code. It is not a docs-only rubber stamp.                                                                                                                                    |

### Newly found, not in the prior checklist

1. **`declutrmail.com` has no MX records.** `support@declutrmail.com` and
   `privacy@declutrmail.com` are published in 20 places across `/help`,
   `/contact`, `/refunds`, and the marketing footer. Mail sent to them
   **hard-bounces right now.** Google Workspace is on `declutrmail.ai`, not
   `.com`.
2. **The live sitemap points at Squarespace.** `NEXT_PUBLIC_APP_URL` is unset
   in Vercel, so `siteUrl()` falls back to `https://declutrmail.com`, and
   every `<loc>`, canonical, and OG URL resolves to the Squarespace page.
3. **Resend's sending domain is only one-third configured.**
   `send.declutrmail.com` has DKIM but **no SPF and no bounce MX**. Resend
   will not report the domain as verified.
4. **There is no `/api/health` route.** 28 controllers, none of them health.
   Any uptime monitor pointed there gets a permanent 404. The liveness proxy
   is the error envelope on `GET /` (it carries a `correlationId`).

---

## Step −1 — Agent access ✅ done 2026-07-09

`gcloud auth login` + `gcloud config set project declutrmail-ai-prod` are done.
Agents can now read Cloud Run env, Secret Manager, Pub/Sub, and logs. This
turned three checklist items from "founder opens a console" into "already
verified" — see items 3 and 7.

It did **not** unlock DNS. The zone is not in Cloud DNS (see the corrections
table); DNS stays founder-only.

### What each connected tool unlocks

| Tool         | State            | What an agent can do with it                                                                                                                            |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcloud`     | ✅ authed        | Cloud Run env, Secret Manager, Pub/Sub, logs                                                                                                            |
| `gh`         | authed           | PRs, GH Actions secret _names_, workflow files                                                                                                          |
| `vercel` CLI | authed           | Read + write project env, domains, deployments                                                                                                          |
| Chrome MCP   | connected        | Consent-banner + PostHog-network verification (item 5), 375px responsive checks                                                                         |
| Supabase MCP | **unauthorized** | _(after `/mcp` auth in an interactive session)_ prod schema + logs. Authorize **read-only** first.                                                      |
| Sentry       | no MCP           | `SENTRY_AUTH_TOKEN` is a GH secret; export it locally and agents can use the Sentry REST API                                                            |
| Resend       | no MCP           | `RESEND_API_KEY` is a GH secret (worker-only credential — do not bind it to the API); `curl https://api.resend.com/domains` returns verification status |
| **DNS**      | ❌ no CLI path   | Squarespace domains panel only — **founder-only, permanently**                                                                                          |

**Irreducibly founder-only:** DNS records, the real Google OAuth grant against
a real Gmail account, Paddle/Razorpay catalog creation, buying Plus with a real
card, approving the account-deletion purge job (CLAUDE.md §9 stop-condition),
and mirroring secrets into 1Password.

---

## Phase 0 — Unblocks private beta

### 1. DNS: one zone edit, not four

Items 1, 2, and 6 all mutate the **same zone**, in the **Squarespace domains
panel** (`domains.squarespace.com` → declutrmail.com → DNS). There is no CLI
path; `gcloud dns` does not manage this zone. Do all the records in one sitting
— a partial edit that moves the apex without carrying the `send.` records
silently unsigns outbound email.

Records to end up with:

| Name                     | Type  | Value                                         | Why                                      |
| ------------------------ | ----- | --------------------------------------------- | ---------------------------------------- |
| `declutrmail.com`        | A     | Vercel's apex IPs                             | Marketing off Squarespace                |
| `www`                    | CNAME | `cname.vercel-dns.com.`                       | Marketing off Squarespace                |
| `declutrmail.com`        | MX    | Google Workspace (`aspmx.l.google.com.` etc.) | `support@` / `privacy@` currently bounce |
| `declutrmail.com`        | TXT   | `v=spf1 include:_spf.google.com ~all`         | Workspace sending                        |
| `_dmarc`                 | TXT   | `v=DMARC1; p=none; rua=mailto:…`              | Start at `p=none`, tighten later         |
| `send`                   | TXT   | `v=spf1 include:amazonses.com ~all`           | **Missing** — Resend SPF alignment       |
| `send`                   | MX    | `feedback-smtp.<region>.amazonses.com.`       | **Missing** — Resend bounce handling     |
| `resend._domainkey.send` | TXT   | _(already present — do not touch)_            | Resend DKIM                              |
| `app`                    | CNAME | `cname.vercel-dns.com.`                       | _(already correct)_                      |
| `api`                    | CNAME | `ghs.googlehosted.com.`                       | _(already correct)_                      |

Then attach the apex + `www` to the `declutr-mail` Vercel project and wait for
certs. The domain is already on the team, so this is an attach, not an add.

**Verify:** `./scripts/launch-preflight.sh dns mail` → all green.

### 2. Mailboxes: alias `.com` onto the existing `.ai` Workspace

Google Workspace already runs on `declutrmail.ai` (that is why the gcloud
account is `admin@declutrmail.ai`). Add `declutrmail.com` as a **domain alias**
rather than standing up a second tenant, then create `support@` and `privacy@`
as aliases routed to an inbox you read.

**Verify:** MX check above goes green, then send a real message to each from an
outside account and confirm delivery. Preflight can prove the records exist; it
cannot prove a human reads the inbox.

### 3. Canonical origin — decide before the DNS cutover lands

`siteUrl()` reads `NEXT_PUBLIC_APP_URL` and falls back to the apex. Two valid
resolutions, and the choice is yours:

- **Apex is canonical** (recommended — matches the sitemap already in prod):
  finish the DNS cutover and leave `NEXT_PUBLIC_APP_URL` unset.
- **`app.` is canonical:** set `NEXT_PUBLIC_APP_URL=https://app.declutrmail.com`
  in Vercel Production and **redeploy** (`NEXT_PUBLIC_*` is baked at build
  time, so an env change alone does nothing).

Until one of these happens, every canonical URL, OG tag, and sitemap entry the
crawler sees points at Squarespace.

**API config: verified against the live `declutrmail-api` revision, 2026-07-09.**
Nothing to do here. `--set-env-vars` is a **full replace**, so never hand-edit
these live — change `deploy-cloud-run.yml` and redeploy.

| Env                         | Live value                                             | Status                                            |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `NODE_ENV`                  | `production`                                           | ✅                                                |
| `WEB_URL`                   | `https://app.declutrmail.com`                          | ✅                                                |
| `CORS_ORIGIN`               | `https://app.declutrmail.com`                          | ✅ (widen if the apex calls the API)              |
| `COOKIE_DOMAIN`             | `.declutrmail.com`                                     | ✅                                                |
| `GOOGLE_REDIRECT_URI`       | `https://api.declutrmail.com/api/auth/google/callback` | ✅ — live `/api/auth/google/start` 302s to Google |
| ~~`GMAIL_CONNECT_ENABLED`~~ | _(absent)_                                             | **flag deleted; remove from runbooks**            |

Secrets bound to the live revision: `ADMIN_EMAIL_ALLOWLIST`, `ANTHROPIC_API_KEY`,
`DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`REDIS_URL`, `SENTRY_DSN`. **No Resend, no Paddle, no Razorpay** — which is
exactly why items 6 and 8 are dark.

### 4. Live dogfood smoke — founder's hands, two real Gmail accounts

Agents cannot complete a real OAuth grant. Everything else in this list they
can drive, but this one is yours. Walk it on `app.declutrmail.com`:

1. Connect the primary Gmail → finish onboarding → first Archive and
   Unsubscribe, each with preview + undo (D226).
2. Connect the second mailbox → switch → confirm the scoped cache resets and
   no stale senders survive the switch.
3. Disconnect the last mailbox → confirm `/settings` and `/billing` still open
   (the 409-storm class from CLAUDE.md §8).
4. At 375px: topbar switcher, Senders, Triage all usable.

**Verify:** clean console; sync status stops polling; undo fires exactly once.

---

## Phase 1 — Before inviting more people

### 5. Consent → PostHog (verify; the key is already live)

The ordering advice in the old checklist is moot — the key has been in Vercel
Production for 34 days. Analytics is already flowing for anyone who clicked
"Accept all". What matters is proving the gate holds.

**Steps 1–2 were verified live on prod, 2026-07-09** (Chrome, clean origin
state): the banner renders, `localStorage` holds no consent key,
`window.posthog` is `undefined`, and a full page load issues **zero requests to
any `posthog.com` host**. The gate is fail-closed and it works.

Remaining, both founder-observable in a minute:

3. Accept → PostHog requests are then permitted.
4. Withdraw consent in `/settings` → capture stops **without a reload**.

Step 4 is the one no test covers end to end. `withdrawAnalyticsConsent()` grabs
the SDK handle _before_ flipping the stored choice, precisely so `reset()` still
reaches a loaded SDK — worth confirming live.

**One observation, not a blocker.** Sentry POSTs three envelopes on a clean,
pre-consent page load. This does **not** contradict shipped copy: `/cookies`
scopes the consent promise to _"optional PostHog analytics"_, and Sentry is
disclosed as a subprocessor on `/privacy`. But those envelopes carry
performance traces for an unauthenticated visitor, which is a broader read of
"essential" than error capture alone. Worth a deliberate decision before you
invite users, rather than discovering it in a privacy complaint.

### 6. Resend is dark in production

This is not "confirm the key is still there." Transactional email **does not
send today**, by design: `EmailService` fails closed when the key is unset, and
the key is bound nowhere on Cloud Run.

It is **two** secrets, not one, and they go to **different services**. Binding
either one in the wrong place either leaves email broken or hands a credential
to a service that never uses it.

| Secret                  | Service         | Why                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`        | **worker only** | The worker is the sender. `EmailService` sits behind the worker's `EmailDeliveryPort`; its only callers are `apps/api/src/worker.ts` and `packages/workers/src/email-send.worker.ts`. The API constructs it (for `EmailPrefsController` + the suppression list) but **no API request path calls `.send()`** — so the public, internet-facing service must not hold a live mail-sending credential. |
| `RESEND_WEBHOOK_SECRET` | **api only**    | Verifies inbound Resend webhook signatures in `apps/api/src/webhooks/resend/`. The worker serves no HTTP.                                                                                                                                                                                                                                                                                          |

> ⚠️ **This split is enforced in the deploy workflow, not in IAM.** Both Cloud
> Run services currently run as the same service account
> (`declutrmail-api@…`), so the public API _can_ read the sending key even
> though nothing binds it there. Giving the worker its own service account is
> what turns this from a convention into a boundary. Tracked in
> `FOUNDER-FOLLOWUPS.md`.

✅ **DNS is done** — `send.declutrmail.com` has DKIM, SPF, and the bounce MX
(`./scripts/launch-preflight.sh mail` is green). Confirm the domain now shows
**Verified** in Resend → Domains.

Three steps remain, in this order:

0. **Create the webhook endpoint in Resend.** `RESEND_WEBHOOK_SECRET` is the
   _signing secret of a specific endpoint_ — it does not exist until you create
   one. There is nothing to copy today.

   Resend → **Webhooks** → Add endpoint:

   | Field        | Value                                             |
   | ------------ | ------------------------------------------------- |
   | Endpoint URL | `https://api.declutrmail.com/api/webhooks/resend` |
   | Events       | `email.bounced`, `email.complained`               |

   Those two are the only events that change state: the controller maps them to
   `SuppressionReason` `bounce` / `complaint` and adds the recipient to the
   suppression list, which is consulted before every send. Any other event type
   is ACKed with 200 and ignored — subscribing to more is harmless but pointless.

   Auth is a **svix-style Standard Webhooks signature** (`svix-id`,
   `svix-timestamp`, `svix-signature`). A bad or missing signature returns 401
   and raises a `webhook.signature_failure` security event (D181).

   Then copy the endpoint's **Signing Secret** (`whsec_…`) — that is the value
   for step 1.

   The route is already live and correctly refuses to serve while the secret is
   unset:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.declutrmail.com/api/webhooks/resend
   # 503 today (module gated on RESEND_WEBHOOK_SECRET) → 401 once bound and sent an unsigned POST
   ```

1. **Secret Manager** (founder — `gh` will not disclose an Actions secret's value):

   ```bash
   for s in resend-api-key-prod resend-webhook-secret-prod; do
     gcloud secrets create "$s" --project=declutrmail-ai-prod --replication-policy=automatic
   done
   printf '%s' 're_YOUR_SENDING_KEY'        | gcloud secrets versions add resend-api-key-prod       --project=declutrmail-ai-prod --data-file=-
   printf '%s' 'whsec_YOUR_WEBHOOK_SECRET'  | gcloud secrets versions add resend-webhook-secret-prod --project=declutrmail-ai-prod --data-file=-
   ```

   Use `printf`, not `echo` — `echo` appends a newline and Resend rejects the key.
   Use the **sending-access** key (`declutrmail-prod-sending`), never a full-access one.

2. **PR to `deploy-cloud-run.yml`** — add `RESEND_API_KEY=resend-api-key-prod:latest`
   to the **worker's** `--update-secrets`, and `RESEND_WEBHOOK_SECRET=resend-webhook-secret-prod:latest`
   to the **API's**. A referenced-but-missing secret fails the whole deploy, so (1)
   must land before (2).

**Never bind these with `gcloud run services update`.** `--set-env-vars` in the
workflow is a FULL REPLACE, so a live-set binding survives until the next routine
deploy and then vanishes. The binding must live in the workflow or it is a
countdown, not a fix. The `secrets` preflight group fails on exactly this.

**Verify** — three separate proofs, because sending and receiving are
independent paths and each can be broken alone:

1. `./scripts/launch-preflight.sh secrets api` → green. The Resend route flips
   from `503` to `401` on an unsigned POST, which proves the module mounted and
   svix verification is enforcing.
2. **Outbound:** trigger a sync-complete email. The worker logs
   `resendConfigured: true` and the message arrives.
3. **Inbound:** send to Resend's bounce simulator (`bounced@resend.dev`). Expect
   a `resend.webhook.processed type=email.bounced` log line and the recipient on
   the suppression list. If nothing arrives, the endpoint URL or its events are
   wrong — outbound will look perfectly healthy regardless.

---

## Phase 2 — Sync freshness

### 7. Pub/Sub push — config is fully verified; delivery is not

**Everything checkable is green** (`./scripts/launch-preflight.sh api pubsub`,
2026-07-09):

- Unauthenticated `POST /api/webhooks/gmail/pubsub` → **401**. OIDC is enforcing (D229).
- `PUBSUB_WEBHOOK_ENABLED=true` on the live revision.
- `gmail-push-sub` → `pushEndpoint: https://api.declutrmail.com/api/webhooks/gmail/pubsub`
- OIDC audience `https://api.declutrmail.com`, SA `gmail-webhook-oidc@declutrmail-ai-prod.iam.gserviceaccount.com`

The only thing left is proof that a **real message flows**, and that needs a
real connected mailbox. Connect one, confirm `users.watch` is registered for
it, mail yourself from a known sender, and expect a webhook success log within
minutes — not a `signature_failure`, and not a 5–15 minute incremental poll
(that means `watch` never published).

---

## Phase 3 — Before charging

### 8. Billing

`BILLING_ENABLED=false` and `PADDLE_ENV=sandbox` in `deploy-cloud-run.yml`.
`PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `RAZORPAY_KEY_ID`, and
`RAZORPAY_KEY_SECRET` exist as GH Actions secrets but — same trap as Resend —
are **not bound to Cloud Run**.

Provision the catalog IDs, create the Secret Manager secrets, add the
`--update-secrets` bindings, flip `BILLING_ENABLED=true`, redeploy. Then buy
Plus yourself, cancel, and walk the refund path. See
`docs/runbooks/billing-guardrails.md` and `docs/runbooks/secrets-inventory.md`.

**Verify:** `/billing` stops saying "isn't live yet"; the post-free-cap upgrade
modal matches `/pricing`.

### 9. Account deletion execution — CLAUDE.md §9 stop-condition

Purge against production data needs your **explicit written approval** before an
agent writes the code. Say so plainly ("Approved to finish account deletion
execution + cron") and an agent may proceed; absent that, it must stop.

After it ships: schedule a delete on a throwaway account, cancel within grace,
then let a second one expire and confirm both the purge and the notification
emails. Deletion respects `max(now+7d, latest_undo_expires_at)` per D232 — item
6 must be green first, or the notification emails silently never send.

---

## Phase 4 — Ops (not blocking first dogfood)

| Action                          | Where                                   | Verify                                         |
| ------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Sentry alert rules              | Sentry → Alerts                         | Force a test error; the page fires             |
| Source maps resolve on prod FE  | A Sentry issue's stack                  | Real `apps/web/src/…` paths, not chunk hashes  |
| Vendor spend caps               | Vercel / PostHog / Sentry / GCP budgets | Caps visible                                   |
| Mirror secrets into 1Password   | `docs/runbooks/secrets-inventory.md`    | Every row mirrored, `Rotated` filled           |
| Drain stale Upstash BullMQ jobs | `redis-cli` on prod Redis               | No phantom `worker.failed` for local dev UUIDs |
| Add a real `/api/health` route  | `apps/api`                              | Uptime monitors stop 404ing                    |

---

## Known footguns

- **`RATE_LIMIT_ENABLED=false` is set in prod and is a no-op.** The limiter
  ignores it when `NODE_ENV=production`. But the same flag is also the
  documented escape hatch for the "refuse to boot without `REDIS_URL`" guard —
  so if `REDIS_URL` were ever dropped, prod would boot **silently unlimited**
  instead of crashing. Remove the flag from `deploy-cloud-run.yml` for both
  services; nothing reads it in prod.
- **`--set-env-vars` is a full replace.** Any var not in the workflow is wiped
  on deploy. Use `--update-env-vars` for live merge-sets, and never hand-edit.
- **`NEXT_PUBLIC_*` is baked at build time.** Changing it in Vercel without a
  redeploy changes nothing.
- **A GH Actions secret is not a Cloud Run secret.** `RESEND_API_KEY`,
  `PADDLE_API_KEY`, `RAZORPAY_*` are all in the first bucket and none in the
  second. This is the single most repeated mistake in this repo's launch prep.

---

## Suggested order

1. `gcloud auth login` — unblocks the agents (Step −1)
2. One Cloud DNS transaction: apex + www + apex MX/SPF/DMARC + `send.` SPF/MX (items 1, 2, 6.1)
3. Attach apex to Vercel; decide the canonical origin (item 3)
4. Founder dogfood over real OAuth (item 4)
5. Resend Secret Manager + deploy PR (items 6.2, 6.3)
6. Consent verification via Chrome MCP; Pub/Sub delivery proof (items 5, 7)
7. Billing when you want money (item 8)
8. Deletion approval when you want purge jobs (item 9)
