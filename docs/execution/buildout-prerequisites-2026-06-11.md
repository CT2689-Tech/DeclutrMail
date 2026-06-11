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
| Sentry org + alert rules                                             | `SENTRY_ORG` set in Vercel + alert rules configured                                                         |
| Payment sandbox/test keys stored                                     | `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (GH secrets)              |
| Tier structure + pricing                                             | D19 confirmed 2026-06-11 — see Tiers section                                                                |

## Tiers — LOCKED (D19, confirmed 2026-06-11)

5-tier ladder, capability buckets (see → clean → automate). **3 purchasable
at launch**; Team + Enterprise are non-purchasable pricing-page rows (zero build).

| Tier           | Price            | Inboxes | Unlocks                                                                  |
| -------------- | ---------------- | ------- | ------------------------------------------------------------------------ |
| **Free**       | $0               | 1       | Senders + Detail + Activity (read-only) + **5 lifetime cleanup actions** |
| **Plus**       | $9/mo · $90/yr   | 1       | + Triage + unlimited manual Archive/Mute/Unsubscribe                     |
| **Pro**        | $19/mo · $190/yr | 2       | + Autopilot, Brief, Screener, Quiet, Snoozed, Followups; 30-day undo     |
| **Team**       | "Coming Q3 2026" | —       | Waitlist row only                                                        |
| **Enterprise** | Contact Sales    | —       | Contact form only                                                        |

Launch promo: **Founding Pro $129/yr**, first 250 paying users.

**Build directive:** a single configurable **tier manifest** in `packages/shared`
— `{ id, name, prices:{monthly,annual}, paddlePriceId, razorpayPlanId, inboxLimit,
capabilities:[] }`. Prices + provider price-IDs live in the manifest so re-pricing
is a one-value edit, not a code change. Capability gating reads the manifest.
Agents create the Paddle products + Razorpay plans via API (keys stored) and emit
the price-IDs back into the manifest.

## REMAINING (founder)

### Review / sign-off

1. **Legal accuracy for V2** — rebuilt on `.com` by agents; founder confirms privacy copy matches the no-body-storage posture (D7/D228) + adds a **refund policy** (Paddle/Razorpay require it).

### Comes mid-build (not now)

2. **Paddle + Razorpay webhook secrets** — generated when the webhook destination is created against the API endpoint (agents build the endpoint first). → `PADDLE_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

### At go-live (not now)

3. **Rotate all keys to live** — Resend full key, Paddle live keys, Razorpay live keys (test/sandbox values in secrets today). Add `.com` site to both providers.

## `.ai` → `.com` cutover (after V2 live)

- OAuth consent screen privacy/terms URLs `.ai` → `.com` (domain already authorized)
- Add `.com` site to Paddle (checkout domain) + Razorpay (Add website/app)
- Retire `declutrmail.ai`

## Critical path

KYC long-poles (Paddle + Razorpay) are **cleared** → no multi-week blockers remain. Everything left is hours (Sentry, Resend rotate, hand over sandbox keys) or rides the agent buildout (legal rebuild, billing integration).
