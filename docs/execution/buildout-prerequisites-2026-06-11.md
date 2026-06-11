# Buildout prerequisites — founder-side ledger (2026-06-11)

> Durable record of every founder-owned prerequisite before the parallel
> feature buildout. Next-session orchestration reads this first. Pairs with
> `launch-gap-audit-2026-06-09.md` (the feature gap map — stale on Waves 1-2,
> rebuild before fan-out).

## Decisions locked (2026-06-11)

- **Billing IS in beta** (not free-only) — build via workflows; plan-drift sign-off given.
- **Payment providers: Paddle (global, merchant-of-record) + Razorpay (India).**
- **Account deletion build approved** (§9) — semantics: **7-day grace window + immediate-delete option** (D232: purge at `max(now+7d, latest_undo_expires_at)`).
- **Transactional email: Resend**, From = `DeclutrMail <hello@send.declutrmail.com>`.
- **V2 rebuilds entirely on `declutrmail.com`**; retire `declutrmail.ai` once V2 is live → all public pages (landing, legal, app) are rebuilt on `.com`.

## DONE ✅

| Prerequisite                                                         | Evidence                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Domain + DNS (registrar Squarespace, DNS = legacy Google Domains NS) | app→Vercel, api→Cloud Run resolve                                                                           |
| Prod API env (OAuth redirect, CORS, cookie)                          | rev 00032+, persisted in deploy-cloud-run.yml                                                               |
| Gmail Pub/Sub webhook enabled + OIDC                                 | rev 00033, 401 on no-auth (route mounted)                                                                   |
| OAuth verification + branding + CASA Tier 2                          | consent screen "verified"; domains `declutrmail.com` + `.ai` authorized                                     |
| Legal pages (current)                                                | live at declutrmail.ai/legal/{privacy,terms} (rebuild on .com pending)                                      |
| Resend email infra                                                   | `send.declutrmail.com` verified; sending key = `RESEND_API_KEY` secret; test email delivered                |
| Paddle KYC                                                           | **Verification passed** (Seller ID 279232)                                                                  |
| Razorpay KYC                                                         | website approved; live key exists                                                                           |
| Vendor billing caps                                                  | Vercel Spend Mgmt ($40 + pause), Upstash PAYG $20, PostHog free, GCP budget+alerts, Sentry spike protection |
| Daily vendor-limits watchdog                                         | green (6 vendors); Anthropic dropped (Teams-only)                                                           |

## REMAINING (founder)

### Quick (this week)

1. **Sentry** — set `SENTRY_ORG=chintan-ashok-thakkar` (+ confirm `SENTRY_PROJECT=declutrmail-web`) in Vercel prod env → redeploy (empty now → source-map upload fails). Add 2 alert rules: new-issue + error-rate-spike.
2. **Resend** — rotate the full-access key exposed in chat (`re_MEW…`); sending-only prod key is separate, nothing breaks.

### Payment integration keys (sandbox/test first — NEVER hand live keys until go-live)

3. **Paddle (Sandbox):** API key + client-side token (Developer Tools → Authentication) + webhook signing secret. → `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`.
4. **Razorpay (Test Mode):** test key id + secret + webhook secret. → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
5. **Tier prices** (Plus/Pro per D17-21/D77/D81) — product decision; needed to build the Paddle/Razorpay catalogs.

### Review / sign-off

6. **Legal accuracy for V2** — rebuilt on `.com` by agents; founder confirms privacy copy matches the no-body-storage posture (D7/D228) + adds a **refund policy** (Paddle/Razorpay require it).

## `.ai` → `.com` cutover (after V2 live)

- OAuth consent screen privacy/terms URLs `.ai` → `.com` (domain already authorized)
- Add `.com` site to Paddle (checkout domain) + Razorpay (Add website/app)
- Retire `declutrmail.ai`

## Critical path

KYC long-poles (Paddle + Razorpay) are **cleared** → no multi-week blockers remain. Everything left is hours (Sentry, Resend rotate, hand over sandbox keys) or rides the agent buildout (legal rebuild, billing integration).
