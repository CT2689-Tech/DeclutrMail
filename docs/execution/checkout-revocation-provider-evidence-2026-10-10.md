# First checkout revocation sandbox observation

Approved preparation PR #945 merged as `9a21d502f76235ebc5d3de1b8ce8640c7ebb467d`.
Actual sandbox run #38119363296 failed and was explicitly aborted; it is not a
passing rehearsal. Catalog and destination reads, private operator enforcement
and invalid-signature rejection passed.

The first server-created `cancel` attempt recorded its local ledger but failed
before binding a verified provider transaction. Complete ownership reads showed
no matching transaction, which does not disprove an uncertain accepted create.
The real production deletion guard remained held. No create was retried.

The separate legacy scenario loaded the existing Paddle.js overlay in Test Mode
and created draft `txn_01m4mvvfh141p9py7f78ssjvxe`. Its proposed legacy hold and
actual production guard both remained held. No payment or grant was made.

Abort revoked the owned client token, disabled its destination, drained handlers,
verified final settlement of observed transactions and found no owned active
subscription. Attempt recovery and provider recovery remain false because the
unconfirmed server create could not be recovered. Preserve that uncertainty;
capability cleanup and artifact upload do not make the rehearsal pass. The
operator secret was removed after the runner completed.

Root owns the follow-up sandbox request diagnostics, fixture, tests and record.
Only guarded sandbox methods gain fixed request/http/json/facts stage, numeric
HTTP status, allowlisted error code and a boolean for the exact checkout.url
validation field. Raw error bodies/messages, custom data, HMACs, credentials and
payment details are never forwarded. Unknown values remain unknown. The fixture
stores those projected preparation failures for the next controlled run; no
retry, proof gate, recovery rule or production behavior is changed.

Original-frame refusal, saved-link replay, legitimate signed payment/access,
payment races and omitted-binding recovery remain unverified. Whole-job rescue
and Razorpay remain unverified. New INR purchases remain paused; app notices and
automatic refund restoration remain OFF. This follow-up needs normal review and
merge before another sandbox run, under the existing sandbox-only approval.
