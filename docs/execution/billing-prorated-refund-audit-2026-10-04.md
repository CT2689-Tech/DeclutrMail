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
- Focused adapter/database-webhook suites: 132/132 passed. Workspace typecheck,
  lint, formatting and diff checks passed; six existing lint warnings remain.
  Independent architecture/adversarial review found no blockers. Applicable PR
  CI, including both API shards, passed on the implementation commit.
- A broad local billing run stalled and was stopped; it is not a passing run.
- Fresh read of the actual approved full/partial-item sandbox adjustment maps to
  `refund_settled` using the repaired adapter.
- Signed HTTP smoke through the actual API controller/projector and local
  PostgreSQL, with candidate adapter hash verified: actual provider adjustment
  data in synthetic event envelopes exercises partial control → created grace
  (Pro retained) → full approval (Free/canceled) → duplicate (no additional
  effect). Exactly three processed event rows were observed. Material fixture
  state was restored and test events removed; the local workspace update
  timestamp advanced through its trigger. No original refund was used to settle
  this isolated upgraded-refund sequence. This is provider-shaped replay,
  not a fresh upgrade-only purchase or provider-issued event delivery.
- Actual first purchase and upgrade refunds both settled. The original purchase
  refund made the browser show Free, so it masks the upgraded-only terminal
  outcome; do not present that as independent runtime proof of the new fix.
- Already-processed ignored events do not automatically replay. This change
  alone does not establish historical repair.

## Separate launch blocker and opportunities

The approved original refund made the local row canceled/Free while the provider
remained active with no cancellation schedule. The verdict enforcement pass
excludes canceled rows; the settled-refund watcher only alerts. Provider renewal
convergence is repaired separately in PR889: the actual sandbox service restored
the same old cancellation boundary without changing local terminal state, and
a repeat sweep made no write. Integration/deployment remain separate states.

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
