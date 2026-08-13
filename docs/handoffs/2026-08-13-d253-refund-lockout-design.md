# D253 — A refunded customer must be able to buy again

**Date:** 2026-08-13
**Status:** Design approved by founder 2026-08-13; not yet implemented
**Branch:** `fix/d253-refund-repurchase-lockout`

---

## The problem

Refund a customer today and they lose the product immediately **and cannot buy
it back until the period they already paid for elapses** — up to a month on
monthly, up to a year on annual. There is no in-app route back. The only
recovery is an operator holding the Paddle API key.

Nobody designed this. It falls out of three behaviours that are each correct
alone:

| Behaviour                                                            | Where                                                                                  | Why it is right                                                                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A full refund sets `entitlement_ends_at` to SQL `now()`              | `billing-webhook.service.ts:833`                                                       | Founder decision 2026-07-31. Annual plus a 30-day money-back guarantee meant refunding $190 _and_ granting the rest of the year. Money back means the service stops. |
| The row stays `status='active'` until the paid period ends           | projector mirrors the provider                                                         | `status` is provider truth; Paddle keeps the subscription active with `scheduled_change: cancel` until period end                                                    |
| Any `active` row is treated as the workspace's one live subscription | `billing.service.ts:89-107` guard and the `subscriptions_one_live_per_workspace` index | One subscription per workspace at a time (D120); plan changes are a provider-side update, not a second checkout                                                      |

The composition was never decided. It is the "cancel is a one-way door" class
(follow-up resolved 2026-07-31) recurring in the shape that fix deliberately
excluded: that fix reopened the _un-cancel_ door and correctly left
refund-cancels irrevocable, but nothing reopened the _purchase_ door behind
them.

It is a revenue path, not only a trust one. A goodwill full refund is an
ordinary support gesture and today it makes that customer unable to pay again
for the rest of their term.

### Why the obvious fix is worse than the bug

Loosening only the checkout guard — "ignore rows whose entitlement has already
lapsed" — lets the customer pay while the webhook write still fails. Paddle
takes the money, `subscription.created` tries to insert a second `active` row
for the workspace, `subscriptions_one_live_per_workspace` rejects it, and the
webhook retries forever. The customer is charged and receives nothing.

This repository already reached that conclusion for the sibling case, in the
follow-up weighing index predicates: _"the webhook write is rejected by the
index and retries forever: the customer is charged while our DB refuses to
record it. Strictly worse than no index."_

The guard and the index key on the same thing. Any real fix has to change what
counts as live, not special-case one of the two readers.

### One shortcut is unavailable

Pushing the lapsed-entitlement test into the index predicate does not work.
Postgres requires index predicates to be `IMMUTABLE`; `now()` is not.

---

## The founder decision this design encodes

**Question posed 2026-08-13:** you refund a customer, they buy again the same
day, then Paddle rejects the refund — their original payment stands and they
have paid twice. What should happen?

**Answer chosen:** _wait for Paddle to confirm._ Repurchase unlocks when the
refund **settles**, not when it is requested. Double payment becomes
impossible. The accepted cost is that a refunded customer waits for provider
confirmation before they can buy again.

This choice does more than pick a policy — it removes the hardest edge in the
design. The dangerous case was a verdict being lifted _after_ a repurchase:
two live rows, and the correcting write is the one the index rejects. Gating
on settlement makes that unreachable, because settlement is the thing that
unlocks buying. The race is designed out rather than handled.

---

## Design

### 1. Persist settlement

Add one nullable column to `subscriptions`:

```
cancel_settled_at  timestamptz  null
```

Set **only** when the provider confirms a plan-ending refund or chargeback.
Never set from `adjustment.created`, which is a request rather than an outcome.
Cleared back to `null` by `liftRefutedVerdict` alongside the existing
`cancel_source` / `entitlement_ends_at` reset.

The sweep already computes exactly this fact — `cancellationFacts()` asks the
provider whether it holds a settled, plan-ending adjustment — and then discards
the answer. This change persists what it already knows. No new provider calls
and no new webhook subscriptions.

### 2. Both readers ask the same question

The checkout guard and the partial unique index stop treating a settled-cancel
row as live:

- Index predicate becomes
  `WHERE status IN ('active','past_due') AND cancel_settled_at IS NULL`
- The guard query adds `cancel_settled_at IS NULL`

`cancel_settled_at IS NULL` is a plain column test, so it is legal in an index
predicate where the `now()` formulation was not.

