# D253 — A refunded customer must be able to buy again

**Date:** 2026-08-13
**Status:** Ready to implement. v1 was rejected by three reviews; a fourth found
two further holes in v2; v3's open question is closed by Paddle's documentation.
See "What v1 got wrong", "The flipped row must stay monitored", and "An approved
refund is final".
**Branch:** `fix/d253-refund-repurchase-lockout`

---

## The problem

Refund a customer today and they lose the product immediately **and cannot buy
it back until the period they already paid for elapses** — up to a month on
monthly, up to a year on annual. There is no in-app route back. The only
recovery is an operator holding the Paddle API key.

Nobody designed this. It falls out of behaviours that are each correct alone:

| Behaviour                                                 | Where                                                                                | Why it is right                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A full refund sets `entitlement_ends_at` to SQL `now()`   | `billing-webhook.service.ts:833`                                                     | Founder decision 2026-07-31. Annual plus a 30-day guarantee meant refunding $190 _and_ granting the rest of the year. Money back means the service stops. |
| The row is left in `status='active'`                      | `applyScheduledCancellation` never writes `status`                                   | Paddle schedules nothing on a refund — our own sweep sends the cancel later (`billing-reconciliation.service.ts:409-412`)                                 |
| Any `active` row is the workspace's one live subscription | guard `billing.service.ts:89-107`, index `0051:72`, FE picker `billing-model.ts:258` | One subscription per workspace at a time (D120)                                                                                                           |

It is a revenue path, not only a trust one. A goodwill full refund is an
ordinary support gesture, and today it makes that customer unable to pay again
for the rest of their term.

---

## What v1 got wrong

v1 proposed a `cancel_settled_at` column plus a narrowed index predicate. Three
independent reviews rejected it. Recorded because the reasoning constrains v2.

1. **It would have shipped green and changed nothing.** The settlement write
   was to live in the verdict loop, but `billing-reconciliation.service.ts:481`
   short-circuits on `provider.cancelAtPeriodEnd` **before** the
   `providerCancellationFacts` call at `:494`. Our own enforcement is what
   converges the provider, so the row is skipped forever after.
2. **It broke a singleton at least six readers depend on.** Leaving the dead row
   `active` beside a repurchase means two rows match every
   `orderBy(desc(updatedAt)).limit(1)` reader. The drift sweep bumps
   `updated_at` on the dead row, so it wins. `getSubscription`
   (`billing.service.ts:266`) would serve the refunded plan to a paying
   customer, and Cancel / Pause / Change-plan would fire at the dead
   subscription id while the live one kept billing.
3. **It did not reach the customer.** The FE picker is keyed on status —
   `billing-model.ts:258`, whose comment reads _"Only a canceled row leaves the
   slot free."_ A backend-only change leaves the plan picker locked, so the
   stated value of the fix never arrives.
4. **The lift race was narrowed, not closed.** `chargeback_reverse` reaches
   `applyRevokedCancellation` from a live webhook with no settled filter and no
   unique-violation handler, ending in the "charged while our DB refuses to
   record it" state v1 quoted to reject the simpler fix.

v1 also rejected the design below on a false premise — "`status` is provider
truth". It is not: the dunning sweep writes `status='canceled'` with no provider
event (`billing-reconciliation.sweep.ts:72-81`), and Razorpay `halted` maps to
`canceled` locally while Razorpay still says halted.

---

## Design

**When the provider confirms a refund has settled, flip the local row to
`status='canceled'`.** No column, no migration, no index change.

### Why this shape

The index, the checkout guard and the FE picker **already** exclude `canceled`,
so one write frees all three. The singleton every other reader assumes is
preserved. And the collision v1 argued away becomes unrepresentable: the
terminal-canceled floor at `billing-webhook.service.ts:526-535` ignores any
later payload that would move a row out of `canceled`, so the dead row can never
re-enter the live slot.

`cancel_source='refund'` and `entitlement_ends_at` are untouched, so "ended by
refund" stays distinguishable from "cancelled normally".

