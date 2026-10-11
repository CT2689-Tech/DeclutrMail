# Checkout revocation sandbox preparation

Founder approved sandbox preparation/rehearsal on 2026-10-10 after reviewing the
checkout-revocation proposal. ADR-0046 records that limited architecture decision.
Root owns this branch, adapter additions, disposable fixture, workflow and review.
No new production DTO, checkout route, deletion clearance or provider cutover is
included. New INR purchases and automatic upgrade-refund restoration remain OFF.

The fixture uses the existing Paddle adapter and Paddle.js overlay with a disjoint
transaction session. It never falls back from a transaction ID to price items.
Dedicated legacy and copied-metadata scenarios intentionally exercise those
separate price-based capabilities. These are synthetic provider records only.

Expected evidence, still pending the actual rehearsal:

- Cancel an already-loaded unpaid transaction and a never-opened transaction;
  reopen the same saved ID and hosted `_ptxn` link with a still-valid SDK token.
  Keep the original loaded iframe open while canceling from a separate operator
  control tab. Attempt its test-card payment afterward and save the visible refusal
  screenshot before Finish; fresh overlay/link replays cannot substitute for this
  mandatory original-frame observation. The machine gate also requires a correlated
  original-frame API refusal and rejects closing it before cancellation.
  Require observable refusal, fresh canceled readback and a complete owned
  transaction scan showing no replacement. A separate legitimate purchase must
  still work with that token.
- Attribute a legitimate payment through real signed raw webhooks, exact signed
  attempt/transaction correlation and the canonical projector. Verify one access
  grant and replay deduplication. Preserve a sticky payment fence across stale
  provider observations. Subscription-linked and paid-before-completed results
  are held even without positive-charge evidence.
- Start cancellation on the real `checkout.payment.initiated` event; record its
  actual winning outcome. Deterministic controls cover both payment-winning and
  cancellation-winning states. Never label one observed race as proof of every
  interleaving or final account-deletion concurrency safety.
- Inject omission after provider creation but before durable binding. Recover the
  exact signed attempt from a complete bounded origin/ownership scan, with no
  second POST. Empty, capped, malformed, duplicate and unavailable results remain
  uncertain. This is fault injection, not evidence of whole-job recovery.
- Replay copied legacy payloads and prepared transaction metadata. Any replacement
  or still-payable capability preserves the proposed-model hold. HMAC validation
  protects attribution; it is not a provider-enforced stop guarantee.
- Authenticated Finish/Abort must stop the owned destination/token, drain handlers,
  recover all owned artifacts, cancel unpaid transactions, stop subscriptions and
  verify fresh final readbacks. A successful upload is not a passing rehearsal.

The fixture writes an ownership recovery manifest before provider mutations. It
contains synthetic workspace/attempt/resource identifiers only, never secrets,
payment details, raw webhooks or HMAC metadata. Signing material stays in the
owned Paddle destination and platform secret store; all reads/writes use the
Sandbox key. The disposable DB survives process restarts within a job. Whole-job
termination destroys it; owned-provider rescue must use the retained manifest and
verified provider ownership, and remains unverified until rehearsed. Do not clear
holds or infer cleanup after runner termination. Reports expire after one day.

Razorpay test access has not been established here. Its link replay remains
unverified; credential presence in production is not sandbox readiness. No INR
purchase availability changes are included.

Production billing notices are a separate workstream. OFF release #38116362243
passed for source `2224006177bf35a2f08e0bb483d160726629a192`; WIF #38117060814 at
`2026-10-11T06:08:14Z` observed API `declutrmail-api-00611-jib` and worker
`declutrmail-worker-00161-4gg`, each 100%. Release checks retain enrollment
`2026-10-11T03:15:41.000Z`, notices OFF and refund restoration OFF. The fixed failed
probe audit #38116441552 was denied logging access. A later offline reproduction
confirmed that the original create command fails in gcloud's argument parser:
duplicate bare `--import` values are rejected before any Cloud Run request. PR
#948 supplies distinct `--import=<module>` arguments; actual job creation,
execution, broker compatibility and cleanup still need fresh runtime proof after
merge. The denied audit read does not establish a Jobs Create IAM failure.
Browser passkey cleared but Console JavaScript failed to load after one reload.
Local gcloud auth failures remain distinct from the working WIF status route.
No IAM grant or guessed permissions repair was performed.