This deliberately leaves ordinary cancels alone. A customer who cancels
normally keeps access to period end, so their row _should_ still hold the slot.
`cancel_source='provider'` never sets `cancel_settled_at`. Only a **settled**
refund or chargeback releases it.

`recomputeWorkspaceTier` needs no change: a refunded row already stops granting
via its `entitlement_ends_at` deadline.

### 3. A distinct refusal code

Today a blocked repurchase returns `SUBSCRIPTION_EXISTS`, which after a refund
is simply false — there is no live subscription. That is the
assert-what-you-do-not-know defect this codebase keeps hitting.

During the settling window the guard returns a distinct code instead. Customer
facing wording is a design-freeze surface (D220) and is **not** decided here;
this change returns the code and leaves copy to the founder.

### 4. Split the sweep

Verdict enforcement currently lives inside the per-row loop of
`reconcileLiveSubscriptions()`, which runs every 6 hours plus on boot
(`worker.ts:1916`). So settlement could take up to 6 hours to be noticed, and
the customer waits that long to buy again.

Extract the verdict logic into one method and call it from two schedules:

| Pass    | Selects                                                                              | Cadence        |
| ------- | ------------------------------------------------------------------------------------ | -------------- |
| Verdict | rows with `cancel_source IN ('refund','chargeback')` and `cancel_settled_at IS NULL` | ~10 minutes    |
| Drift   | unchanged                                                                            | 6 hours + boot |

The verdict pass normally matches zero rows and exits without a single provider
call, so the cadence is nearly free at runtime. It is still a second scheduled
job in the worker composition root and carries its own smoke.

This is bundled rather than deferred deliberately: the fix's entire value is
"the customer can buy again", and a six-hour wall undermines it enough that
shipping without this would be the ship-the-partial pattern the founder has
rejected before.

### 5. Fail closed

If the provider is unreachable, settlement is never written and the customer
stays blocked. That is the direction the founder's answer chose — never double
charge, accept a wait. A read failure is never grounds for a write, consistent
with the existing rule in `billing-provider.interface.ts`.

---

## End-to-end behaviour after the change

| Moment            | Today                                  | After                                                                    |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Refund issued     | access stops instantly                 | unchanged                                                                |
| Immediately after | cannot buy for the rest of the period  | cannot buy — awaiting provider confirmation                              |
| Provider approves | nothing; still locked to period end    | can buy again, within ~10 min                                            |
| Provider rejects  | locked out regardless                  | original plan is restored; no second purchase existed to collide with it |
| Ordinary cancel   | keeps access to period end, cannot buy | unchanged — correct, they still hold the plan                            |

---

## Testing

- A refunded-and-settled row does not block checkout, **and** the resulting
  `subscription.created` inserts without violating
  `subscriptions_one_live_per_workspace`. This is the assertion that would have
  caught the rejected design; a guard-only test passes against a broken system.
- A refunded-but-unsettled row still blocks, with the new code rather than
  `SUBSCRIPTION_EXISTS`.
- An ordinary provider cancel still blocks.
- A refuted verdict clears `cancel_settled_at` and the row blocks again.
- The sweep writes `cancel_settled_at` only on provider confirmation, and never
  from `adjustment.created`.
- The verdict pass selects only unsettled-verdict rows and makes no provider
  call when there are none.
- Migration applies and reverts cleanly; the replacement index is present with
  the new predicate.

---

## Out of scope

- **`adjustment.updated` handling.** The adapter has no case for it today — it
  falls to `default:` and is recorded as `ignored`, so the existing follow-up
  advising the Paddle dashboard toggle is incomplete and buys nothing without
  adapter code. At a 10-minute verdict cadence the remaining gain is marginal.
  The follow-up should be corrected to say so.
- **Customer-facing copy** for the new refusal code (D220 design freeze).
- **The `past_due` dunning-expiry variant** of the same lockout — worth
  checking for and logging, not fixing here.
- **History of the refund policy itself.** "Money back means the service stops"
  is settled and is not revisited.

---

## Open question for the founder

This is unbuilt work someone will ask "is it built yet?" about, so by the
2026-07-28 ratified split it takes a **D-number** (D253) rather than an ADR, and
the plan mirror plus `IMPLEMENTATION-LOG.md` are appended in this same PR per
the Class-B rule. The durable _rule_ it establishes — guard, projector and sweep
must share one definition of "live" — may deserve its own ADR once shipped.
Flagged rather than decided.
