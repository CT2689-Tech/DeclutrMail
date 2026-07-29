# Billing test matrix — what the founder must exercise before real users

> **Why this exists.** Billing is LIVE in production (`BILLING_ENABLED=true`,
> `PADDLE_ENV=production`, real Paddle price ids and real Razorpay plan ids in
> `pricing.config.ts`) and has processed **zero** events. Prod DB on
> 2026-07-29: `subscriptions=0 · subscription_events=0 · billing_customers=0 ·
pending_checkouts=0`. The first person to pay is currently the test case.
>
> Companion to `billing-go-live-runbook-2026-07-17.md` (that one is _how to
> turn it on_; this one is _what to try once it is on_).

---

## 0. Where to run this

**Run groups A–H in Paddle SANDBOX, then do ONE real purchase in production.**

Most of the matrix is failure states — declined cards, dunning, halted
subscriptions, refunds, chargebacks. You cannot stage those on live money, and
several are irreversible. Sandbox costs nothing and uses test cards.

### Sandbox setup (one time)

1. `.env.local` in the repo root:

   ```
   BILLING_ENABLED=true
   PADDLE_ENV=sandbox
   PADDLE_API_KEY=pdl_sdbx_apikey_…
   PADDLE_CLIENT_TOKEN=test_…
   PADDLE_WEBHOOK_SECRET=pdl_ntfset_…
   BILLING_CATALOG_JSON={"paddle":{"plus_monthly":"pri_…","plus_annual":"pri_…","pro_monthly":"pri_…","pro_annual":"pri_…","pro_annual_founding":"pri_…"}}
   DEV_AUTH_ENABLED=true
   DEV_AUTH_EMAIL_PREFIX=chintan
   ```

   `BILLING_CATALOG_JSON` overlays the sandbox price ids **without** editing
   the manifest — the live ids stay untouched.

2. Start the stack:

   ```bash
   ./scripts/dev-up.sh
   ```

   ```bash
   pnpm --filter @declutrmail/web dev
   ```

3. Expose the webhook so Paddle can reach you:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

   Register the printed hostname + `/api/webhooks/paddle` as the sandbox
   notification destination.

   > **Trap:** cloudflared _quick_ tunnels rotate their hostname on every
   > restart. If a purchase stops flipping the tier, re-check the hostname
   > before debugging code:
   >
   > ```bash
   > curl -s 127.0.0.1:20241/quicktunnel
   > ```

4. Sign in without OAuth:
   ```
   http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
   ```

### Reading the result of every step

Three places, always. A step is only passed when all three agree.

```bash
# 1. what the API says
curl -s -b cookies.txt http://localhost:4000/api/billing/subscription | jq
```

```sql
-- 2. what the DB says
SELECT status, tier, cancel_source, entitlement_ends_at, current_period_end
FROM subscriptions ORDER BY updated_at DESC LIMIT 3;
SELECT event_type, arrival_seq, created_at FROM subscription_events
ORDER BY arrival_seq DESC LIMIT 10;
SELECT * FROM pending_checkouts;
SELECT tier FROM workspaces;
```

3. What the **UI** says on `/billing` and on a gated screen (`/autopilot`).

**The whole point is disagreement between these three.** The dominant defect
class in this codebase is a surface asserting something the system does not
know — so a green UI over a `tier=free` row is the bug, not a display glitch.

---

## A. The happy path (do this first)

| #   | Step                                                    | Expect                                                                                  |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A1  | `/pricing` → **Get Plus** while signed out              | Lands on sign-in, then returns to checkout intent                                       |
| A2  | Signed in, `/billing` → pick **Plus monthly** → confirm | Paddle overlay opens; a `pending_checkouts` row appears **before** the overlay          |
| A3  | Pay with the sandbox test card                          | Overlay closes; UI shows "payment received — confirming your plan" and polls            |
| A4  | Wait for the webhook                                    | `subscription_events` gains rows; `subscriptions.status=active`; `workspaces.tier=plus` |
| A5  | Reload `/billing`                                       | Plan card reads Plus; `pending_checkouts` row is **gone**                               |
| A6  | Open a Pro-only screen (`/autopilot`)                   | Still gated — Plus does not include Autopilot                                           |
| A7  | Upgrade Plus → **Pro**                                  | Immediate, provider-prorated; tier flips to `pro`; `/autopilot` now opens               |

