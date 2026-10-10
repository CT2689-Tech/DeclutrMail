# Account deletion billing safety

## Flow contract

The authenticated user opens Settings, requests account deletion with either confirmation phrase, and may cancel a pending request. The purge worker later revokes Google access and removes local data. Success requires billing to be safely stopped before scheduling and again before destructive work. A subscription scheduled to cancel is still billable until it ends; paused, past-due, unresolved checkout and unavailable provider evidence block deletion. The user can open Billing or contact support. No cancellation, refund, entitlement or pricing policy changes are authorized by this fix.

Approved by the user on October 10: block deletion until billing is safely stopped. Inspect every workspace subscription, including locally canceled refund and dunning rows. Provider calls occur outside database transactions. Deletion and checkout claims serialize on the workspace row. Both normal and immediate deletion, and legacy due requests, use the same guard.

## Ownership and dependencies

This branch owns the deletion guard, provider read seam, account API/UI and purge wiring. The independent copy branch owns marketing and checkout disclosure text. Neither depends on PR #916. The root agent owns integration. Independent architecture/adversarial review is required before delivery.

## Verification

Implemented a Billing-owned facade for API scheduling and the required worker port. Normal and waiver requests block active, past-due, paused, unresolved claims/attempts, and unreadable evidence. All subscription history and attributable verified events (including unapplied events) contribute exact provider references. Raw Paddle canceled and Razorpay cancelled/completed/expired are terminal; halted is billable. Operator review clears only unknown evidence, never skips known refs. Workspace locking fences checkout/deletion and the final membership decision; no provider HTTP runs in a database transaction.

Validation: full repository typecheck and lint passed (six existing lint warnings). Four billing/API suites passed 249 tests; the worker suite passed 22; four affected UI suites passed 147. The final guard received an independent 11-test pass. API negative control removed the new scheduling gate and all four billing safety cases failed by admitting deletion. Worker negative control used the original worker and both legacy-request cases failed by purging data; both source files were restored. Real local Postgres verified checkout-first, deletion-first and concurrent races through both postgres-js and node-postgres, six scenarios total, with synthetic providers. Implementation log remained current.

The built-in browser showed a synthetic paid account's Delete action disabled with working Billing/support links. A synthetic Free account completed the normal seven-day scheduling flow, showed the scheduled date and then canceled deletion; the Delete action was restored. No real provider call, charge, cancellation, refund, Gmail deletion or email send occurred. Deletion verification ran with local billing disabled; provider reads were covered by mocks. A later copy-only checkout preview used unusable synthetic sandbox credentials and never continued to checkout. Initial local API startup required the isolated Redis fixture; a subsequent duplicate startup was rejected by the port bind. A local typecheck hit disk exhaustion, then passed after clearing only task-generated build caches. A typecheck overlapping the temporary worker negative control saw the intentionally restored baseline types; the final restored-source typecheck passed. Browser navigation timeouts are retained as observations rather than counted as successful verification.

Independent architecture/adversarial and design-system review resolved unknown-claim history, raw halted normalization, checkout fencing, UI stale errors, global waiting banners, known artifacts hidden by operator resolution, correction-event refs, and unapplied verified-event refs. Lint and Storybook build passed independently. No remaining blocking review finding.

Support procedure: [billing-deletion-support.md](../runbooks/billing-deletion-support.md). New unknown Paddle attempts require support even after visible cancellation; historical erased attempts and reusable workspace-only overlay payloads remain explicitly outside the guard's guarantee. Provider-enforced checkout expiry/revocation is a separate architecture decision. No migration or provider mutation is included.