### The flipped row must stay monitored

The terminal floor stops **local** resurrection. It does nothing to stop
**provider rebilling**, and that gap is the most dangerous thing about this
design.

Once the row reads `canceled`, all three reconcilers drop it — drift
(`billing-reconciliation.service.ts:353`), workspace reconcile (`:629`) and the
verdict pass (`:443`) all select on `status IN ('active','past_due','paused')` —
and the floor discards any later `active`/`past_due` payload for it. A payment
webhook changes no entitlement (`billing-webhook.service.ts:1016`). So if
Paddle's scheduled cancel is cleared, fails to stick, or the subscription
recovers from dunning, **Paddle keeps charging the customer while we hold them
on Free, and nothing anywhere notices.** That is charged-without-entitlement,
which is worse than the lockout this PR exists to fix.

So the flip does not end our interest in the row. A locally-canceled row that
still carries a refund verdict stays polled until the provider itself reports
terminal cancellation. If the provider instead reports active, past_due, a
successful payment, or the scheduled cancellation missing, that is an alert —
support-visible, never silent.

This is the one part of the design that cannot be skipped for scope. Without it
the fix trades a bad state the customer can see for a worse one nobody can.

### Refunds unlock. Chargebacks do not.

**Founder decision, 2026-08-13.** A settled _refund_ flips the row and frees the
slot. A settled _chargeback_ does not — that customer stays blocked until the
period ends naturally, and must contact support to subscribe again. Under a
merchant of record, repeat chargebacks are what gets a seller account flagged or
terminated, and re-arming the same payment method same-day is how that starts.

`facts.settled` returns `'refund' | 'chargeback' | null` from one call
(`billing-provider.interface.ts:212`), so the asymmetry is a branch on its value,
not a second read. Chargeback behaviour is therefore **unchanged** by this PR —
worth stating plainly, because "we did nothing" is the correct outcome there
rather than an oversight.

Two precision points, both load-bearing:

- The branch is `facts.settled === 'refund'`, **not** `cancel_source === 'refund'`.
  Local provenance and provider-confirmed cause are deliberately allowed to
  differ (`billing-reconciliation.service.ts:505`, `paddle.adapter.ts:684`), and
  the existing code path at `:508` handles every non-null cause together — so a
  generic settled branch would silently unlock chargebacks.
- "Chargebacks do not unlock" means **not early**, not _never_. When the period
  ends, the real `subscription.canceled` arrives and releases the guard, the
  index and the picker exactly as it does today. Permanent exclusion is a
  different feature and is not built here.

### Provider facts must be read in full

`providerCancellationFacts` requests `per_page=50` and ignores pagination
(`paddle.adapter.ts:654`). A subscription carrying more than 50 adjustments can
therefore return a settled refund while an active chargeback sits outside the
page — and this design would unlock repurchase for a customer with a live
dispute. Pre-existing, harmless while facts only suppressed an outbound cancel,
consequential the moment facts gate whether someone can pay us. Page through
before deciding refund versus chargeback.

### The write must go through the projector

`billing-reconciliation.service.ts:13-16` states the file's contract:
_"Reconciliation is a second SOURCE, never a second WRITER."_ `liftRefutedVerdict`
honours it by routing through `webhookService.process()` for the advisory lock,
staleness ordering and dedup.

Settlement follows that precedent: a new `NormalizedBillingEvent` kind
(`refund_settled`) carrying the provider-confirmed cause, applied by the
projector under `lockSubscription`. Not a raw UPDATE from the sweep.

It must be a **dedicated synthetic event**, not a forged provider snapshot with
`status='canceled'`. Forging one would record that Paddle reported terminal
cancellation when it did not, which is the same assert-what-you-don't-know
defect in the audit trail rather than the UI.

### An approved refund is final — settled by documentation

A fourth review raised a blocking contradiction: is settlement a one-way door,
or can an approved refund be reversed? **Founder direction 2026-08-13: rely on
Paddle's documentation.** It answers cleanly.

