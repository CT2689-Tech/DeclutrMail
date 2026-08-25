# ADR-0033: One definition of "live" — the subscription slot is gated by five surfaces, and they change together

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** founder, Claude (agent), plus four adversarial review passes on
  the D253 design
- **Related D-decisions:** D253 (a refunded customer can buy again), D249
  (billing reconciles against provider truth), D121 (no trials; 30-day
  money-back guarantee)

## Context

A workspace may hold one live subscription at a time. Nothing in the codebase
says what **live** means. Five surfaces each decide it independently, and at
`f77507ab` — the base commit of the D253 branch — they did not use the same
predicate:

| Surface               | Where (at `f77507ab`)                                                                                                       | Its predicate                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Checkout guard        | `apps/api/src/billing/billing.service.ts:89-97` (`createCheckout`)                                                          | `status IN ('active','past_due','paused')` → 409 `SUBSCRIPTION_EXISTS` / `SUBSCRIPTION_PAUSED_BLOCKS_NEW` |
| DB unique index       | `packages/db/migrations/0051_billing_reconciliation.sql:72` (`subscriptions_one_live_per_workspace`)                        | `status IN ('active','past_due')` — `paused` **excluded**                                                 |
| Projector             | `apps/api/src/billing/billing-webhook.service.ts:526-535` (terminal-canceled floor, `billing.webhook.canceled_is_terminal`) | `canceled` is absorbing — any later payload moving a row out of it is ignored                             |
| Reconciliation sweeps | `apps/api/src/billing/billing-reconciliation.service.ts:360` (drift), `:453` (verdict), `:696` (workspace)                  | `status IN ('active','past_due','paused')`                                                                |
| Frontend plan picker  | `apps/web/src/features/billing/billing-model.ts:258` (`nonBackingBlocksNewCheckout`)                                        | `status !== 'canceled'` — the complement of terminal, not the server's set                                |

Three distinct predicates for one concept. Some of the difference is
deliberate — the guard is intentionally stricter than the index, because a
`paused` row the provider could still resume must block a second checkout even
though it does not occupy the index slot. That is a good decision written down
nowhere, which is the point: the differences are indistinguishable from drift,
and the picker's `!== 'canceled'` matches the server only by the accident that
`canceled` is currently the sole terminal status.

The cost surfaced as D253. A full refund ends entitlement immediately but leaves
the row `active`, because the provider schedules nothing on a refund — our own
sweep sends the cancel later. All five surfaces then read that dead row as the
workspace's live subscription, and the refunded customer cannot buy again until
the period they already paid for elapses: up to a year on annual, with no
in-app route back.

