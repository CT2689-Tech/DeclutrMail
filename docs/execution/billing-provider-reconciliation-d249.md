# D249 — Provider-truth reconciliation for billing

> **Decision (founder, 2026-07-30).** The "I checked — no charge. Resume
> checkout" release asked the customer to answer a question the system can
> answer itself: _did the provider record a payment for this workspace?_
> D249 un-defers provider polling in two narrow forms and demotes the manual
> release to a last resort. Both providers ship together (no half-surface).
>
> Origin: sandbox test run 2026-07-29. A real purchase existed at Paddle
> (`sub_01kyrtsywf…`, active, attributable by customer) while the UI's only
> affordance was asking the founder whether they believed they'd been
> charged. One provider `GET` would have resolved it.

## What ships

**1. On-demand pending-checkout reconciliation.** When a pending checkout
reaches the `unconfirmed` phase, the FE calls `POST /api/billing/reconcile`.
The server fetches provider truth for that workspace's claim and, when it
finds a matching subscription, projects it through the **existing**
`BillingWebhookService.process()` — the same dedup, staleness, attribution,
live-conflict, and tier-recompute path every webhook takes. No second
projection code path exists.

**2. Drift sweep.** The existing 6-hourly billing sweep additionally
verifies each live subscription row (`active`/`past_due`/`paused`) against
the provider and projects any drift through the same `process()`. This is
the recovery path for a dropped webhook: providers give an event a finite
retry budget (Paddle: 3 attempts), after which a lost cancel/renewal was
previously unrecoverable by design.

**3. Release demoted, copy honest.** The manual release renders only after
a provider check has actually run and found nothing (or the provider was
unreachable). Its copy asserts what the server verified — never "I checked"
as a customer liability transfer. The `unconfirmed` heading also stops
saying "plan change" for first purchases (it is kind-aware, like the other
two phases already were).

## How reconciliation finds the subscription

Resolution ladder for a pending claim, strictest first:

1. `pending_checkouts.provider_ref` → `fetchSubscription(ref)`. Razorpay
   creates the provider-side subscription server-side at checkout, so its id
   is known before payment and stored on the claim (new nullable column;
   the "no provider session ids" note on that table is amended — the
   reconciler is a legitimate consumer, and the ref is a subscription id,
   not a payment credential). Paddle's overlay creates the transaction
   client-side, so `provider_ref` stays null there.
2. `searchSubscriptionsByEmail(owner email)` → candidates filtered to the
   claim: catalog-resolved (tier, cycle) must match, status must be a
   granting one, and `providerCreatedAt` (when present) must be ≥ claim
   `created_at − 15 min`. Newest match wins; extras are logged, never
   projected. Paddle implements this (`GET /customers?email` →
   `GET /subscriptions?customer_id`); Razorpay's list API has no customer
   filter and returns `[]` — its checkouts always resolve via step 1.

A matched subscription is normalized by the adapter and projected with the
claim's workspace id as attribution (server-derived — this is what makes a
checkout whose `custom_data.sig` no longer verifies recoverable, the exact
2026-07-29 failure).

**Two amendments from the 2026-07-30 Codex review:**

- **Pre-grant artifacts are `payment_in_progress`, never "no payment".**
  `fetchSubscription` distinguishes `not_found` / `found` /
  `found_unmapped` — a Razorpay subscription in `created`/`authenticated`
  (the 3DS window) EXISTS, and reporting it as none-found unlocked the
  release seconds before a charge could settle. The release stays locked
  for `payment_in_progress`; a standalone "Check again" re-asks.
- **Stale Razorpay locks are actually checked against Razorpay** (round
  3). The hint path exposed a dead assumption: "Razorpay always
  resolves via `provider_ref`" fails precisely when the claim row (and
  its ref) has been swept, and the first-cut `[]` search meant
  `none_found` without asking Razorpay about a still-payable artifact.
  Two changes: the sweep retains expired claims for 7 days (expiry
  already re-arms checkout via the claim upsert; deletion was pure
  housekeeping), and `searchSubscriptions` is now real on Razorpay —
  list per catalog `plan_id`, keep entries whose server-written
  `notes.workspace_id` names the workspace. The search also reports
  pre-grant matches (`inProgress`), which surface as
  `payment_in_progress` rather than "no payment". Known limit, both
  providers: Paddle's search keys on the OWNER email, and the overlay
  lets the payer type any address — alias-typed checkouts are invisible
  to the email search and rely on the signed-attribution / claim paths
  (which is how they grant today).
- **A stale lock reconciles via the FE hint.** The browser lock never
  auto-expires, but the server claim TTLs at 30 min and is swept — so a
  claimless reconcile used to answer `no_pending` without asking any
  provider, and the FE rendered that as "found your payment" (observed
  live on the founder's screen). The FE now sends its local record
  (tier / cycle / startedAt) as a hint; a claimless reconcile searches
  the provider with it, so `none_found` means "we asked", and
  `no_pending` survives only for hintless calls. The notice states
  "nothing is awaiting confirmation" and unlocks the release.

## Synthesized events and ordering

Reconciliation feeds `process()` a `NormalizedBillingEvent` with:

- `providerEventId = recon:<provider>:<subId>:<stateHash>` where
  `stateHash` digests the material fields (status, price id, period end,
  cancel-at-period-end, pause-until). Unchanged truth reconciles to the
  same id and dedups; changed truth mints a new id. No new dedup machinery.
- `eventType = reconciliation.subscription` — provenance is visible in the
  ledger.
- payload `occurred_at` = the timestamp taken **at request start**. The
  staleness guard orders by provider event time: a real webhook stamped
  after our fetch began wins over the reconciled snapshot; anything stamped
  before it is already reflected in the fetched state and is correctly
  stale. Stamping at request start (not response) keeps the claim
  conservative under provider read latency.

Known accepted gap: a state that oscillates back to a byte-identical
snapshot between sweeps (e.g. cancel-at-period-end toggled off and on with
nothing else changed on a provider that exposes no `updated_at`) hashes to
the same id and dedups. Webhooks remain the primary channel and carry those
transitions; reconciliation is the backstop.

## Failure posture

Reconciliation is strictly additive. Provider unreachable → outcome
`provider_unavailable`, nothing written, manual release becomes available
with honest copy. Provider returns 404 for a live row in the sweep → logged
(`billing.reconcile.provider_missing`), **no** state write — a read
ambiguity never cancels a subscription. `unknown_price` / `unattributable` /
`live_conflict` outcomes surface exactly as they do for webhooks.

## Surface

- `BillingProvider` gains its first read methods: `fetchSubscription`,
  `searchSubscriptionsByEmail` (both adapters; Razorpay's search documented
  `[]`). `NormalizedSubscription` gains optional `providerCreatedAt`.
- `POST /api/billing/reconcile` — JWT + CSRF, rate limit 5/60s (it makes
  provider calls), returns
  `{ outcome: granted | already_recorded | none_found | no_pending | unresolved | provider_unavailable }`.
- Migration `0052`: `pending_checkouts.provider_ref text` (nullable).
- Worker: drift verification joins the existing 6-hourly
  `billing.reconcile.swept` pass (sequential fetches, capped per run —
  the loop itself is the rate limiter at current scale).

## What this does NOT change

- Webhooks stay the primary channel; reconciliation never races them
  thanks to the ordering rule above.
- The pending-claim TTL and the double-charge guard are untouched.
- No provider-truth-first inversion: `process()` remains the single writer,
  webhook-shaped.