Paddle defines four adjustment statuses. `reversed` is _"set by Paddle when a
`chargeback_reversal` or `credit_reversal` adjustment is created for this
adjustment"_ — chargebacks and credits, **not refunds**. A refund goes
`pending_approval` → `approved` | `rejected`, and both are terminal.

So an approved full refund cannot be undone, the flip is safe from the
refutation angle, and there is no reversed-refund branch to build. That deletes
the whole support path this section previously described.

**A load-bearing comment in the adapter is wrong and must be corrected in this
PR.** `paddle.adapter.ts:692-697` states that _"checking only `rejected` on
refunds left an approved-then-reversed refund counting as neither settled nor
refuted, so its verdict stood forever"_ — describing a state the documentation
says cannot occur. The **code** is fine: `UNDONE_STATUSES = {rejected, reversed}`
is a harmless superset, since a refund can only ever reach `rejected` and a
chargeback only `reversed`. Only the explanation is false, and it is not
harmless — it is what produced a false blocking finding in review and sent this
design building machinery for an impossible case. Correct the comment; leave the
set alone.

Chargebacks genuinely can be reversed (you win the dispute, `chargeback_reverse`
arrives at `paddle.adapter.ts:856`). That carries no exposure here, because a
settled chargeback never flips the row in the first place.

### Fix the unreachable short-circuit

`billing-reconciliation.service.ts:481` currently skips the whole row when the
provider reports `canceled` **or** `cancelAtPeriodEnd`. Narrow it to
`provider.status === 'canceled'`, and move the `cancelAtPeriodEnd` test _below_
the facts read, where it suppresses only the redundant outbound
`cancelSubscription`:

```
if (provider.status === 'canceled') { project terminal cancellation; stop }

const facts = await providerCancellationFacts(...)

if (facts.settled !== null) {
  if (!provider.cancelAtPeriodEnd) await cancelSubscription(...)
  if (facts.settled === 'refund') await projectRefundSettlement(...)
} else if (facts.refuted[localVerdict]) {
  await liftRefutedVerdict(...)
}
```

Without this, "customer cancels, then asks for their money back" — the most
common refund shape there is — never settles, and any design built on settlement
does nothing for them.

It also skips **refutation**, which is the worse half and was missed until the
fourth review. A customer who cancels, requests a refund Paddle then _rejects_,
never reaches `liftRefutedVerdict` — so they keep paying and hold no
entitlement. That bug exists today, independent of this feature.

### The verdict pass becomes a real cron job

Verdict enforcement lives inside the 6-hourly drift loop today
(`reconcileLiveSubscriptions` calls it at `:395`), so settlement could take six
hours to notice.

It moves to its own **`cronPolicy`** job on a ~10 minute cadence: BullMQ
repeatable, `BaseDeclutrWorker.processJob()`, `cron_runs` claim keyed on
`(worker_name, scheduled_at_minute)`. **The drift pass stops calling it**, so the
two schedules cannot collide.

A plain `setInterval` was considered and rejected. The in-repo precedent for
that (`worker.ts:1871-1875`) is justified as _"bookkeeping on our own table, a
missed tick self-heals"_. This job issues outbound provider mutations and is the
sole gate on a revenue path — it is neither.

Selection is bounded so a row that can never settle does not poll forever: rows
carrying an unsettled refund verdict, capped by attempt count, oldest first. A
row that exhausts its attempts is logged for support rather than retried
silently.

### A refusal that tells the truth

During the settling window checkout still refuses, and `SUBSCRIPTION_EXISTS` is
false there — no live subscription exists. A new code says so.

It cannot be registered without copy: `ErrorCodeSpec`
(`packages/shared/src/contracts/error-codes.ts:26-34`) requires `status`,
`severityTier`, `retryable` and `message`. Values: **409** matching its siblings,
and **`retryable: true`** — unlike `SUBSCRIPTION_EXISTS` and
`SUBSCRIPTION_PAUSED_BLOCKS_NEW`, this one genuinely resolves on its own.

