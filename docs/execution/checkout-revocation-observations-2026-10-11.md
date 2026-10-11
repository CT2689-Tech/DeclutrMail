# Checkout revocation: provider observations, proof incomplete

Root owns this record and the disposable checkout fixture under ADR-0046.
Preparation and rehearsal were authorized for Sandbox only. Production checkout,
deletion clearance, INR availability and refund restoration have not changed.

## Failed runs remain failed

- [38119363296](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38119363296)
  stopped at unconfirmed transaction preparation. Its known token/destination
  were stopped, but attempt/provider recovery was unproven.
- [38120710974](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38120710974)
  ran merged diagnostics from `2b1adc49`. Preparation returned HTTP 400 with
  `transaction_checkout_url_domain_is_not_approved`. The actual deletion guard
  stayed held. No creation retry was issued. Abort stopped the known
  capabilities; attempt/provider recovery remained unproven.
- [38120969543](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38120969543)
  used the same source with a newly registered, exact temporary Sandbox domain.
  Paddle approved it in the existing Sandbox dashboard, and transaction creation
  then succeeded. All seven scenarios ran, but the unchanged full-proof gate
  refused completion. The run was aborted and is **failed**, not a passing
  revocation rehearsal.

[Paddle's domain documentation](https://developer.paddle.com/api-reference/checkout-domains/)
requires dashboard registration even though Sandbox approval is automatic;
domains cannot be added through the API. Only this run's temporary domain was
added, then removed after cleanup. Its owned identifier was
`chedom_01m4mxbaxrmrfwbk0q8v9ntw1z`; dashboard readback verified removal. The
existing approved product domain was retained.

## Actual observations from 38120969543

| Scenario                    | Observation                                                                                                                                                                                                          | Proof limit                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Loaded unpaid checkout      | Original frame reached payment. Cancellation from a separate control tab returned fresh `canceled`/`stopped`. The still-open frame's test-card attempt emitted `checkout.payment.failed` and showed payment refusal. | It did not supply the required correlated API refusal event/code.                               |
| Saved ID and hosted link    | Both canceled transaction replays emitted `checkout.error` and displayed Page Not Found. The recorded error codes were `unknown`; scans found the same single owned transaction.                                     | Generic errors did not clear the proposed hold.                                                 |
| Never-opened checkout       | Canceled before any open; fresh saved-ID and hosted-link attempts also displayed Page Not Found. Ordering was verified.                                                                                              | Specific refusal evidence remained unavailable.                                                 |
| Successful purchase control | Same still-valid token completed a different transaction. Three verified raw webhooks projected an active Plus subscription and Plus access; payment evidence stayed sticky and the real deletion guard stayed held. | New fixture replay-dedup verification was not reached because the full gate refused first.      |
| Payment/cancellation race   | Real `checkout.payment.initiated` triggered the one-shot cancellation. Cancellation won this observed race: fresh provider state was canceled/stopped, payment failed, no subscription was linked.                   | One observed interleaving does not establish every race outcome or deletion concurrency safety. |
| Missing local binding       | Provider creation was deliberately omitted from durable binding. Complete signed ownership recovery found the exact transaction, with no second POST and no replacement.                                             | This was fault injection within a job, not whole-job termination recovery.                      |
| Copied prepared metadata    | Price-based checkout loaded and created a second draft under the signed workspace/attempt; the replacement scan retained its hold.                                                                                   | HMAC attribution does not revoke a copied price-based capability.                               |
| Legacy payload              | Existing overlay loaded a draft checkout; both the proposed legacy hold and actual deletion guard remained held.                                                                                                     | Loading is not payment proof or legacy revocation proof.                                        |

`completed:false`, `aborted:true`; full assertions and new fixture replay-dedup
verification did not pass. No assertion was weakened to accept generic UI
errors. Paid, uncertain, copied and legacy cases keep their holds.

## Cleanup and remaining scope

The sanitized report positively recorded capability recovery, destination
stopped, token revoked, handlers drained, attempts recovered, provider recovery,
subscriptions stopped and final settlement. Every cleanup field was true.
The temporary approved domain was subsequently removed, the GitHub Sandbox
operator secret deleted, the private transport unlinked, browser key cleared and
fixture tabs closed. Cleanup does not turn the failed proof into a pass.

Specific original-frame/replay refusal evidence, new fixture replay dedup,
whole-job rescue and Razorpay link replay remain unverified. No live cutover or
account deletion clearance is justified by this rehearsal. Source tests remain
separate from these provider observations.

Private notice runtime releases
[38120027471](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38120027471)
and [38120689461](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38120689461)
both failed with actual exit 1, `NonZeroExitCode`, no memory/timeout hint and
verified probe cleanup; both producers were withheld. PR #955 adds precise
diagnostics, with its fresh candidate-image run still pending. Notice activation
stays OFF; first enrollment remains `2026-10-11T03:15:41.000Z`.
