# Billing go-live runbook — how a user upgrades, and how to turn it on

**Written 2026-07-17.** Founder asked: _"Connected an account. Initial is FREE.
How does one upgrade? Go through the entire billing flow end-to-end and make it
production-ready; doc any manual steps."_

**The short answer.** Today **no one can upgrade** — not because the flow is
missing, but because it ships **dark on purpose**. The entire billing stack
(checkout → provider payment → webhook → tier flip) is built, tested, and
verified 503-ing behind three independent kill switches. Making it live is
**not a code task** — it is an operational sequence only you can run: create the
merchant accounts, provision the product catalog, bind the secrets, flip one
flag. This doc is that sequence, in order, with the exact names.

This is a **CLAUDE.md §9 stop-condition** area (billing provider webhooks +
secrets + prod config). An agent will not create accounts, hold provider keys,
or flip prod billing on your behalf. It can fix code (it just did — see
[PR #351](https://github.com/CT2689-Tech/DeclutrMail/pull/351)) and hand you
this.

Companion docs (do not duplicate — this one is the ordered driver):

- `docs/execution/founder-launch-checklist.md` §8 (the short version)
- `docs/runbooks/billing-guardrails.md` (spend/watchdog posture)
- `docs/runbooks/secrets-inventory.md` (secret registry — mirror as you go)

---

## 0. Why it's dark: the three kill switches

All three must be satisfied before a real upgrade can happen. This is
defense-in-depth — flipping any **one** alone cannot expose a broken checkout.

| #   | Switch                          | Where                                                                             | State today        | Effect while unmet                                     |
| --- | ------------------------------- | --------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| 1   | `BILLING_ENABLED` unset/≠`true` | Cloud Run env (`deploy-cloud-run.yml`)                                            | `false`            | every `/api/billing/*` → **503 `BILLING_DISABLED`**    |
| 2   | Webhook secrets unset           | `PADDLE_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`                                | unset on Cloud Run | webhooks → **503 fail-closed** (no tier can ever flip) |
| 3   | Catalog price IDs `null`        | `packages/shared/src/entitlements/manifest.ts` (`paddlePriceId`/`razorpayPlanId`) | all `null`         | checkout → **503 `BILLING_NOT_PROVISIONED`**           |

Verified live 2026-07-17 (dev API): `GET /api/billing/subscription` and
`POST /api/billing/checkout` both return `503 BILLING_DISABLED`.

**Provider choice, for the record:** DeclutrMail uses **Paddle** (merchant of
record — handles international sales tax/VAT) for the international ladder and
**Razorpay** for India (D117). **There is no Stripe and never will be** — do not
add it; the code comments and entitlements types rule it out explicitly.

---

## 1. The upgrade flow, end-to-end (what "on" looks like)

Once the switches are satisfied, this is exactly what a Free user does:

1. Hits a gate — the Free 5-lifetime-cleanup cap, or any Pro-only surface
   (Screener/Autopilot/Brief) — or clicks **Get Plus/Get Pro** on `/pricing`.
2. Lands on `/billing`; the "isn't live yet" notice is gone. The inline plan
   picker shows Free/Plus/Pro under one monthly/annual toggle. Selecting a plan
   opens its confirmation panel in place (provider choice and Founding-Pro claim
   appear only for a new checkout).
3. **`POST /api/billing/checkout`** creates a provider session — **Paddle** opens
   an in-page overlay; **Razorpay** navigates to a hosted subscription page.
   The workspace id rides in `customData`/`notes` for webhook attribution.
4. User pays on the provider surface.
5. The provider fires a **webhook** → `POST /api/webhooks/billing/{paddle,razorpay}`
   → HMAC-verified → `recomputeWorkspaceTier` flips `workspaces.tier`.
   **Checkout never grants tier — only the webhook does** (§10 no-fake-completion).
6. `/billing` enters a truthful processing state and polls the subscription
   read. It keeps checkout locked until the webhook reports the exact tier/cycle,
   then updates the plan card without a reload. At 90 seconds the copy changes to
   "taking longer than usual"; at 15 minutes it keeps the lock and requires an
   explicit no-charge confirmation before checkout can be retried.

Paid plan changes use the existing payment method. Upgrades apply after Paddle
confirms the immediate prorated charge. Pro→Plus and annual→monthly downgrades
show `$0 today`, retain the current entitlement through the paid period, and are
stored as a durable scheduled change. Resume is a two-step confirmation and asks
Paddle to continue the retained billing period without starting a new charge.
Razorpay plan change/resume stays support-assisted until its payment-method-specific
semantics are verified.

---

## 2. Phase A — Merchant accounts (lead time; start first)

Both require **business verification** and can take days. Nothing else here
works until these are approved.

1. **Paddle** (`paddle.com`) — create a seller account, complete verification
   (business/identity/payout/tax). Start in **Sandbox** (`sandbox-vendors.paddle.com`)
   — it needs no verification and unblocks every step below except the final
   production cutover.
2. **Razorpay** (`razorpay.com`) — create an account, complete KYC, and
   **enable the Subscriptions product** (it is not on by default). Test mode
   (`rzp_test_…` keys) works immediately; live mode needs KYC approval.

**Decision:** you can launch **international-only** with Paddle alone and add
Razorpay later. If so, tell an agent — the FE provider radio and the checkout
contract should hide Razorpay so no one selects a dead provider.

---

## 3. Phase B — Provider API keys & tokens

Collect these (sandbox/test first). Keep them **off your laptop** — they go
straight into GitHub Actions secrets (§4).

| Value                                     | Provider console location                                      | Used for                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PADDLE_API_KEY`                          | Paddle → Developer Tools → Authentication → API keys           | server-side checkout + catalog provisioning                                                                                                  |
| `PADDLE_CLIENT_TOKEN`                     | Paddle → Developer Tools → Authentication → Client-side tokens | the browser overlay — a Cloud Run **secret**, delivered to the FE inside each checkout session response (not a build-time `NEXT_PUBLIC` var) |
| `PADDLE_WEBHOOK_SECRET`                   | created in §5 when you add the notification destination        | webhook HMAC verification                                                                                                                    |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay → Settings → API Keys                                 | server-side subscription create + checkout                                                                                                   |
| `RAZORPAY_WEBHOOK_SECRET`                 | created in §5 when you add the webhook                         | webhook HMAC verification                                                                                                                    |

`PADDLE_ENV` is `sandbox` or `production` (an env var, not a secret). Razorpay
test-vs-live follows the key prefix itself (`rzp_test_` / `rzp_live_`).

---

## 4. Phase C — Store keys as GitHub **Environment** secrets

The provisioning workflow selects its secrets from a **GitHub Environment**
named by the `paddle_env` input (`job.environment: ${{ inputs.paddle_env }}`),
so sandbox and production hold SEPARATE copies of the SAME secret names — no
swapping a shared slot between runs.

**GitHub → repo → Settings → Environments** → create `sandbox` and
`production`, and in EACH define:

- `PADDLE_API_KEY` — sandbox `pdl_sdbx_apikey_…` vs live `pdl_live_apikey_…`
- `RAZORPAY_KEY_ID` — `rzp_test_…` vs `rzp_live_…`
- `RAZORPAY_KEY_SECRET`

Define all three in **both** environments: an environment that omits a secret
silently falls back to the repo-level secret of the same name, so a fully
defined pair of environments means the provisioning job never touches the
repo-level copies. Add **required reviewers** to `production` so a live
provisioning run needs an approval click.

> **Do NOT delete the repo-level `PADDLE_API_KEY` / `RAZORPAY_KEY_ID` /
> `RAZORPAY_KEY_SECRET`.** The daily **vendor-limits watchdog** (D156,
> `vendor-limits-watchdog.yml`) reads them for billing webhook-delivery health
> checks. It runs on a schedule, so it cannot live on the reviewer-gated
> `production` environment (a required-reviewer gate would hang every cron
> run) — it stays on repo-level secrets. Those repo-level values should hold
> the **production** keys once live, with the repo **variable** `PADDLE_ENV`
> set to `production`; absent keys make the watchdog silently report
> UNCONFIGURED, not fail. So: repo-level = production (watchdog); the two
> environments = provisioning inputs.

> `PADDLE_CLIENT_TOKEN` / `PADDLE_WEBHOOK_SECRET` / `RAZORPAY_WEBHOOK_SECRET`
> are NOT provisioning inputs — they are runtime-only (§5–7) and live in GCP
> Secret Manager, not here.

> **The single most-repeated mistake in this repo:** _a GitHub Actions secret is
> not a Cloud Run secret._ Keys here let the **provisioning workflow** run; they
> do **not** reach the running API/worker. Runtime binding happens in §5.

---

## 5. Phase D — Provision the catalog (founder step "F3")

The product/price objects live in the providers, not in code. Create them with
the idempotent workflow (never from a laptop — it uses the live keys):

1. **GitHub → Actions → "Provision billing catalog" → Run workflow** →
   `paddle_env: sandbox`. (File: `.github/workflows/provision-billing-catalog.yml`;
   script: `apps/api/scripts/provision-billing-catalog.ts`.)
2. It creates the D19 ladder — `plus_monthly`, `plus_annual`, `pro_monthly`,
   `pro_annual`, `pro_annual_founding` — matched by SKU (Paddle
   `custom_data.sku` / Razorpay `notes.sku`), so re-runs are safe and re-print
   the ids.
3. The **job summary** prints two copy-paste blocks:
   - a **manifest patch** — paste the resolved ids into
     `packages/shared/src/entitlements/manifest.ts` (`paddlePriceId` /
     `razorpayPlanId`, currently all `null`) and open a normal PR. _(This
     satisfies kill switch #3 for production.)_
   - a **`BILLING_CATALOG_JSON`** overlay — for sandbox/staging you can set this
     env var instead of patching the manifest (the runtime catalog reads it as
     an overlay; malformed JSON fails loudly at boot by design).

**Prices are fixed in the manifest** (do not change in the provider UI):
Plus **$9/mo · $90/yr**, Pro **$19/mo · $190/yr**, **Founding Pro $129/yr**
(first **250** redemptions only, enforced server-side with an advisory lock).

---

## 6. Phase E — Register webhooks & capture the signing secrets

The tier only ever flips from a verified webhook. Register both endpoints in the
provider consoles, subscribe to the exact events, and copy each signing secret
into the GH secret from §3–4.

**Paddle** → Developer Tools → **Notifications** → add a destination:

- URL: `https://<prod-api-host>/api/webhooks/billing/paddle`
- Copy the **signing secret** → `PADDLE_WEBHOOK_SECRET`.
- Subscribe to: `subscription.created`, `subscription.activated`,
  `subscription.updated`, `subscription.canceled`, `subscription.paused`,
  `subscription.resumed`, `subscription.past_due`, `transaction.completed`,
  `transaction.payment_failed`, `adjustment.created` (refund/chargeback).

**Razorpay** → Settings → **Webhooks** → add:

- URL: `https://<prod-api-host>/api/webhooks/billing/razorpay`
- Set a **secret** → `RAZORPAY_WEBHOOK_SECRET`.
- Subscribe to: `subscription.activated`, `subscription.charged`,
  `subscription.updated`, `subscription.pending`, `subscription.halted`,
  `subscription.cancelled`, `subscription.completed`, `subscription.paused`,
  `subscription.resumed`.

Verification is fail-closed: a missing secret → 503; a bad signature → 401 with
a security-audit row written first. Paddle also enforces a ≤5s timestamp skew.

---

## 7. Phase F — Bind secrets to Cloud Run & flip the flag

This is where the "GH secret ≠ Cloud Run secret" trap is paid off. For **each**
runtime secret (`PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`):

1. Create it in **GCP Secret Manager**.
2. Add an `--update-secrets` binding in `deploy-cloud-run.yml` for the **API
   service only** (see `secrets-inventory.md` for the pattern). Checkout and
   webhook verification both live in the API; the worker reads no billing
   credentials and must not receive them.
3. Set env `PADDLE_ENV=sandbox` (then `production` at cutover) and
   `BILLING_ENABLED=true` in the deploy workflow.
4. Redeploy.

> **`--set-env-vars` is a full replace** — any var not listed is wiped. Use
> `--update-env-vars` / `--update-secrets` for live merge-sets; never hand-edit.
> All billing values are **server-side** (the Paddle client token reaches the
> browser through the checkout-session response, not a `NEXT_PUBLIC` build-time
> var), so **no FE or worker rebuild is needed** for a billing key change —
> only an API redeploy.

---

## 8. Phase G — Verify (your hands — the only real end-to-end proof)

No agent can run this: it needs a real payment surface. In **sandbox**:

1. `/billing` no longer says "isn't live yet"; the inline plan CTAs appear.
2. Buy **Plus** (Paddle sandbox card) → watch the webhook land
   (`billing-webhook.service` log line) → **`workspaces.tier` flips to `plus`**
   → the processing notice clears and the plan card updates **without reload**.
3. The post-free-cap inline confirmation matches `/pricing` numbers. Block the
   Paddle script once and verify the panel stays open with “Nothing was charged”
   and a working retry.
4. From Plus, upgrade to Pro → confirm the immediate prorated charge and wait for
   the exact Pro webhook flip.
5. From Pro, schedule Plus → confirm `$0 today`, Pro stays active, the durable
   “Downgrade scheduled” notice shows the period-end date, and no rapid polling
   continues. At renewal, confirm Plus becomes active and the schedule clears.
6. Pause a Paddle subscription, then **Review resume** → confirm `$0 today`, the
   retained period date, and no POST before the second confirmation. Resume and
   verify no new transaction/new billing period is created.
7. **Cancel** → `cancel_at_period_end=true`, tier holds until period end.
8. Walk the **refund/chargeback** path (Paddle `adjustment.created`) → maps to
   scheduled cancellation, tier holds until the provider's terminal event.
9. Repeat the core buy on **Razorpay** test mode (India ladder); verify plan
   changes and no-charge resume route to support rather than guessing provider
   behavior.

Then repeat #1–#2 for **Pro** and **Founding Pro** ($129/yr, confirm the 250-cap
counter decrements).

---

## 9. Phase H — Sandbox → production cutover

1. Re-run the provisioning workflow with `paddle_env: production`; **re-patch the
   manifest** with the live ids (sandbox and live ids differ) via PR.
2. Swap every GH/Secret-Manager value to **live** keys; rotate the two webhook
   secrets to the **live** destinations' secrets.
3. Set `PADDLE_ENV=production`; keep `BILLING_ENABLED=true`; redeploy the API
   (billing keys are server-side — no FE or worker rebuild required).
4. Confirm the guardrail watchdog (`billing-guardrails.md`) covers the providers
   and mirror every new secret into `secrets-inventory.md` with a rotation date.
5. Do **one** real low-value live purchase and immediately refund it.

---

## Appendix A — Runtime env vars (exact names)

| Var                                       | Kind           | Purpose                                                      |
| ----------------------------------------- | -------------- | ------------------------------------------------------------ |
| `BILLING_ENABLED`                         | env            | master flag; `true` to un-dark `/api/billing/*`              |
| `PADDLE_ENV`                              | env            | `sandbox` \| `production` (Paddle API host)                  |
| `PADDLE_API_KEY`                          | secret         | server-side Paddle calls + provisioning                      |
| `PADDLE_CLIENT_TOKEN`                     | secret         | browser overlay init (server-delivered per checkout session) |
| `PADDLE_WEBHOOK_SECRET`                   | secret         | Paddle webhook HMAC                                          |
| `PADDLE_WEBHOOK_MAX_SKEW_SEC`             | env (optional) | override the ≤5s skew window                                 |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | secret         | server-side Razorpay                                         |
| `RAZORPAY_WEBHOOK_SECRET`                 | secret         | Razorpay webhook HMAC                                        |
| `BILLING_CATALOG_JSON`                    | env (optional) | sandbox price-id overlay in lieu of a manifest patch         |

## Appendix B — Code gaps to confirm/close during sandbox

- **Server-side pending checkout** — the browser lock is workspace-scoped and
  cross-tab, but a second device cannot see it until a provider event creates
  server state. Keep the founder follow-up open until the API owns this signal.
- **503 body message** — `BILLING_DISABLED` returns `"message":"Internal server
error"`. The FE branches on the `code`, so the correct "isn't live yet" copy
  still renders; the generic message is never user-visible. Cosmetic — leave.

## Appendix C — What was fixed in code alongside this doc

[PR #351](https://github.com/CT2689-Tech/DeclutrMail/pull/351) — collapsed the
two divergent `useBillingSubscription` hooks (same cache key, different retry
policy) onto one owner. Settings and `/billing` can no longer disagree about
billing state on a real 5xx. Smoked live on all three consuming surfaces.
