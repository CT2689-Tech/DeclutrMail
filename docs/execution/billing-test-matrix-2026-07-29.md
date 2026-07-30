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

## 0. STOP — environment safety

Groups A–I run against **sandbox providers and the dev database**. Group J is
the only production step. Mixing them is how you charge a real card or corrupt
real billing rows.

Be honest about the strength of what follows: these are **checks you have to
run**, not enforcement. Nothing in the code stops a shell pointed at production
from executing the SQL in C4. §0.2 is a two-second command that turns "I think
this is dev" into "I checked" — its whole value is that you actually run it.

### 0.1 Four rules

1. **The SQL steps in C4, G4 and H6 mutate billing state. They are dev-DB
   only.** Never run them against production. Each is marked
   `[DEV DB ONLY]`.
2. **A sandbox provider must never point at the production database.** A
   sandbox webhook writing to prod creates real subscription rows for a
   payment that never happened.
3. **`BILLING_CATALOG_JSON` must never reach production.** It overrides the
   catalog wholesale; sandbox price ids in the prod API means live checkouts
   priced against test products. Keep it in `.env.local` only — it is
   deliberately absent from `deploy-cloud-run.yml`.
4. **Razorpay needs its own test-mode keys.** See §0.4 — this is the easiest
   way to accidentally take a real ₹ payment.

### 0.2 Prove which database you are on — before anything else

```bash
./scripts/assert-dev-db.sh --record        # once, pointed at your dev database
```

```bash
./scripts/assert-dev-db.sh --exec "<SQL>"  # every [DEV DB ONLY] mutation goes through this
```

```bash
./scripts/assert-dev-db.sh                 # bare check — informational only
```

Exit 0 means proceed. Exit 1 prints why and you stop.

The bare check tells you where you are **right now, for the URL it resolved
itself**. It cannot vouch for a separate `psql` command, which resolves its own
target — so it is a sanity check, not a licence to write. Anything that writes
uses `--exec`.

The check lives in the script, not in this page, deliberately: a runbook is
executable, and a second copy of the logic in prose is a copy that will drift
from the one people run.

**Why it asks the server rather than reading your config.** Five earlier
versions of this gate could not fail. The full history is in the script header;
the short version is that each inspected a _description_ of the connection
instead of the connection's destination:

| Version                                   | Bypassed by                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `inet_server_addr()` vs a hostname        | the function returns an IP, so it never matched                          |
| grep the prod project ref in `.env.local` | missing file · shell export wins · no `DATABASE_URL` · prod by IP/pooler |
| allowlist the connection-string host      | a port forward makes production answer on `localhost`                    |
| cluster identity, enrolled on first use   | recording it while pointed at prod approves prod forever                 |

The current gate closes all of them: identity comes from
`pg_control_system()` — reported **by the server**, so no URL or tunnel can
fake it — enrollment refuses a known production cluster, and the stored value
is re-validated on every run, so an identity file written before this guard
existed (or copied from another machine) cannot keep approving production.

Verified behaviour:

| Situation                                         | Result |
| ------------------------------------------------- | ------ |
| `--record` while pointed at a production cluster  | REFUSE |
| `--record` while pointed at your dev cluster      | OK     |
| identity file names a production cluster          | REFUSE |
| identity file missing or empty                    | REFUSE |
| no `DATABASE_URL` resolves                        | REFUSE |
| server unreachable                                | REFUSE |
| a different cluster behind `localhost` (a tunnel) | REFUSE |
| connected to the recorded dev cluster             | OK     |

`.dev-db-identity` is gitignored — it is machine-specific, and a committed
value would approve the wrong database elsewhere.

**A second, independent signal:** the dev-login route only exists when
`DEV_AUTH_ENABLED=true`, which is never set on production — it appears zero
times in `deploy-cloud-run.yml`, and that deploy uses `--set-env-vars`, a full
replace, so it cannot linger from an earlier revision. If dev-login works, you
are not talking to the production **API**.

> The identity gate proves which **database** you will write to. Dev-login
> proves which **API** you are driving. Neither implies the other. Run both.

### 0.3 Sandbox setup (one time)

`.env.local` in the repo root:

