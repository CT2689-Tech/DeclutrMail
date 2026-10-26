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

The October 26 real Paddle sandbox rehearsal below exercised an exact unpaid
transaction, a canceled replay, a Backlog Pass test-card purchase, signed webhook
projection and full refund. It used a synthetic checkout page and disposable
database, not the authenticated app route or a deployed release. No live provider
credential or service was used. `BILLING_CHECKOUT_ATTEMPTS_ENABLED` and
`BILLING_CHECKOUT_CANCEL_ENABLED` remain absent/off in runtime; no deployment
manifest or production secret was changed.

## Remaining release sequence (not performed)

1. Reconcile current PR heads and obtain review of this combined candidate.
2. Rehearse the authenticated app/API path and background recovery on a disposable
   sandbox workspace, including the subscription checkout and race cases. The
   provider adapter, Pass checkout/refund and canceled replay were exercised below;
   they do not certify the full app route or subscription path.
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
- After the real-provider recovery correction, the API billing suite passed again:
  816 passed, four skipped integration cases, across 27 passing test files; API
  typecheck, changed-file lint, formatting and whitespace checks passed.

The initial broad runs found an obsolete cancellation-state expectation, the new
table missing from the schema inventory test, and a support-address omission;
these were fixed. One shared-suite retry hit its glossary scanner timeout under
concurrent builds; rerunning with one worker passed. No product test assertions
were weakened to permit uncertain payment release.

## Continued sandbox access check — October 26, 2026

The previously authorized read-only Paddle sandbox Keychain credential still works.
A direct read of the exact October 24 synthetic Backlog Pass transaction returned
HTTP 200: `completed`, API origin, one USD item, one `captured` payment and no
subscription. An earlier known canceled checkout returned HTTP 200: `canceled`,
web origin, one item and an empty payments list. These are historical provider
records and confirm the response shapes used by the adapter; neither record
contains the new versioned attempt binding. No provider write or new payment was
performed.

No Paddle provider tools are exposed in this chat. The working local credential
has six read permissions and no writes; the configured GitHub Sandbox API-key
secret was last updated July 20 and was recorded expired in the October 24 access
audit. The current session has no sandbox write key. This prevents a real checkout,
owned transaction cancellation/replay, signed webhook and refund rehearsal on the
new code. The flags remain off. A temporary sandbox-only write key, stored in an
approved credential store, is needed before that verification can finish. Never
copy a key into chat, reports or repository files.

The authenticated built-in browser also opened DeclutrMail's Paddle **Test mode**
Authentication page. The historical rehearsal keys are revoked, the July shared
key is expired, and the October 24 invoice key is read-only. An older active
sandbox key with write permissions exists in the account, but its value is masked
and is not available in this task's credential stores; it was not rotated,
revealed or reused. The blank New API key form is open for a human credential
handoff. No form values were entered and no key was created.

## Real Paddle sandbox rehearsal — October 26, 2026

The preceding access paragraph is the state **before** the user created a new
seven-day sandbox key. The key was stored in macOS Keychain for this test; no key
value was added to the repository, report or CI secrets. The existing sandbox
client token and a temporary notification destination were used only in Test
mode. The new key read all five active products, 11 active prices and 21 existing
notification destinations before any provider write. The temporary destination
was disabled and independently read back inactive at the end.

A first owned, unpaid Backlog Pass transaction exposed a real bug in the new
recovery scan: `created_at[gte]` was silently ignored by Paddle, causing the
bounded scan to return uncertain in a populated account. The adapter now uses
Paddle's `created_at[GTE]` spelling on the initial and subsequent pages. A
regression test checks the parameter. The next real transaction passed exact
read, wrong-owner rejection, exact recovery and canceled readback; all owned
unpaid artifacts were confirmed canceled.

The built-in browser opened the same Paddle Billing v2 overlay with its stored
transaction ID. The user completed a Test Mode Backlog Pass purchase using
Paddle's public test card: $19.00 catalog price plus $1.69 virtual tax. Paddle
returned `completed` with a captured test payment. The temporary destination
received cryptographically valid, timely `transaction.completed`,
`adjustment.created` and `adjustment.updated` events for that exact transaction.
The app adapter mapped the real completed event to the signed workspace and
attempt. In a disposable PostgreSQL 17 database migrated through 0098, the
canonical webhook projector marked the attempt fulfilled, inserted exactly one
Pass grant, rejected a duplicate event as already processed, ignored the pending
refund and revoked that grant on the approved full-refund event. Independent
provider readback confirmed the full adjustment was approved and the destination
inactive. The disposable database and tunnel were stopped; raw event bodies were
removed after the sanitized checks.

Paddle.js also refused to reopen the separately canceled transaction from its
saved ID (`checkout.error` and a non-payable error page). This is sandbox evidence
for that exact canceled artifact. It does not prove all copied capabilities or
late payment races are impossible. The authenticated DeclutrMail app, background
worker, subscription offer and production activation remain unverified. The
overlapping PR heads #1131 and #1139 were rechecked on October 26 and remained
open at the same commits recorded above; neither was edited, merged or deployed.
