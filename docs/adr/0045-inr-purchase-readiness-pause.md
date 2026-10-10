# ADR-0045: Pause new INR purchases pending readiness

- Status: accepted by founder on 2026-10-10; rollout tracked separately
- Related: D117, D119, ADR-0035 and ADR-0044

The founder approved pausing new INR purchases until seller/GST invoicing readiness is verified. Existing Razorpay credentials are bound; configured access does not establish seller/invoice readiness. ADR-0035's ownership gap remains evidence, rather than an assertion that tax obligations were checked or satisfied.

Reject new Razorpay checkout before billing-region updates, pending checkout claims, provider artifacts or provider notification side effects. Keep existing subscription cancellation, reconciliation, signed webhook handling, access projection and available billing-history/support paths. Do not cancel or refund existing subscriptions automatically.

Use the already recognized pre-claim `BILLING_NOT_PROVISIONED` refusal with additive `reason: inr_checkout_paused`, so an older loaded client releases its local reservation. New clients explain the pause and cannot start INR checkout. Keep the chosen provider visible, including an unprovisioned promotional point; USD requires an explicit choice.

Published INR amounts remain reference prices during the pause. Remove unavailable INR structured-data offers, qualify currency-switch instructions and avoid promising an automatic support plan change. Reopening the shared policy constant requires verified readiness evidence and a reviewed policy change.

This code-only pause does not revoke already issued Razorpay hosted checkout/authorization links. Their provider-enforced expiry/revocation remains a separate billing decision; live provider changes require the existing explicit confirmation boundary. Continue reconciling any legitimate payment rather than discarding a signed callback because new checkout is paused.
