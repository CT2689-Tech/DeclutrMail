# ADR-0027: Billing presentation state — one derived story per screen

- **Status:** Accepted
- **Date:** 2026-07-26
- **Deciders:** founder + Claude session (launch blocker A6, audit
  `docs/execution/product-launch-audit-2026-07-25.md`)
- **Related D-decisions:** D119, D117, D118, D120, D126, D202

## Context

The billing screen let each surface interpret the raw
`GET /api/billing/subscription` row for itself. The read carries two
independent facts — the workspace's resolved **entitlement tier** and
the latest provider **subscription row** — and when they disagree
(entitlement `pro` + a paused `plus` row) the surfaces contradicted
each other on one screen: the current-plan card said "Pro · $19/mo"
(a `quotedPlanPrice` nobody is charged), the paused notice said "Your
Plus subscription is paused … your workspace is on Pro", the founding
banner read its provider off whatever row was latest, and the plan
picker keyed its lock and change-vs-checkout routing on the row's
status alone. The card already had the correct predicate
(`subBacksTier`) but only four of its own fields used it — every other
surface ignored it. This is the house UI-truth defect class: surfaces
asserting what they do not know.

The server compounded it: `getSubscription` returned the latest row by
`updated_at`, any status, so with more than one row a non-granting row
could shadow the granting one.

## Decision

One pure function, `deriveBillingViewState` in
`apps/web/src/features/billing/billing-model.ts`, is the single
interpretation of the billing read. It returns a discriminated union:

```
BillingViewState =
  | { kind: 'loading' }
  | { kind: 'billing_dark'; entitlementTier }            // BILLING_DISABLED code
  | { kind: 'read_failed'; error }
  | { kind: 'payment_pending'; pending } & BillingPlanView
  | { kind: 'plan' } & BillingPlanView
  | { kind: 'unknown' }                                  // malformed 200 payload

BillingPlanView = {
  entitlementTier;                                       // the ONLY nameable "current plan"
  backing:    {state:'none'}
            | {state:'active'|'past_due'|'cancel_scheduled'; sub};
  nonBacking: null | {reason:'paused'|'canceled'|'tier_mismatch'; sub};
  scheduledChange;                                       // only ever off a BACKING sub
  foundingMember;
}
```

**Backing** = `sub.tier === entitlementTier && status ∈ {active,
past_due}` — the server's granting set plus the tier match. Only a
backing record may supply the current plan's price, renewal, status
note, provider/currency, or the picker's change-plan routing. Every
other row is a **non-backing record**: real and actionable
(resume/cancel), never a source of plan facts. `tier_mismatch` marks a
row whose grant differs from a paid entitlement granted elsewhere
(including a paused row the entitlement outranks); its resume copy
states the real consequence — the webhook recompute
(`billing-webhook.service.ts` `recomputeWorkspaceTier`) re-grants from
subscription rows and can move the workspace off its current plan.

Supporting rules, all encoded in the derive layer or its direct
consumers:

- No backing record on a paid tier ⇒ **no price claim** ("Included
  with your workspace"); the `quotedPlanPrice`-as-current-price
  headline is removed.
- "Free forever — no card on file" renders only when `nonBacking ===
null` as well — a paused/ended record means the provider may hold a
  card.
- A non-backing `past_due` row still surfaces its dunning warning
  through the non-backing notice.
- A `canceled` row renders a truthful, entitlement-aware
  "subscription ended" line (replacing `statusNote`'s dead branches).
- The read is Zod-parsed at the wire (`BillingSubscriptionSchema`);
  a malformed 200 becomes the `unknown` state — never
  `TIER_MANIFEST[garbage]`, never an invented price or status.
- `billing_dark` keys on the D202 envelope code `BILLING_DISABLED` via
  `apiErrorCode()` (`apps/web/src/lib/api/client.ts`), never "any 503"
  (MISTAKES.md 2026-07-26).
- The existing pending-payment lock machinery is unchanged; it routes
  through the union as `payment_pending`, which outranks read errors
  (the error state's "no charge was made" would be false mid-payment).

Server side, `getSubscription` serves the granting row when one exists
(active/past_due, newest first), else the most recent non-granting
row — a stale row can no longer shadow the one that grants.

## Alternatives considered

- **Patch each surface to use `subBacksTier`:** rejected — the defect
  recurred precisely because the predicate lived beside five surfaces
  that could ignore it; a sixth surface would ignore it again.
- **Return both rows (granting + latest non-granting) in the DTO:**
  rejected for now — every observed defect involves a single row plus
  the entitlement; the one-slot contract stays minimal and the derive
  layer classifies it. Revisit only if a real state needs both rows at
  once (would be a deliberate contract change, with audit B7's unique
  index).
- **Server-computed view state:** rejected — the FE also owes states
  the server cannot know (pending lock, malformed payload), and the
  pure client derive is unit-testable per discriminant.

## Consequences

### Positive

- Exactly one plan can be named "current" per screen, by construction.
- Every discriminant has a unit test and a Storybook story; the A6
  repro (Pro + paused Plus) is pinned by a regression test.
- A comped/entitled-elsewhere workspace regains its plan picker
  instead of being locked by a stale non-backing row.

### Negative

- A checkout started while a non-backing paused/past_due row exists is
  refused server-side (`SUBSCRIPTION_EXISTS` counts paused rows) and
  surfaces as the inline 409 message — an honest dead end for the rare
  comped-workspace-with-stale-row case, accepted over locking the
  picker on a plan the row does not grant.
- The "stays on X" future claims were dropped from cancel copy for
  non-backing rows: the recompute can erase a manually granted tier,
  so copy states present facts only.

### Neutral

- `statusNote`/`canCancel` are replaced by `backingStatusNote` and the
  backing-state check (prelaunch — superseded code removed per D245).
- `PausedSubscriptionNotice` generalizes to
  `NonBackingSubscriptionNotice` (testid
  `non-backing-subscription-notice`).