```
# --- database: MUST be the dev DB, verified via §0.2 ---
DATABASE_URL=postgres://…localhost…/declutrmail_dev

# --- billing: sandbox only ---
BILLING_ENABLED=true
PADDLE_ENV=sandbox
PADDLE_API_KEY=pdl_sdbx_apikey_…
PADDLE_CLIENT_TOKEN=test_…
PADDLE_WEBHOOK_SECRET=pdl_ntfset_…
BILLING_CATALOG_JSON={"paddle":{"plus_monthly":"pri_…","plus_annual":"pri_…","pro_monthly":"pri_…","pro_annual":"pri_…","pro_annual_founding":"pri_…"}}

# --- auth: skip the OAuth grant (D206) ---
DEV_AUTH_ENABLED=true
DEV_AUTH_EMAIL_PREFIX=chintan
```

Start the stack:

```bash
./scripts/dev-up.sh
```

```bash
pnpm --filter @declutrmail/web dev
```

Expose the webhook:

```bash
cloudflared tunnel --url http://localhost:4000
```

Register the printed hostname + `/api/webhooks/billing/paddle` as the
**sandbox** notification destination. The `billing` segment is not optional —
`@Controller('webhooks/billing')` + `@Post('paddle')` in
`apps/api/src/webhooks/billing-paddle.controller.ts` is the whole route, and
the shorter `/api/webhooks/paddle` returns a **404** rather than an auth error.
Verified 2026-07-29. Razorpay is `/api/webhooks/billing/razorpay`.

> **Trap:** cloudflared _quick_ tunnels rotate their hostname on every
> restart. If a purchase stops flipping the tier, re-check the hostname before
> debugging code:
>
> ```bash
> curl -s 127.0.0.1:20241/quicktunnel
> ```

Sign in without OAuth:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

That call sets the session cookie. To reuse it from `curl`:

```bash
curl -s -c cookies.txt "http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com" -o /dev/null
```

Mutating routes are CSRF-guarded: the `dm_csrf` cookie value must be echoed
back in the `x-csrf-token` header, or the request is rejected before it reaches
any billing code.

```bash
curl -s -b cookies.txt -X DELETE http://localhost:4000/api/billing/checkout/pending \
  -H "x-csrf-token: $(awk '$6=="dm_csrf"{print $7}' cookies.txt)"
```

If that returns a CSRF error rather than `{released:true}`, the cookie jar is
stale — re-run the dev-login above before assuming a billing bug.

### 0.4 Razorpay — read before Group D

`.env.local` above configures **Paddle** sandbox only. Group D will otherwise
run against whatever Razorpay credentials are in scope, and Razorpay creates
subscriptions with `customer_notify: 1` — meaning **the provider emails a
payable authorization link directly to the customer**, outside our UI. With
live keys that is a real charge you did not intend.

Either:

- add Razorpay **test-mode** keys (`rzp_test_…`) to `.env.local`
  (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) and a
  `"razorpay"` block in `BILLING_CATALOG_JSON`; **or**
- skip Group D entirely and record it as untested.

Do not run Group D with live Razorpay keys.

### 0.5 Forcing the background sweep

Several steps depend on the reconciliation sweep, which runs **every 6 hours
and once on worker boot**. Do not wait 6 hours — restart the worker to trigger
the boot pass:

```bash
./scripts/dev-up.sh --stop && ./scripts/dev-up.sh
```

Any step that needs this says **"restart the worker"** explicitly.

### 0.6 Reading the result of every step