**A4 is the load-bearing one.** Checkout never grants tier — only the verified
webhook does. If the tier flips _before_ the webhook lands, that is a bug.

---

## B. Money-safety: the same purchase twice

The client-side money-lock (Web Locks + `attemptId`) and the server-side
`pending_checkouts` claim exist to stop double charges. Try to break both.

| #   | Step                                                                    | Expect                                                                             |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B1  | Open the plan picker in **two browser tabs**, start checkout in both    | Second tab stands down; only one overlay                                           |
| B2  | Start checkout, then in a **second browser/profile** try again          | `CHECKOUT_IN_FLIGHT`                                                               |
| B3  | From B2, click the "I checked — no charge went through" release         | `DELETE /api/billing/checkout/pending` → `{released:true}`; checkout allowed again |
| B4  | Start checkout, close the overlay **without paying**, retry immediately | Claim is _surfaced_, not silently released — 3DS can settle after close            |
| B5  | Start checkout, close the overlay, then let the sweep run               | Claim clears on its own; no orphaned block                                         |
| B6  | Already on Plus, try to buy Plus again                                  | `SUBSCRIPTION_EXISTS`                                                              |
| B7  | Double-click **Confirm** as fast as possible                            | One charge in Paddle. **Verify in the Paddle dashboard, not just the UI**          |

---

## C. Payment failure and dunning

Use Paddle's declining test card.

| #   | Step                                                                  | Expect                                                                   |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C1  | Buy Plus with a card that declines at checkout                        | No subscription row; no tier grant; error is legible, not a raw 5xx      |
| C2  | Active sub, force a **renewal** failure                               | `status=past_due`; **tier still granted** (dunning)                      |
| C3  | Check the grant deadline                                              | `entitlement_ends_at` = period end **+ 14 days**                         |
| C4  | Move the clock past that (SQL: set `entitlement_ends_at` to the past) | Reconciler drops the tier; `/autopilot` re-gates. **Restore afterwards** |
| C5  | Recover the card mid-dunning                                          | `status=active`; `entitlement_ends_at` clears                            |

> **C2/C3 are the founder decision from 2026-07-28** — 14 days for _genuine
> retry_ states only. **D6** is the paired half: a terminal state must drop
> immediately and never get the window.

---

## D. Razorpay / India (this rail behaves differently — do not skip)

| #   | Step                                    | Expect                                                                                                                                                             |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Visit `/pricing` as an India visitor    | Prices in **₹** (₹749 Plus/mo, ₹1,599 Pro/mo)                                                                                                                      |
| D2  | Check the JSON-LD on `/pricing`         | INR offers present alongside USD                                                                                                                                   |
| D3  | Buy Plus on Razorpay                    | Hosted page, **charged in ₹**, not $                                                                                                                               |
| D4  | Try **change-plan** on a Razorpay sub   | `PLAN_CHANGE_UNSUPPORTED` — fails closed to support, by design                                                                                                     |
| D5  | Try **resume** on a paused Razorpay sub | `RESUME_UNSUPPORTED`                                                                                                                                               |
| D6  | Drive a Razorpay sub to **`halted`**    | Normalizes to `canceled` and drops the tier **immediately** — no 14-day window. Razorpay never auto-cancels a halted sub, so a window here would grant Pro forever |

**D6 is the specific bug the 2026-07-28 decision fixed.** Worth confirming by
hand.

---

## E. Cancel, pause, resume

| #   | Step                                          | Expect                                                                |
| --- | --------------------------------------------- | --------------------------------------------------------------------- |
| E1  | Cancel Pro                                    | Access continues to period end; `cancel_source` records who cancelled |
| E2  | During the cancelling window, try change-plan | `SUBSCRIPTION_CANCELING`                                              |
| E3  | Resume before period end (Paddle)             | Two-step confirm; continues the existing billing period               |
| E4  | Resume **after** period end                   | `RESUME_PERIOD_ENDED`                                                 |
| E5  | Pause, then try change-plan                   | `SUBSCRIPTION_PAUSED`                                                 |
| E6  | Paused sub                                    | Grants **nothing** — paused is not in `GRANTING_STATUSES`             |
| E7  | Cancel, let the period lapse fully            | Tier drops to free; Free limits apply again (see G)                   |

---

## F. Scheduled downgrades (the masking logic)

