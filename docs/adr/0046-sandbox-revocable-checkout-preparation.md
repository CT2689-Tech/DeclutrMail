# ADR-0046: Prepare provider-revocable checkout in sandbox

- Status: Accepted for sandbox preparation only by founder on 2026-10-10
- Related: D117, D118, D249, ADR-0044, ADR-0045
- Integration owner: root; isolated billing checkout rehearsal branch

The founder approved preparing and rehearsing a server-created Paddle transaction
with the existing Paddle Billing adapter and Paddle.js overlay. This resolves the
architecture prerequisite in AGENTS.md for sandbox preparation. It does not
authorize replacing production checkout, changing live providers or clearing a
real account's deletion hold.

Prepare a distinct transaction before presenting a new sandbox checkout. Record
the attempt before the provider call and retain its provider reference durably.
An uncertain create is never retried blindly. Reconciliation must identify the
exact signed attempt, prove that the bounded scan is complete, and preserve the
hold on ambiguity, mismatches, provider outages or possible orphan creation.

Cancellation applies only to this rehearsal's owned, unpaid transactions. Paid,
completed or subscription-linked cases keep their hold and use the separate
subscription process. Fresh terminal provider readback is necessary, and actual
saved-checkout replay must prove that cancellation prevents payment. Race and
late-webhook tests must preserve payment attribution and the billing hold.

Copied price-based payloads and legacy Razorpay links remain separate capabilities.
Local expiry, HMAC rejection and a new transaction ID are not provider revocation
proof. Replay them and retain unproven holds. New INR purchases stay paused; do
not infer Razorpay sandbox readiness from live credential presence.

Implement the fixture behind explicit sandbox rehearsal guards, using a
disposable database, synthetic identities, test cards and an owned webhook
destination. Production checkout and deletion code remain unchanged during this
preparation. Preserve failure evidence and verify cleanup of every owned
subscription, unpaid transaction, destination, client token and tunnel.

A live cutover needs separately approved architecture/readiness evidence,
provider-enforced replay controls and the existing explicit Paddle-live write
confirmation. Automatic upgrade-refund restoration remains OFF.

References: [transaction checkout](https://developer.paddle.com/build/transactions/pass-transaction-checkout/),
[transaction cancellation restrictions](https://developer.paddle.com/api-reference/transactions/update-transaction/),
[Paddle Checkout.open](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/).
