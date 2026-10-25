# Fresh Paddle sandbox purchase verification

## Scope and result

One fresh synthetic account completed the production Billing UI → existing
Paddle adapter → sandbox overlay → signed webhook activation → payment history
→ provider PDF journey on October 24, 2026 PDT (October 25 UTC). No live key,
real card, real Gmail account or production billing data was used.

Integration owner: Codex root, isolated worktree `58a9`, branch
`codex/paddle-fresh-purchase`, based on `ecd4818507cdd83e360fb2e9d13715a6daecdf1b`.
Own the shared checkout-discount helper, its catalog/adapter regressions, the
manual promotion-rehearsal preflight, Billing recovery/cache ownership, its stories/tests, webhook comment correction and this audit. No schema, lockfile or shared
provider configuration changes; no dependent PR. Open PRs were checked for
Billing overlap. A final check found independently opened PR #1131 touching the
same Billing screen, stories and tests; its checkout-close policy/copy work must
retain this claim-release ordering when integrating. This PR does not change
that other branch or its release state. Anchored sections and bottom Account navigation are preserved.

The fixture began on Free, with no subscription, provider customer mapping,
entitlement grant or subscription event. Only synthetic account/mailbox readiness
was seeded. Paid access came from Paddle's actual signed webhooks, not SQL
activation or a fabricated success event. The app ran from an isolated production
web build, a loopback API and task-owned Postgres/Redis. The temporary public
receiver exposed only the exact webhook route, with raw bytes/signatures,
size/rate/deadline limits and ownership checks; other paths returned 404.

## Reproduced defect and repair

**P2 — an expired discount prevented fresh sandbox checkout.** The first real
checkout request returned HTTP 400, with Paddle's `discount_expired` response.
`checkoutDiscountId()` attached the sandbox PH30 discount after its configured
October 19 expiry. A bounded, complete provider transaction scan established
that the rejected request created no owned transaction. The Billing UI's
"Review checkout" → "Confirm no charge" recovery was exercised before retrying.

The helper now omits expired discounts using the existing environment-specific
expiry. It preserves price eligibility, catalog prices, live placeholder handling
and the existing checkout architecture. It does not silently retry an ambiguous
payment or change a provider discount. The next user-confirmed checkout showed
$59/year and completed at $59 with no discount.

Four expiry-boundary regressions failed against the old helper and passed after
the repair. Adapter tests additionally verify that expired Plus and Backlog Pass
checkout requests omit `discount_id`; active-offer tests use explicit pre-expiry
time. A stale webhook-controller comment now correctly states that Paddle
retries non-2xx responses; controller behavior is unchanged.

The defect-class sweep found one manual promotion-rehearsal sibling: it would
attempt discounted annual checkout after first buying two Pass fixtures. Its
catalog preflight now rejects expired configured promotions and missing,
malformed or elapsed provider expiry before creating any fixtures or payments
(null provider expiry still means unlimited). It retains its explicit 30%
discount assertions. An isolated execution with a fake sandbox credential,
fixed expired clock and all fetches blocked exited at catalog preflight with
zero network calls/writes. Provider-expiry boundary tests pass; the full manual
Pass/discount rehearsal was not executed.

**P2 — confirmed no-charge recovery could stay locked until reload.** The
failed-discount attempt exposed a second real issue: clearing local pending state
before deleting the server claim let the cached positive claim synthesize a new
wait. The later server-null response never removed that wait. A focused component
regression failed against the old behavior and passed after the repair.

Recovery now keeps the wait until the server confirms `released: true`, cancels
older subscription reads, patches only the cached pending-claim field and then
clears the originating local wait. Failed or malformed responses retain the hold
and show retry. Repeated clicks, unmount/account change and replacement attempts
are guarded. The known-abandoned-overlay path uses the same release ordering;
intentional plan/setup refreshes remain intact. A server-synthesized wait follows
a settled successful server-null read, while persisted ambiguous payments and
plan changes stay protected. Confirmation and its double-charge warning remain.

A separate browser recovery check used the final production web build with a
loopback HTTP fixture, no credentials/database/provider calls: keyboard Enter
showed busy/inert controls; an injected DELETE 500 retained the hold with a visible
retry; retry 200 restored plan selection without reload; a later reload stayed
unlocked. At 320px, light/dark error and confirmation layouts had no horizontal
overflow; original theme/viewport were restored and no runtime errors appeared.
Optional mail endpoints were intentionally disabled in this UI fixture. This
recovery check is distinct from the actual Paddle purchase evidence below.

## Actual end-to-end evidence