The code must also be added to the two hand-maintained frontend registries at
`plan-picker.tsx:111-133`. A new code absent from `PRE_CLAIM_REJECTIONS` is
treated as an ambiguous post-claim outcome and surfaces a payment reservation
for a checkout that never reached a provider.

### Razorpay is explicitly out of scope

`razorpay.adapter.ts:297-310` returns `null` from `providerCancellationFacts`
unconditionally, and its `mapWebhookEvent` maps no refund or chargeback event —
so no Razorpay row ever carries a verdict and none is affected today. Stated
here because the day someone maps Razorpay refunds, every such customer would
be locked out with **zero code change in this PR**. The implementation carries a
guard and a test pinning that scope.

### Observability

- A dedicated log kind for the settlement write itself — this is the line that
  records a customer becoming able to pay again, and v1 specified none.
- A distinct failure kind for the new pass, so it is separable from
  `billing.reconcile.sweep_failed` in Sentry.
- `billing.reconcile.swept` changes shape when verdict counters leave
  `DriftSweepResult`; that is an existing log contract and the change is noted
  rather than silent.
- One Sentry capture per failure (D203), preserved through the extraction.

---

## End-to-end behaviour

| Moment                       | Today                                  | After                                                         |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Refund issued                | access stops instantly                 | unchanged                                                     |
| Immediately after            | cannot buy for the rest of the period  | cannot buy — awaiting provider confirmation, told honestly    |
| Provider confirms the refund | nothing; locked to period end          | row flips to `canceled`; can buy again within ~10 min         |
| Refund rejected by Paddle    | pays on, holds no entitlement (bug)    | verdict lifted, entitlement restored                          |
| Refund later reversed        | —                                      | cannot happen; approved refunds are terminal                  |
| Chargeback settles           | locked out                             | unchanged — deliberate, founder decision                      |
| Paddle keeps billing anyway  | —                                      | alert; the flipped row stays watched until Paddle is terminal |
| Ordinary cancel              | keeps access to period end, cannot buy | unchanged — correct, they still hold the plan                 |

---

## Testing

- A settled refund flips the row to `canceled`, **and** a subsequent
  `subscription.created` inserts without violating
  `subscriptions_one_live_per_workspace`. A guard-only assertion passes against
  a broken system, so the insert is the assertion that matters.
- `getSubscription` and each of Cancel / Un-cancel / Pause / Change-plan target
  the live row, never the dead one, after a refund-then-repurchase.
- Cancel-then-refund settles — the regression test for `:481`.
- A settled **chargeback** does not flip the row and does not unlock checkout.
- A refund Paddle **rejects** after a prior cancel reaches `liftRefutedVerdict`
  and restores entitlement — the live bug at `:481`, pinned so it stays fixed.
- A flipped row whose provider still reports active, past_due, a successful
  payment, or no scheduled cancellation raises the alert rather than going quiet.
- The verdict pass claims its `cron_runs` row, does not overlap itself, and the
  drift pass no longer enforces verdicts.
- A row that cannot settle stops being retried after its attempt bound.
- Razorpay rows never acquire a verdict; the scope guard holds.

## Out of scope

- **`adjustment.updated` handling.** The adapter has no case for it — it falls
  to `default:` and is recorded as `ignored`, so the existing follow-up advising
  only the Paddle dashboard toggle is incomplete and buys nothing without
  adapter code. At a 10-minute cadence the remaining gain is marginal.
- **The `past_due` dunning-expiry variant** of the same lockout — worth checking
  for and logging, not fixing here.
- **Re-litigating the refund policy.** "Money back means the service stops" is
  settled.

## Open for the founder

D253 is the next free number; the plan mirror and `IMPLEMENTATION-LOG.md` are
appended in this same PR per the Class-B rule. Neither is in the diff yet. The
durable rule this establishes — guard, projector, sweep and **frontend** must
share one definition of "live" — may deserve its own ADR once shipped.