Three places, always. A step passes only when all three agree.

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
SELECT workspace_id, provider, tier, expires_at FROM pending_checkouts;
SELECT tier FROM workspaces;
```

3. What the **UI** says on `/billing` and on a gated screen (`/autopilot`).

**The whole point is disagreement between these three.** The dominant defect
class in this codebase is a surface asserting something the system does not
know — so a green UI over a `tier=free` row is the bug, not a display glitch.

---

## A. The happy path

**Precondition:** workspace on Free, no subscription row, no pending checkout.

| #   | Step                                                    | Expect                                                                                         |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A1  | `/pricing` → **Get Plus** while signed out              | Lands on sign-in, then returns to the checkout intent                                          |
| A2  | Signed in, `/billing` → pick **Plus monthly** → confirm | A `pending_checkouts` row is written **before** the provider is called, then the overlay opens |
| A3  | Pay with the Paddle sandbox test card                   | Overlay closes; UI shows "payment received — confirming your plan" and polls                   |
| A4  | Wait for the webhook                                    | `subscription_events` gains rows; `subscriptions.status=active`; `workspaces.tier=plus`        |
| A5  | Reload `/billing`                                       | Plan card reads Plus; the `pending_checkouts` row is gone                                      |
| A6  | Open `/autopilot`                                       | Still gated — Autopilot is Pro-only, Plus does not include it                                  |
| A7  | Upgrade Plus → **Pro**                                  | Immediate, provider-prorated; tier flips to `pro`; `/autopilot` now opens                      |

**A4 is the load-bearing one.** Checkout never grants tier — only the verified
webhook does. A tier that flips _before_ the webhook lands is a bug.

---

## B. Money-safety: the same purchase twice

**Precondition:** back on Free with no subscription (re-run §0.3 setup or
delete the dev rows). B6 needs an **active Plus** subscription — do it right
after A5, before A7.

| #   | Step                                                                    | Expect                                                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| B1  | Open the plan picker in **two browser tabs**, start checkout in both    | Second tab stands down (Web Locks); only one overlay                                             |
| B2  | Start checkout, then in a **second browser profile** try again          | `CHECKOUT_IN_FLIGHT`                                                                             |
| B3  | From B2, click "I checked — no charge went through"                     | `DELETE /api/billing/checkout/pending` → `{released:true}`; checkout allowed again               |
| B4  | Start checkout, close the overlay **without paying**, retry immediately | Still `CHECKOUT_IN_FLIGHT`. The claim is **surfaced, not released** — 3DS can settle after close |
| B5  | Force a provider failure (bad `PADDLE_API_KEY`), then retry             | The claim is **HELD**, by design — a thrown provider error is not proof the provider saw nothing |
| B6  | On active **Plus**, try to buy Plus again                               | `SUBSCRIPTION_EXISTS`                                                                            |
| B7  | Double-click **Confirm** as fast as possible                            | One charge. **Verify in the Paddle dashboard, not just the UI**                                  |
| B8  | Abandon a checkout, wait past the **30-minute TTL**, retry checkout     | Succeeds — **no sweep needed.** The claim upsert reclaims any row whose `expires_at` has passed  |
| B9  | After B8, restart the worker (§0.5)                                     | The stale row is also deleted (`pendingCheckoutsCleared`) — housekeeping, not the reopener       |

> B8/B9 separate two things the first version of this table conflated. What
> reopens checkout is the **30-minute TTL** — the claim upsert's
> `expires_at < now()` predicate — or the user's explicit release. **Never** an
> inference from an unknown provider outcome. The sweep's deletion of expired
> rows is tidying that happens later, so a step telling you to restart the
> worker in order to reopen checkout was exercising the wrong mechanism.

---

## C. Payment failure and dunning

Use Paddle's declining test card.

| #   | Step                                                                                            | Expect                                                                                       |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1  | Buy Plus with a card that declines at checkout                                                  | No subscription row; no tier grant; legible error, not a raw 5xx                             |
| C2  | On an active sub, force a **renewal** failure                                                   | `status=past_due`; **tier still granted** (dunning)                                          |
| C3  | Read the deadline                                                                               | `entitlement_ends_at` = `current_period_end` **+ 14 days**                                   |
| C4  | **[DEV DB ONLY]** expire the deadline with the scoped SQL below, then restart the worker (§0.5) | Sweep flips that row to `canceled` and recomputes the tier; `/autopilot` re-gates            |
| C5  | Recover the card mid-dunning                                                                    | `status=active`; `entitlement_ends_at` becomes **NULL** (only `past_due` carries a deadline) |

> **C2/C3 are the founder decision of 2026-07-28** — 14 days for _genuine
> retry_ states only. **D6** is the paired half: a terminal state must drop
> immediately and never get the window.

C4's SQL, scoped. An unqualified `UPDATE subscriptions SET …` rewrites every
row in the table, and the sweep's dunning step only acts on rows that are
already `past_due` — so run **C2 first**, then expire exactly that row:

Run it through `--exec`, which asserts the cluster in the **same session and
transaction** as the statement:

```bash
./scripts/assert-dev-db.sh --exec "
UPDATE subscriptions
   SET entitlement_ends_at = now() - interval '1 day'
 WHERE status = 'past_due'
   AND workspace_id = '<your-workspace-id>';"
