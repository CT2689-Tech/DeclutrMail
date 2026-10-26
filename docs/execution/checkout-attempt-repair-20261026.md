# Checkout attempt repair — local implementation and verification

Status: local implementation, not merged or deployed. No live billing changes.
Integration owner: root. Worktree: `checkout-attempt-repair-20261026/DeclutrMail`.
Branch: `codex/checkout-attempt-repair-20261026`.
Base: `faed5664eb95679fb352f1ae5582090ea8256aae`.

## Existing PR integration

- [#1131](https://github.com/CT2689-Tech/DeclutrMail/pull/1131), inspected at
  `a1d98e13c1e11e84e9961201c3e415d1064ca52e`: imported useful plan-kind,
  Pass reconciliation and truthful status work into this isolated candidate.
- [#1139](https://github.com/CT2689-Tech/DeclutrMail/pull/1139), inspected at
  `d97a36d8c8eaa8330ebb747c78c831bc9565e610`: imported its net changes over
  #1131. Kept exact transaction classification and tests. Replaced automatic
  release on an unpaid snapshot with retained attempt identity and safe resume.
- Existing PR branches remain untouched. This candidate owns the shared billing
  service, adapter, projector, contracts, schema and screen. Use one integration
  owner; do not merge all three overlapping patches independently. Before any
  eventual PR, refresh the two heads and reconcile newly added work.

## Resulting behavior

See [ADR-0047](../adr/0047-durable-checkout-attempts.md). The server records the
purchase before provider creation, binds exact identity, retains uncertain outcomes,
and resumes the same transaction. Cancellation is separately gated and confirmed
by fresh provider readback. Payment evidence survives stale checks and cancellation
races. Both webhooks and recovery use the same grant projector. A Pass can fulfill
beneath complimentary Pro; the current-plan card still shows Pro Complimentary.

Legacy unknowns offer check/support and retain their evidence; customer assertions
and TTLs cannot reopen a payable checkout. Existing Razorpay creation remains on
its own path; no new INR purchase readiness or provider revocation is claimed.

## Verification and limits

Automated regression suites cover exact ownership/product/quantity/currency,
duplicate creation, unknown provider creation, lost webhook recovery, stale
snapshots, cancellation/payment races, rollback flags, Pass beneath complimentary
Pro, browser identity changes, late callbacks, bounded polling and newer local
reservations. A raw signed controller test runs create through payment projection
and dedup, with an invalid-signature negative control. Adapter HTTP tests use
synthetic fixtures; they are not real Paddle evidence.

Schema/SQL is exercised on disposable PostgreSQL 17, including forward migrations,
empty rollback and refusal to drop retained attempts. Independent backend,
frontend and schema reviews drove fixes before final checks. Synthetic Storybook
screens are checked in the built-in browser. Final command results are recorded
below after completion.

No real Paddle sandbox purchase/replay/refund rehearsal was performed: a sandbox
provider connector is unavailable in this session. Neither live credentials nor
provider dashboards were used. `BILLING_CHECKOUT_ATTEMPTS_ENABLED` and
`BILLING_CHECKOUT_CANCEL_ENABLED` remain absent/off; no deployment manifest or
secret was changed. Do not activate either flag based only on fixture tests.

## Eventual release sequence (not performed)

1. Reconcile current PR heads and obtain review of this combined candidate.
2. Rehearse exact transaction creation, resume, cancel and saved-payload replay,
   webhook recovery, refund and cleanup in Paddle sandbox. Preserve failure
   evidence. Verify copied capabilities cannot be used to evade stopped state.
3. Apply additive migration 0098 before API/worker readers. Keep flags off while
   rolling out code. Legacy evidence remains retained.
4. Enable creation and cancellation separately only after readiness approval and
   the production cutover procedure. Recheck browser/API/provider/DB outcomes.
5. Roll back by disabling creation/cancellation while retaining recovery readers
   and schema. Never drop a populated evidence table. Deletion safeguards remain.

## Final local checks

- API billing/webhook suites: 815 passed; the four opt-in real-PostgreSQL refund
  and concurrency cases then ran separately against an owned loopback-only
  PostgreSQL 17 container and all passed (819 total API tests).
- Billing UI: 480 passed, including stored return destination after exact
  fulfillment and protection against historical purchase navigation.
- Shared contracts: 955 passed. Database: 117 passed, including schema/SQL
  parity, migration round trip, RLS and populated rollback refusal.
- Workspace type checking passed; API and web rechecks after final test additions
  passed. Repository lint passed with six pre-existing warnings; changed-file
  lint passed without warnings. Formatting and whitespace checks passed.
- Next.js production build and all 49 route bundle budgets passed. Production
  Storybook build passed. Built-in browser synthetic smoke verified open Pass,
  cancellation, and paid-awaiting-access while Pro Complimentary remains visible.
- Disposable PostgreSQL 17: all 97 forward migrations applied; server-only RLS
  was enabled with no public policies; a nonowner with explicit INSERT privilege
  was still denied. Empty rollback passed; populated rollback refused and kept
  the purchase row. No production database was accessed.
- Independent backend, schema and frontend reviews completed. Fixes included
  stopped-state races, exact subscription admission, renewal metadata, RLS,
  rollback locking, delayed create responses and browser identity isolation.

The initial broad runs found an obsolete cancellation-state expectation, the new
table missing from the schema inventory test, and a support-address omission;
these were fixed. One shared-suite retry hit its glossary scanner timeout under
concurrent builds; rerunning with one worker passed. No product test assertions
were weakened to permit uncertain payment release.
