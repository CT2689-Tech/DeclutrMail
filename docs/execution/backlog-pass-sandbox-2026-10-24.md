# Backlog Pass sandbox lifecycle — October 24, 2026 PDT

Owner: this Codex session; branch `codex/backlog-pass-sandbox`, based on
`a5295cf8300431c113a47059e45f702c4763272d`. Scope: one new synthetic Free
workspace, one USD Backlog Pass purchase through the existing Billing UI and
Paddle adapter, signed webhook activation, history, actual invoice download,
full refund, retained receipts and account isolation. No live billing key,
live charge, real mailbox, catalog/promotion edit or shared credential change.
Synthetic mailbox readiness was seeded locally without OAuth tokens; this is
billing evidence, not a Gmail onboarding test.

## Observed provider and application outcomes

- Catalog preflight: active sandbox Pass price, USD 1,900 minor units, no
  billing cycle/trial. All 19 existing notification destinations were inactive.
  The run created one isolated destination subscribed to transaction completion,
  payment failure, adjustment creation and adjustment update.
- One transaction, `txn_01m5rv36azwpkwewjnpy2z3qzv`, completed through the app's
  preview/overlay using a published test card. Invoice reference `77027-10121`.
  No subscription was created. The verified signed `transaction.completed`
  granted Plus access for 30 days with the Pass's one-account ceiling.
- One injected 503 caused a real Paddle retry with the same event/body hash.
  The handler processed it, and an immediate duplicate returned `duplicate`.
  One grant and one processed purchase event remained in the disposable database.
- The downloaded provider PDF matched the synthetic buyer, transaction, invoice,
  one-time Pass and USD 19. Visual inspection confirmed a readable one-page invoice.
- Full refund `adj_01m5rv6me2exdqk7k8kfym5238` moved from `pending_approval`
  to `approved`. Access remained Plus while pending. The real signed
  `adjustment.updated` was processed at `2026-10-25T06:20:04Z`, revoked the
  purchased grant and restored Free. The grant/transaction link remained for receipts.
- During pending approval, `adjustments_totals.breakdown.refund` was `0`; after
  approval it was `1900`. The original transaction remained `completed` and its
  original amount remained `1900`. These are observed facts for this full refund,
  rather than an assertion that every adjustment lifecycle has been exercised.
- The existing read-only sandbox key, without `adjustment.read`, returned 200 for
  `include=adjustments_totals`. Including adjustment entities instead returned 403.
  The repair uses the aggregate include on existing tenant-scoped transaction
  reads, with no extra provider request or new production permission.
- A separate synthetic workspace saw an empty history and received 404 for the
  owned transaction's invoice document. After refund and customer archival, the owner still received the refunded
  invoice and an authorized document URL; the foreign account still received 404.
  Browser return to the owner preserved Free, Refunded and Download.

## Repairs

1. **Refund retry retained paid access.** Grant revocation could commit before
   access recalculation failed; retry then returned no workspace IDs and marked
   the event processed. Already-revoked grants now resolve their owners again,
   preserving the first revocation timestamp and receipt. Refund/chargeback
   failure-and-retry regressions failed with Plus before the repair and pass Free.
2. **Refund arriving alongside purchase could be falsely acknowledged.** If the
   revocation UPDATE found no grant, a purchase could commit before its fallback
   SELECT. An unrevoked row was mistaken for a completed revocation. The fallback
   now requires a revoked timestamp; a controlled interleaving test proves the
   event stays retryable, then revokes and restores Free on retry.
3. **Refunded payments appeared only Paid.** Payment history now requests Paddle's
   refund aggregate and carries an optional `refundedAmount`, preserving the
   original payment status, amount and invoice. Full/partial refund labels,
   matching filters and accessible row names use exact integer comparisons.
   Invalid, excessive or mismatched-currency totals disclose an omitted row.
   The optional field supports mixed API/web versions and other payment rails.
4. **Operational documentation omitted refund decisions.** Both destination setup
   runbooks now require `adjustment.updated` as well as `adjustment.created`.

The independent checkout-recovery PR #1131 owns different Billing files. This
change does not edit its screen, picker or pending-checkout policy.

## Verification and delivery

The production-build browser walkthrough passed: owner refresh/revisit and account
switching, Refund filter, actual PDF download before and after approval, keyboard
focus, and 320px light/dark layouts with no horizontal overflow. Final refreshed
browser window had zero runtime errors. A first post-refund download attempt
failed because the local build omitted its public API address; correcting that
fixture configuration and rebuilding restored the actual download. No product
change was made for that harness mistake.

Local checks covered 334 API billing tests, 453 Billing UI tests, 953 shared tests
(including the retired-pricing literal guard), 38 config and 76 events tests.
The final API and invoice files were rerun after their last regression additions.
The separate sandbox harness passed 21 zero-network safety checks. Workspace
typecheck, lint (zero errors; six existing warnings), formatting and implementation
log validation passed. Production build passed 50 route budgets, two redirect
checks and 32 prerender checks; Storybook built the new refund state successfully.
Independent architecture/adversarial flow and design-system/React gates passed.

Scoped provider cleanup verified approved refund, disabled destination and
archived synthetic customer. Receipt/document authorization still worked after
archive. The temporary key was revoked (provider read returned 403), its two
Keychain entries were deleted, and shared credentials were preserved. The local
browser fixture was signed out/closed; owned processes, disposable databases and
cache services, temporary build and raw PDFs were removed. Paddle retains the
refunded transaction, disabled destination, archived customer and revoked key as
audit records.

At the audit commit, local verification and cleanup are complete; PR CI, normal
merge queue and separate serving verification are the remaining delivery stages.
Their final identifiers are recorded in the task's external release receipt.

Local evidence is stored outside the repository under the task's
`settings-billing/backlog-pass-sandbox` artifact directory. Receipts contain only
synthetic provider IDs/statuses, hashes and assertions; no keys, webhook bodies,
signed PDF URLs, session cookies or payment details are committed.

## Deferred opportunities and limits

- Recovery after a permanently missed Pass refund update is a separate
  reconciliation enhancement. The current reconciliation worker targets
  subscriptions; this run verifies real delivery/retry, not a provider outage
  lasting beyond the webhook retry window. Both adjustment event types are now
  explicit operational prerequisites.
- Cumulative partial refunds use the provider's financial aggregate in history.
  Existing entitlement policy treats individual partial refunds as non-terminal;
  this task does not redefine that policy or add billing writes to history reads.
- No recurring plan, Pass extension, promotional purchase, Razorpay refund or
  live payment was made in this rehearsal. Existing unit tests cover relevant
  sibling normalization and extension behavior.
