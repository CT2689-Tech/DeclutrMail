# Checkout funnel gap — 2026-09-21

Investigation of PostHog `upgrade_prompt_shown` → `checkout_started` drop-off
and empty `pending_checkouts` with no completed payments. Billing rails are
Paddle and Razorpay (not Stripe). Do not treat this file as live product
behavior after a later billing change; it is the evidence from this date.

## Verdict

Not a broken completion path. The 71% prompt → Confirm drop is users
leaving the prompt. Empty `pending_checkouts` on 2026-09-21 does not prove
the write never happened. Current PostHog instrumentation could not tell
API failure from overlay abandonment from a missed webhook.

## Evidence checked 2026-09-21

PostHog (all-time, `filterTestAccounts` off):

| Event                  | Events | People  | Last seen        |
| ---------------------- | ------ | ------- | ---------------- |
| `upgrade_prompt_shown` | 51     | several | 2026-08-27       |
| `checkout_started`     | 5      | 4       | 2026-08-15       |
| `billing_event`        | 0      | 0       | never in PostHog |
| `plan_change_started`  | 2      | 1       | 2026-07-31       |

The five `checkout_started` rows:

| When       | Distinct id  | Payload                                                       |
| ---------- | ------------ | ------------------------------------------------------------- |
| 2026-06-12 | `019e9e5f-…` | pro / annual / paddle / founding_pro                          |
| 2026-07-31 | `053af393-…` | plus / monthly / paddle, then razorpay 4 min later            |
| 2026-08-12 | `570f8399-…` | plus / monthly / paddle (preceded by `pricing_plan_selected`) |
| 2026-08-15 | `9d251cf3-…` | plus / annual / paddle                                        |

Sentry org `chintan-ashok-thakkar` (90d): no billing/checkout/paddle/razorpay
errors; no `billing.checkout_created` / `billing.checkout.create_failed` /
`billing_event` logs. That is absence of Sentry coverage, not proof the API
never ran — Cloud Run is the log sink for those lines.

No `$exception` events exist in this PostHog project at all.

## Why empty `pending_checkouts` is not the smoking gun

`BillingService.createCheckout` upserts `pending_checkouts` **before** the
provider call (`apps/api/src/billing/billing.service.ts`). Display TTL is
30 minutes; the reconciler deletes rows expired more than 7 days
(`billing-reconciliation.sweep.ts`). Last `checkout_started` was 2026-08-15.
By 2026-09-21 those rows would be gone even if every POST succeeded.

`checkout_started` also fires **before** the POST (intent). A click that
then 503s `BILLING_DISABLED` / `BILLING_NOT_PROVISIONED` still counts as
started and never writes a row.

## What the code actually does

```
Confirm click
  → track checkout_started          // intent, FE
  → POST /api/billing/checkout      // 503 if BILLING_ENABLED ≠ true
      → insert pending_checkouts    // 30 min horizon
      → Paddle: overlay payload (no provider API)
      → Razorpay: POST /v1/subscriptions (notes.workspace_id)
  → launchCheckout
      → Paddle.js overlay / Razorpay Checkout.js
      → onCompleted starts FE poll; grant is webhook-only
POST /api/webhooks/billing/paddle   HMAC ts+h1, 5s skew
POST /api/webhooks/billing/razorpay HMAC + x-razorpay-event-id
  → BillingWebhookService.process
  → delete pending_checkouts on grant
  → structured log `billing_event kind=…` (not PostHog)
```

Unit tests already pin: claim before provider, CHECKOUT_IN_FLIGHT,
expired reclaim, provider failure keeps the claim, Paddle customData
round-trip, Razorpay notes attribution, webhook signature fail-closed.

## What was actually broken (instrumentation)

1. `checkout_started` = Confirm click, not session created.
2. `billing_event` is a Nest log line. Server-side PostHog is banned
   (consent in the browser). A PostHog funnel to `billing_event` is
   structurally empty.
3. Overlay completed / closed / blocked had no events, so abandonment
   vs overlay-never-opened vs paid-but-webhook-missed were
   indistinguishable.
4. Taxonomy still named Stripe on `billing_event`.

This PR adds client events only: `checkout_session_created`,
`checkout_failed`, `checkout_overlay_completed`,
`checkout_overlay_closed`, `checkout_overlay_blocked`. No billing
rewrite.

## How to read the funnel after this ships

| Pattern                                                                   | Meaning                         |
| ------------------------------------------------------------------------- | ------------------------------- |
| `upgrade_prompt_shown` without `checkout_started`                         | left the prompt                 |
| `checkout_started` without `checkout_session_created` + `checkout_failed` | POST refused/failed; no row     |
| `checkout_session_created` + `checkout_overlay_closed`                    | overlay abandonment (usual)     |
| `checkout_session_created` + `checkout_overlay_blocked`                   | script/CSP/CDN                  |
| `checkout_overlay_completed` without a `subscriptions` row                | overlay paid, webhook/grant gap |
| `subscriptions` row                                                       | grant landed                    |

## Test plan (not run live — no founder card in this session)

**Paddle**

1. Dev login → `/billing` → Plus monthly → Confirm.
2. Expect `checkout_started` then `checkout_session_created`; a
   `pending_checkouts` row for the workspace; overlay opens.
3. Dismiss overlay → `checkout_overlay_closed`; row remains until TTL
   or "I checked — no charge".
4. Complete sandbox overlay → `checkout_overlay_completed`; poll until
   `GET /billing/subscription` shows Plus; row gone; Cloud Run log
   `billing_event kind=subscription_created provider=paddle`.
5. Repeat Confirm with `BILLING_ENABLED` off (or unprovisioned price)
   → `checkout_failed` with that code; no row; no overlay.

**Razorpay**

1. Same as Paddle with the India rail selected on a provisioned price.
2. Confirm writes the row **and** creates a Razorpay subscription
   (`provider_ref` stashed). Overlay uses Checkout.js; script failure
   emits `checkout_overlay_blocked` and keeps the claim (emailed link
   may still be payable).
3. Paid overlay → `checkout_overlay_completed`; webhook
   `POST /api/webhooks/billing/razorpay` grants; row deleted.

**Negative controls already in unit tests:** claim-before-provider,
CHECKOUT_IN_FLIGHT, provider failure keeps claim, pre-claim 503 emits
`checkout_failed` without `checkout_session_created`.