A downgrade is scheduled at period end, and the webhook projector **masks**
Paddle's immediate item swap until a post-boundary event applies it. That
masking is subtle enough to be worth its own group.

| #   | Step                                     | Expect                                                    |
| --- | ---------------------------------------- | --------------------------------------------------------- |
| F1  | Pro → Plus                               | "Scheduled for <date>", **not** applied now               |
| F2  | Immediately after F1, read `/billing`    | Still shows **Pro** until the boundary — the mask working |
| F3  | Pro annual → Pro monthly                 | Same scheduled behaviour                                  |
| F4  | "Keep current plan" after F1             | Item restored; reconciles against the provider response   |
| F5  | Try a second change while one is pending | `PLAN_CHANGE_PENDING`                                     |
| F6  | Change plan very close to the boundary   | `PLAN_CHANGE_TOO_LATE`                                    |
| F7  | Let the boundary pass                    | Plus applied; tier drops on schedule, not early           |

---

## G. Free-tier metering (no money involved — cheap to test)

| #   | Step                                    | Expect                                                                  |
| --- | --------------------------------------- | ----------------------------------------------------------------------- |
| G1  | On Free, check `/me`                    | `tier=free`, `cleanupRemaining`, `cleanupResetsAt` = signup anniversary |
| G2  | Spend cleanup actions                   | Counter counts **down** toward 50                                       |
| G3  | Preview a bulk action that will not fit | Confirm is swapped for a truthful upgrade action                        |
| G4  | Exceed the cap                          | `FREE_CAP_REACHED`, **zero rows written**                               |
| G5  | Open a Pro-only screen on Free          | `ACTION_TIER_REQUIRED` / tier gate                                      |
| G6  | Connect a 2nd mailbox on Free or Plus   | Blocked — limit is 1; Pro is 3                                          |
| G7  | Undo window                             | Free/Plus **7 days**, Pro **30 days**                                   |
| G8  | Cross the anniversary                   | Counter resets; `resetsAt` advances one period                          |

> Force the cap by tagging rows in `action_jobs` rather than performing 50
> real actions. Restore afterwards.

---

## H. Refunds, chargebacks, and the Founding promo

| #   | Step                                            | Expect                                                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| H1  | Refund a sandbox purchase in Paddle             | `adjustment.created` lands; tier drops; `cancel_source` shows refund provenance |
| H2  | Partial refund                                  | Does **not** silently revoke a still-valid period                               |
| H3  | Simulate a chargeback                           | Same provenance path as H1                                                      |
| H4  | Buy **Founding Pro** ($129/yr)                  | Availability confirmed at checkout, not reserved before payment                 |
| H5  | Founding Pro, then try change-plan              | `FOUNDING_PLAN_LOCKED` — the locked price is the point                          |
| H6  | Drive the counter to 250 (SQL)                  | `FOUNDING_PRO_SOLD_OUT`; `/pricing` stops offering it. **Restore afterwards**   |
| H7  | Two people claim the last founding slot at once | Advisory lock holds; exactly one wins                                           |

---

## I. Webhook integrity

| #   | Step                                                 | Expect                                                               |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| I1  | POST to `/api/webhooks/paddle` with **no** signature | 401                                                                  |
| I2  | POST with a **wrong** signature                      | 401                                                                  |
| I3  | Replay a valid webhook twice                         | Deduped; applied once                                                |
| I4  | Deliver events **out of order** (new, then old)      | `arrival_seq` ordering holds; the old one does not overwrite the new |
| I5  | Drop a webhook entirely, then let the reconciler run | Provider state is recovered without manual intervention              |

I4 and I5 are exactly what #430/#432–#434 were built for and have never run
against a real provider.

---

## J. Production — the one real purchase

After A–I pass in sandbox:

1. Buy **Plus monthly ($9)** on production with a real card.
2. Confirm the full A1–A5 chain against the prod DB.
3. **Refund it immediately** in the Paddle dashboard.
4. Confirm the refund drops the tier (H1) in production.
5. Confirm the public refund promise on `/refunds` matches what actually
   happened.

Total cost: one $9 charge, refunded. That is the price of not having the first
real customer be the test.

---

## What I cannot test for you

Everything above needs a real payment surface, a provider dashboard, or a real
card — none of which an agent can drive. What I _can_ do the moment you hit a
failure: read the prod DB, trace the webhook path, and fix the code. Send me
the step number and what you saw in all three places (API / DB / UI).