# expect: UPDATE 1   (UPDATE 0 means the row is not past_due — redo C2)
```

**Every `[DEV DB ONLY]` mutation goes through `--exec`** — G4 and H6 included.

Plain SQL only — `--exec` refuses backslash metacommands. A `\c` can reconnect
_after_ the identity assertion passes, and it silently discards the surrounding
transaction while doing it, so the statement would land on an unverified
database. Need two databases? Two `--exec` calls.

> **Do not use `assert-dev-db.sh && psql …`.** It looks equivalent and is not:
> the two halves resolve their target independently. With `DATABASE_URL` unset
> in the shell, the script falls back to `.env.local` and validates that
> cluster, while `psql "$DATABASE_URL"` becomes `psql ""` and connects to libpq
> defaults — `PGHOST` / `PGDATABASE` / `PGSERVICE` or the local socket.
> Demonstrated: the guard printed OK for the recorded dev cluster while the next
> command reached a different database. `--exec` resolves the URL once and sends
> the assertion and the statement as a single query batch, so there is no second
> connection to divert and no window between check and write.

---

## D. Razorpay / India — **read §0.4 first**

Skip this group entirely rather than run it with live keys.

| #   | Step                                 | Expect                                                                                                         |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| D1  | `/pricing` as an India visitor       | Prices in **₹** (₹749 Plus/mo, ₹1,599 Pro/mo)                                                                  |
| D2  | JSON-LD on `/pricing`                | INR offers present alongside USD                                                                               |
| D3  | Buy Plus on Razorpay (**test mode**) | Hosted page, charged in **₹**, not $                                                                           |
| D4  | **change-plan** on a Razorpay sub    | `PLAN_CHANGE_UNSUPPORTED` — fails closed to support, by design                                                 |
| D5  | **resume** a paused Razorpay sub     | `RESUME_UNSUPPORTED`                                                                                           |
| D6  | Drive a Razorpay sub to **`halted`** | Adapter maps it to `canceled`; tier drops **immediately**, `entitlement_ends_at` stays NULL — no 14-day window |

**D6 is the specific bug the 2026-07-28 decision fixed:** Razorpay never
auto-cancels a halted subscription, so a dunning window there would grant Pro
forever.

---

## E. Cancel, pause, resume

**Precondition:** an active Paddle subscription.

| #   | Step                               | Expect                                                             |
| --- | ---------------------------------- | ------------------------------------------------------------------ |
| E1  | Cancel Pro                         | Access continues to period end; `cancel_source` records the origin |
| E2  | During cancelling, try change-plan | `SUBSCRIPTION_CANCELING`                                           |
| E3  | Resume before period end (Paddle)  | Two-step confirm; continues the existing billing period            |
| E4  | Resume **after** period end        | `RESUME_PERIOD_ENDED`                                              |
| E5  | Pause, then try change-plan        | `SUBSCRIPTION_PAUSED`                                              |
| E6  | While paused                       | Grants **nothing** — only `active` and `past_due` grant            |
| E7  | Cancel and let the period lapse    | Tier drops to free; Free limits apply again (Group G)              |

---

## F. Scheduled downgrades (the masking logic)

A downgrade is scheduled at period end, and the webhook projector **masks**
Paddle's immediate item swap until a post-boundary event applies it.

| #   | Step                                  | Expect                                                    |
| --- | ------------------------------------- | --------------------------------------------------------- |
| F1  | Pro → Plus                            | "Scheduled for <date>", **not** applied now               |
| F2  | Immediately after F1, read `/billing` | Still **Pro** until the boundary — the mask working       |
| F3  | Pro annual → Pro monthly              | Same scheduled behaviour                                  |
| F4  | "Keep current plan" after F1          | Item restored; reconciled against the provider's response |
| F5  | Second change while one is pending    | `PLAN_CHANGE_PENDING`                                     |
| F6  | Change very close to the boundary     | `PLAN_CHANGE_TOO_LATE`                                    |
| F7  | Let the boundary pass                 | Plus applied; tier drops on schedule, not early           |

---

## G. Free-tier metering (no money involved)

| #   | Step                                                                           | Expect                                                                  |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| G1  | On Free, read `/me`                                                            | `tier=free`, `cleanupRemaining`, `cleanupResetsAt` = signup anniversary |
| G2  | Spend cleanup actions                                                          | Counter counts **down** from 50                                         |
| G3  | Preview a bulk action that will not fit                                        | Confirm swapped for a truthful upgrade action                           |
| G4  | **[DEV DB ONLY]** fill the quota by tagging `action_jobs` rows, then exceed it | `FREE_CAP_REACHED`, **zero rows written**. Restore afterwards           |
| G5  | Open a Pro-only screen on Free                                                 | Tier gate / `ACTION_TIER_REQUIRED`                                      |
| G6  | Connect a 2nd mailbox on Free or Plus                                          | Blocked — limit is 1; Pro is 3                                          |
| G7  | Undo window                                                                    | Free and Plus **7 days**, Pro **30 days**                               |
| G8  | Cross the anniversary                                                          | Counter resets; `cleanupResetsAt` advances one period                   |

---

## H. Refunds, chargebacks, and the Founding promo

| #   | Step                                                 | Expect                                                                                                                                               |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Refund a sandbox purchase in Paddle                  | `adjustment.created` lands; tier drops; `cancel_source='refund'`                                                                                     |
| H2  | **After H1, replay/receive any later renewal event** | Tier does **NOT** come back. A refund is a LOCAL verdict and must survive every later provider payload — this re-grant was the known gap 0051 closed |
| H3  | Simulate a chargeback                                | `cancel_source='chargeback'`, same stickiness as H2                                                                                                  |
| H4  | Buy **Founding Pro** ($129/yr)                       | Availability confirmed at checkout; no slot reserved before payment succeeds                                                                         |
| H5  | On Founding Pro, try change-plan                     | `FOUNDING_PLAN_LOCKED` — the locked price is the point                                                                                               |
| H6  | **[DEV DB ONLY]** drive the founding counter to 250  | `FOUNDING_PRO_SOLD_OUT`; `/pricing` stops offering it. Restore afterwards                                                                            |
| H7  | Two clients claim the last founding slot at once     | Advisory lock holds; exactly one wins                                                                                                                |

**H2 is the most valuable step in this document.** It is the one failure that
silently gives away Pro forever, and it cannot be observed without deliberately
replaying an event after a refund.

---

## I. Webhook integrity

| #   | Step                                                                                      | Expect                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| I1  | POST `/api/webhooks/billing/paddle` with **no** signature                                 | 401 `UNAUTHORIZED` / "Signature verification failed." — **PASSED 2026-07-29** |
| I2  | POST with a **wrong** signature                                                           | Same 401 — **PASSED 2026-07-29**. Razorpay's route rejects identically        |
| I3  | Replay a valid webhook twice                                                              | Deduped; applied once                                                         |
| I4  | Deliver events **out of order** (new, then old)                                           | `arrival_seq` ordering holds; the old one does not overwrite                  |
| I5  | Drop a **cancel or renewal** webhook, expire the deadline (C4), restart the worker (§0.5) | The tier drops on the deadline rather than being granted forever              |

> **What I5 does NOT test, and what the first version of this row wrongly
> claimed.** The sweep does **not** poll Paddle or Razorpay — the adapters
> expose no read methods, and provider-truth polling is explicitly deferred.
> So a dropped `subscription.created` webhook leaves **no row at all**, and
> nothing recovers it: the purchase is invisible to us until the provider sends
> something else. What the deadline system removes is the narrower
> **forever-grant** class — a dropped cancel or renewal cannot leave a stale
> grant standing past its deadline. Testing "drop any webhook, the sweep fixes
> it" would have passed for the wrong reason and hidden the real gap.

I4 and the deadline half of I5 are what #430 and #432–#434 were built for and
have never run against a real provider.

---

## J. Production — the one real purchase

Only after A–I pass in sandbox. **No SQL from this document runs here.**

1. Confirm the API is on production billing:
   ```bash
   curl -s https://api.declutrmail.com/api/readyz
   ```
2. Buy **Plus monthly ($9)** on production with a real card.
3. Confirm the A2–A5 chain against the prod DB (read-only queries from §0.6).
4. **Refund it immediately** in the Paddle dashboard.
5. Confirm the refund drops the tier, and that `cancel_source='refund'` sticks.
6. Confirm `/refunds` describes what actually happened.

Total cost: one $9 charge, refunded. That is the price of not having the first
real customer be the test.

---

## What I cannot test for you

Every step needs a real payment surface, a provider dashboard, or a real card —
none of which an agent can drive. What I _can_ do the moment you hit a failure:
read the DB, trace the webhook path, and fix the code. Send me the step number
and what you saw in all three places (API / DB / UI).
