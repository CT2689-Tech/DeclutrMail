# Billing prorated refund audit — 2026-10-04

## Flow contract

Scope: a sandbox subscription upgrade followed by a full transaction refund.
Paddle's verified webhook and fresh provider read are authoritative. A pending
full refund retains access through the existing grace window; approval ends the
subscription entitlement, rejection lifts the pending verdict, and duplicates
produce no additional effect. A genuine partial refund retains access.

This follows existing refund policy. Pricing, settlement policy, signature
verification, production credentials and customer data are unchanged. The audit
uses an isolated local database, synthetic account and Paddle sandbox; no live
payment or production account mutation was performed.

## Reproduced defect and repair

A real sandbox full refund of a prorated upgrade returned adjustment-level
`type: full`, approved status and a `partial` item covering the entire collected
transaction total. The shared classifier ignored the overall type, so pending
and approved webhooks and reconciliation all treated it as a partial refund.

Honor explicit adjustment-level full coverage before the existing item fallback.
Keep genuine partial-item refunds ignored, including mixed-item shapes. Retain
the existing all-full-item compatibility, unreadable-item and chargeback rules.
[Paddle defines full as the entire transaction grand total](https://developer.paddle.com/api-reference/adjustments/create-adjustment/).

Before: the upgraded subscription can retain access after a full refund because
no refund verdict is recorded. After: pending, approval and rejection follow
the existing refund lifecycle for that provider-reported full transaction.

## Verification and limits

- Negative control: new coverage against the unchanged classifier produced
  eight failures and 124 passing tests across adapter and webhook integration.
- Adapter cases cover created, approved, pending and rejected events plus
  approved, pending, rejected and reversed reconciliation reads.
- Database integration exercises rejection recovery, approved settlement,
  workspace Free entitlement and duplicate handling. Existing partial-refund
  controls remain in the same suites.
- Full billing tests, workspace typecheck/lint, independent architecture and
  adversarial lifecycle review: pending at initial record creation.
- Actual first purchase and upgrade refunds both settled. The original purchase
  refund made the browser show Free, so it masks the upgraded-only terminal
  outcome; do not present that as independent runtime proof of the new fix.
- Already-processed ignored events do not automatically replay. This change
  alone does not establish historical repair.

## Separate launch blocker and opportunities

The approved original refund made the local row canceled/Free while the provider
remained active with no cancellation schedule. The verdict enforcement pass
excludes canceled rows; the settled-refund watcher only alerts. Provider renewal
convergence remains an open blocker and needs a separately verified repair.

Useful billing improvements observed in the broader sandbox pass: disclose
immediate Free access before pause; show the actual refund grace deadline;
explain complimentary grant floors when buying a lower plan; and surface
provider-confirmed cancellation/refund state and freshness without promising
unverified renewal outcomes. These are tracked independently of this classifier
repair.

Integration owner: current flow-audit chat. Owned files: Paddle adapter and its
existing fixture, adapter and webhook integration tests, plus this audit record.
Dependency: current main containing the deferred plan-change repair from PR886.
No migrations, shared contracts, checkout SDK changes or infrastructure changes.