> **Amended 2026-08-25 ([REVERSAL on D253 §1], PR #633).** "A full refund ends
> entitlement immediately" was true when this ADR was written and is not any
> more. Entitlement now ends when the refund SETTLES, clamped by
> `LEAST(now() + 7 days, current_period_end)` until then, because
> `adjustment.created` fires while a live Paddle refund is still
> `pending_approval` — so the old timing revoked on a decision the provider had
> not made, while §§3–4 freed the plan slot only on settlement. The gap between
> the two was a customer with no product and no way to buy one.
>
> **Nothing below this line changes.** The argument this ADR makes is about
> which rows count as live and why one definition must serve all five surfaces;
> the settled-refund flip to `canceled` and the terminal-canceled floor are
> untouched. Only the moment entitlement stops moved, and it moved TOWARD the
> flip — the two writes now happen in the same transaction, which strengthens
> the singleton this ADR exists to protect rather than weakening it.

The defining property of that bug is that **no single-surface change fixes
it**:

- backend-only leaves the picker locked, so the fix never reaches the customer;
- frontend-only walks the user into a guaranteed dead-end 409;
- relaxing the guard without the index turns a clear 409 into a unique-violation
  on the repurchase insert;
- relaxing the index without the projector's terminal floor lets the dead row
  re-enter the live slot on a later provider payload.

That is not a billing bug. It is the signature of one concept maintained in five
copies.

## Decision

**The five surfaces above are one contract. A change to what counts as a live
subscription is not in scope until every one of them has been checked against
it in the same change — including the frontend.**

Four rules follow:

1. **Name the roster before writing code.** The table above is the current
   roster. A liveness change that has not been walked against all five entries
   is unscoped, not merely unreviewed. Adding a sixth reader means adding a row
   here.
2. **Deliberate differences must be stated, not inferred.** The predicates are
   not required to be identical — the guard/index `paused` difference is
   correct. They are required to be derived from one written definition, with
   any divergence and its reason recorded.
3. **Prefer moving a row to a status all five already agree on, over teaching
   one surface a new exception.** D253 flips a settled-refund row to `canceled`
   rather than adding a `cancel_settled_at` column and narrowing the index,
   precisely because `canceled` is the one value every surface already treats
   the same way. No migration, no index change, no new exception, and the
   singleton the rest of the module assumes is preserved.
4. **The assertion that proves a liveness change is the follow-on write, not the
   guard.** "Checkout no longer returns 409" passes against a system whose
   unique index will still reject the insert. The insert is the assertion.

## Alternatives considered

- **A `cancel_settled_at` column plus a narrowed index predicate — the D253 v1
  design:** rejected by three independent reviews, with a fourth finding two
  further holes in its successor. Every failure was the same shape, a partial
  roster:
  - _It would have shipped green and changed nothing._ The settlement write was
    to live inside the verdict loop, which short-circuited on
    `provider.cancelAtPeriodEnd` before reading provider facts. Our own
    enforcement is what sets that flag, so the row was skipped forever after the
    first pass.
  - _It broke a singleton six readers depend on._ Leaving the dead row `active`
    beside a repurchase means two rows match every
    `orderBy(desc(subscriptions.updatedAt))` reader — six of them in
    `billing.service.ts` alone at `f77507ab` (`:266`, `:345`, `:450`, `:540`,
    `:649`, `:1041`). The drift sweep bumps `updated_at` on the dead row, so the
    dead row wins: `getSubscription` (`:245`) would serve the refunded plan to a
    paying customer, and Cancel / Pause / Change-plan would fire at the dead
    subscription id while the live one kept billing.
  - _It did not reach the customer._ The picker is keyed on status, and its own
    comment says so — "Only a canceled row leaves the slot free"
    (`billing-model.ts:255`). A backend-only change leaves the plan picker
    locked and the stated value of the fix never arrives.
  - _It narrowed a race instead of closing it._ The chargeback-reversal path
    still reached the revoke write from a live webhook with no settled filter
    and no unique-violation handler.
- **Relaxing the checkout guard alone:** rejected — the unique index still
  rejects the repurchase insert, converting an explained 409 into a write
  failure the customer cannot act on.
- **Letting the picker offer checkout while the server still refuses:**
  rejected — it manufactures a guaranteed dead-end 409, the UI-truth defect
  class this codebase already keeps relearning.
- **A shared `isLive(status)` helper as the whole answer:** not rejected, but
  insufficient alone. The index predicate is SQL inside a migration and cannot
  import it, and the picker is in a different workspace package. The obligation
  has to be a reviewed roster, not only a function.

## Consequences

### Positive

- The failure mode where a fix is structurally impossible from one surface
  becomes visible at design time rather than at the third review.
- D253's implementation shape falls out of the rule instead of being argued to:
  flip to a status all five already agree on, and one write frees the guard, the
  index and the picker together.
- The frontend stops being an afterthought on billing-state changes — it is
  named in the contract.

### Negative

- Liveness changes are wider by construction. A one-line backend change now
  carries a five-surface walk and, often, a frontend diff.
- The roster is hand-maintained. A sixth reader added without updating this ADR
  silently weakens the rule — the same maintenance risk any written invariant
  carries.

### Neutral

- The `paused` difference between the guard and the index is left exactly as it
  is. It is pre-existing and deliberate; reconciling or documenting it further is
  its own change with its own smoke.
- This ADR constrains how liveness changes are written. It changes no predicate
  by itself.

## Implementation notes

- The five entries in the Context table are the walk list. Line numbers are
  pinned to `f77507ab` and will drift; the stable anchors are `createCheckout`,
  `subscriptions_one_live_per_workspace`, the `canceled_is_terminal` floor, the
  three `inArray(subscriptions.status, …)` selects in
  `billing-reconciliation.service.ts`, and `nonBackingBlocksNewCheckout`.
- A checkout refusal that is neither "you already have one" nor a hard failure
  needs its own error code **and** entries in the two hand-maintained frontend
  registries in `apps/web/src/features/billing/plan-picker.tsx` —
  `STALE_BILLING_READ` (`:111` at `f77507ab`) and `PRE_CLAIM_REJECTIONS`
  (`:120`). A code absent from the latter is treated as an ambiguous post-claim
  outcome and shows a payment reservation for a checkout that never reached a
  provider — a sixth place the liveness story leaks.
- Razorpay reaches none of this today: its adapter maps no refund or chargeback
  event, so no Razorpay row carries a verdict. That scope is pinned by a test,
  not by an assumption.

## References

- D253 — _A refunded customer can buy again_
  (`docs/execution/Implementation-Plan.md`)
- `docs/handoffs/2026-08-13-d253-refund-lockout-design.md` — the design this
  rule was extracted from, including the four review rounds
- [ADR-0027](0027-billing-presentation-state.md) — billing presentation state,
  one derived story per screen (the read-side counterpart to this write-side
  rule)
- D249 — billing reconciles against provider truth, not customer memory
