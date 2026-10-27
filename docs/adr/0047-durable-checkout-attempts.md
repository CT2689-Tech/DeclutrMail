# ADR-0047: Retain exact checkout identity through recovery

- Status: Accepted for implementation; activation pending sandbox evidence
- Date: 2026-10-26
- Integration owner: root on `codex/checkout-attempt-repair-20261026`
- Related: D249, ADR-0040, ADR-0044, ADR-0046

The founder authorized implementation of the checkout repair plan, accounting for
PRs #1131 and #1139, with no merge, deployment or live billing changes. This
extends ADR-0046's server-created transaction design using the existing Paddle
Billing v2 adapter and Paddle.js overlay. It does not authorize activation.

A purchase has a durable, workspace-owned UUID before the provider call. Its
signed binding includes the workspace, attempt and offer. The server retains the
exact transaction, catalog price, currency and eventual subscription. Creating,
open, payment-in-progress, stopping and unknown attempts block another checkout;
paid evidence also blocks new creation until its own fulfillment resolves. An
unrelated subscription or higher complimentary entitlement cannot settle it.

Create reserves under the workspace lock and rechecks subscription/deletion
eligibility there. Resume uses the same unpaid transaction and rechecks the
version and eligibility under that lock. Unknown creation is recovered only by a
complete, bounded scan for the exact signed identity; it never causes a second
create. Reads and recovery are available for retained attempts even when creation
is disabled again. Unpaid-at-read-time is not revocation.

Commands use attempt UUID plus expected version and locked compare-and-set as
their domain idempotency mechanism. Create reserves the UUID before external work;
resume reuses its transaction; cancel enters `stopping` before provider work.
This deliberately does not add the generic response replay table: replaying an
old response containing checkout capabilities or a stale terminal assertion would
be unsafe. Duplicate commands must inspect the retained current state. Provider
HTTP stays outside database transactions. Cancellation requires its separate flag,
an owned unpaid read, and a fresh stopped readback. Paid evidence always wins a
race and remains sticky, including a late valid payment after local cancellation.

Payment and subscription recovery use the canonical webhook projector. New
subscription admission must match the paid attempt's subscription identity;
existing subscription renewals retain their established path. Fulfillment tests
this purchase's transaction grant or granting subscription, independent of the
highest workspace entitlement. Browser completion only requests confirmation.

The UI binds storage and callbacks to the exact attempt and workspace. A stale
result cannot clear a newer reservation or navigate another upgrade. It polls
with backoff for at most 15 minutes and retains explicit check/support afterward.
The background sweep recovers bounded batches without browser presence.

Legacy uncertain checkout claims are retained beyond their historical expiry.
Neither TTL, a user assertion, an empty email search nor an unpaid snapshot
releases them. Exact reconciliation facts cannot override signed attribution.
Deletion retains the existing checkout-capability support review: stopping one
transaction does not prove copied price-based payloads have been revoked.

The new table has server-only row-level security enabled with no public policies.
Migration 0098 is additive and must precede this application version. Roll back
the creation flag first while retaining the schema/readers/worker. Its destructive
rollback locks the table and refuses if any purchase evidence exists. Activation
requires real sandbox purchase/webhook/refund, saved-checkout replay after cancel,
late-payment races and cleanup evidence. Separate explicit production cutover and
Paddle-live write approval remain required.

Provider contract references checked during implementation:
[Paddle transaction update/cancel](https://developer.paddle.com/api-reference/transactions/update-transaction/)
and [Paddle.Checkout.open](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/).
These describe supported operations; they are not evidence of this account's
sandbox permissions or saved-payload revocation behavior.
