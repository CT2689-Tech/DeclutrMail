# Billing copy clarity

## Flow contract

A visitor compares plans, then an authenticated user reviews the checkout confirmation. Published limits, quota counting/reset, provider capabilities, taxes and Brief processing must agree with the existing implementation before purchase. Prices, checkout defaults, refunds, dunning, grants and Founding allocation behavior remain governed by existing policy.

This branch owns public pricing/FAQ/help/terms/refunds, checkout disclosures and confirmed stale comments. Account deletion behavior is owned by the independent deletion branch. Avoid shared files in PR #916 where possible; the root agent owns integration.

## Verification

Implemented the confirmed discrepancies across pricing, plan cards, FAQ/help, terms/refunds, checkout disclosures, comparison copy and structured Offer data. Published counting/reset rules, provider limitations, Brief processing, annual savings, inbox grandfathering and refund windows match the existing implementation. The optional subscription access deadline is read-only; the UI describes access from that subscription and preserves complimentary access and refund/chargeback notice precedence. Obsolete multi-sender upsell wording was removed without changing gating.

Full repository typecheck and lint passed (six existing lint warnings). Ten affected UI suites passed 235 tests; the final modal/selection cleanup passed 19 tests. Independent copy/design/architecture review found no remaining blocker, including a final review of the last comment/text cleanup. Implementation log remained current. The first test run exposed stale Keep-label and FAQ-count expectations; those were updated to assert the confirmed copy.

The built-in browser verified public pricing, quota/reset and provider disclosures, and an authenticated synthetic Free user's USD and INR Pro checkout previews. The preview showed taxes, Razorpay limitations, Brief disclosure and the privacy/support links. The preview was closed without continuing to checkout. Only unusable synthetic sandbox settings and local Postgres/Redis were used; no provider API call, charge, cancellation, refund or email send occurred. Cold-route navigation timeouts were retained; the subsequent rendered page was verified. Screenshot proof was saved outside the repository.

Policy decisions are recorded separately in [billing-policy-decisions-2026-10-10.md](billing-policy-decisions-2026-10-10.md). Refund scope, Founding seat reuse, invoice/email ownership, grants, availability and checkout architecture are not changed in this delivery.

## Deferred historical changelog correction

The local pre-commit check rejected a correction to the July self-serve plan-change sentence because `check-changelog.ts` found 315 existing product merges without public changelog entries. No check was bypassed or weakened. The historical data file was restored and excluded from this delivery; the missing coverage remains unresolved. Current pricing, FAQ/help and checkout correctly disclose Razorpay support requirements.

The deferred sentence is: “Paddle subscribers can upgrade, downgrade, and switch between monthly and annual from Billing. Razorpay subscribers can contact support for plan changes.” Landing it requires a separately reviewed historical changelog reconciliation.

The first full CI web run found two additional exact-copy expectations in the billing cancellation flow and pricing cap explanation. They still expected an unconditional Free downgrade and calendar-month reset. The tests now assert the confirmed subscription-specific message, complimentary-access caveat and next signup-anniversary reset. Both complete affected suites passed 140 tests locally. The failed CI run is preserved.
