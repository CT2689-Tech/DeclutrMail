# ADR-0044: Upgrade refunds, permanent Founding allocation and billing notices

- **Status:** Accepted policy; implementation and release evidence tracked separately
- **Date:** 2026-10-10
- **Decider:** founder
- **Related decisions:** D117, D118, D120, D126, D162, D165, D253, D260

## Decision

Account deletion remains blocked until billing is verified stopped; it never automatically cancels or refunds.

A full refund of an upgrade-only charge reverses only that upgrade. Preserve the previous paid plan's remaining access and renewal terms using exact transaction/prior-plan evidence and a verified no-charge restoration. Pending/rejected refunds do not reverse access. Chargebacks and customer cancellation have precedence. Ambiguous evidence or a later renewal/plan change requires support, rather than guessing. Sandbox lifecycle rehearsal precedes release. This amends the whole-subscription refund policy only for the upgrade transaction; ordinary subscription refunds retain D253.

An allocated paid Founding seat stays used after refund, cancellation or account deletion. Retain one append-only provider/subscription allocation reference without cascading workspace/user foreign keys or email/Gmail data. Count surviving legacy allocations and durable references once under the existing cap lock. Preserve legacy references before deleting their rows. Existing purchase-state allocation semantics remain; grants, payment-method verification and unpaid trials cannot allocate a new seat. Erased historical rows cannot be reconstructed from the surviving local database.

Providers own payment receipts and invoices. DeclutrMail owns notices about cancellation, pause, app-access deadlines and complimentary-grant expiry. Use the existing transactional outbox, email suppression and idempotent delivery. Recheck current account/deadline/grant state at delivery and describe the actual resolved access, including complimentary floors. No historical email flood or duplicate payment receipts. Provider notification settings must be checked before enabling overlapping lifecycle notices.

## Remaining decisions

India seller/GST/invoice readiness, provider-enforced reusable-checkout expiry/revocation and any prospective grant-duration or inbox-disconnection changes remain unresolved. These approvals do not authorize live provider exploration, new checkout architecture, real test purchases or financial writes outside the explicit cutover boundary.