| Boundary                        | Observed result                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog / destination preflight | Active sandbox annual USD 5900 price, correct product, no trial; existing destinations inactive. One owned receiver was created/reused.                                          |
| Checkout                        | Real app-created `txn_01m5rqab4m8f59hgny3yt989bz`, one annual item, quantity one, USD 5900, no discount. Paddle clearly displayed Test Mode.                                     |
| Payment                         | Paddle test card completed; provider transaction `completed`, matching subscription `sub_01m5rqbqg9vsx5wbd0v0g1agxx` became `active`.                                            |
| Activation                      | Valid raw signed `subscription.activated` and `transaction.completed` deliveries returned processed 200; database and UI showed Plus.                                            |
| Real retry                      | The proxy deliberately returned one 503 for `subscription.created`. Paddle retried about 29 seconds later; matching body hash, valid fresh signature, processed 200.             |
| Duplicate                       | An immediate unchanged duplicate of `subscription.activated` returned duplicate 200. The event was persisted once.                                                               |
| History                         | The authenticated purchaser saw one Paid $59.00 invoice, number 77027-10120.                                                                                                     |
| Document                        | Actual browser PDF downloads succeeded with mouse and keyboard Enter. The rendered one-page PDF was legible; invoice number, amount, buyer, annual plan and transaction matched. |
| Persistence                     | Fresh login followed immediately by browser reload retained Plus and the invoice.                                                                                                |
| Isolation                       | A second synthetic account showed Free / no invoices. Direct access to the first account's document returned 404 `NOT_FOUND`, without another provider invoice request.          |
| Narrow / themes                 | Status filtering and empty results worked at 320px; light and dark layouts had no horizontal overflow. Original theme and viewport were restored.                                |
| Ended subscription              | Real immediate sandbox cancellation webhook returned the account to Free. The Paid invoice remained visible and downloaded successfully a third time.                            |

During earlier local testing, one reload led to sign-in because a JWT passed
validation but its session identifier was absent from this disposable database.
Other loopback stacks share cookie names across ports; interference is plausible,
not proven. A fresh login and immediate reload on this stack passed. No product
auth defect or speculative auth fix is claimed.

## Access and cleanup

Existing credential stores and the sandbox connection were inspected first. The
configured sandbox server key was expired/unavailable; no working write key was
recoverable. After the user explicitly authorized a new sandbox key, one temporary
key was created and stored only in Mac Keychain. It had the four sandbox write
permissions needed for transactions, subscriptions, customers and notification
settings, plus product/price reads. The existing shared client token was reused.

Cleanup was read back, not inferred from attempted writes:

- Owned subscription canceled immediately; actual cancellation webhook processed.
- Owned notification destination `ntfset_01m5rq15yy6s2rgh6njjvzr2eg` disabled.
- Exact synthetic customer archived after billing stopped.
- Temporary API key revoked in the sandbox dashboard; both owned Keychain items
  removed. Existing API keys and the shared client token stayed unchanged.
- Tunnel and task app processes stopped. Disposable databases/build output and
  raw PDF downloads were removed after the final checks; minimal safe receipts,
  body hashes and screenshots remain outside the repository.

Paddle retains its sandbox transaction/invoice and canceled subscription as an
audit trail. This rehearsal did not test refunds, a new one-time purchase, India
checkout, provider reconciliation recovery or a paid production account. No live
charge, live billing write or real mailbox mutation was performed.

## Checks, review and delivery

- Typecheck passed for all workspaces. Lint passed with zero errors and six
  pre-existing warnings. Changed-file formatting and implementation-log checks
  passed.
- API catalog/adapter/service suites: 265 passed. Webhook controller suite:
  14 passed; rehearsal helper suite: 7 passed. Shared: 950 passed; config:
  38 passed; events: 76 passed. Billing web: 450 passed across 29 files, including
  174 screen cases and optional-recovery-chunk success/failure. Total: 1,800 tests.
- The first shared run had one glossary-scan timeout under concurrent load.
  That test passed alone, then the entire 950-test shared suite passed unchanged.
- Reconstructed isolated harness checks: 15 mock assertions, zero external
  network calls. These are tooling checks, separate from actual payment evidence.
- Final recovery web typecheck/lint and Storybook build passed.
- Fresh production build passed. Bundle budget: 50 routes within caps and one
  declared redirect verified; 32 public routes prerendered. An initial budget
  run used a stopped local API and failed route discovery; the unchanged build
  passed with the normal CI production environment (no local API dependency).
- Independent final flow/architecture review, defect-class sweep, design-system
  gate and webhook-security gate found no unresolved material finding. Reviews
  were read-only; the reviewer independently inspected safe receipts/screenshots,
  while raw PDF rendering was inspected by the integration owner before removal.
- Integration/deployment status is reported separately in the PR and final task
  response; sandbox proof is not live purchase proof.

No broader redesign or new feature is needed for this verified flow. A dedicated
persistent sandbox environment could reduce future access/setup overhead, but
provisioning shared credentials, infrastructure and policies is deferred outside
this bounded repair.
