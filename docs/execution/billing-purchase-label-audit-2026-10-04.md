# Complimentary-account purchase label audit — 2026-10-04

Relates to D117, D120. Integration owner: billing flow-audit session.

## Reproduction and change

An authenticated production account with complimentary Pro and no subscription
showed “Upgrade to Plus”. Checkout intentionally permits a paid subscription
under a higher complimentary entitlement, so the action is a purchase rather
than an upgrade. PlanCard now uses the canonical tier rank to show “Subscribe
to Plus” for that lower-tier purchase. Genuine upgrades and existing paid-plan
switches retain their labels and behavior. No pricing, eligibility, provider,
entitlement, analytics or contract changes.

## Ownership and integration

Isolated branch `codex/billing-purchase-label`, based on
`899bde433ead20e7273159def7aac5116e55172a`. Owned files: PlanPicker, existing
BillingScreen tests and stories, and this audit. BillingScreen tests are shared
with #890; edits are in separate existing test groups. No dependency on #890;
no infrastructure, migrations, lockfiles or shared contracts changed. This
session integrates both PRs and resolves any actual overlap once.

## Verification

- All 106 existing billing screen tests pass. Complimentary Pro and no-subscription
  Pro assert Subscribe; dated complimentary Plus retains Upgrade to Pro.
  Paused/past-due rows reject both purchase labels to retain their checkout lock.
- Old PlanPicker source fails both updated Pro purchase assertions; restored
  candidate passes them. Final workspace typecheck, changed-file lint, formatting and diff checks pass.
- Added a deterministic complimentary Pro story. Codex browser verified the
  rendered label; phone viewport 390×844 has no horizontal overflow (document
  width 380) and the purchase control remains present.
- Full isolated authenticated Next development flow: synthetic complimentary Pro
  account → billing → Subscribe to Plus → annual price preview → Keep current
  plan → refresh. Label and complimentary access persist; zero console errors.
  Runtime PID/cwd and exact PlanPicker source SHA256 were verified. No checkout
  submission or provider mutation. Owned synthetic grant deleted and prior
  workspace material state restored; API, Next, Redis and Storybook stopped.
- Production account reloaded after the combined refund release: complimentary
  Pro remains intact. It still displays the old Upgrade label; this candidate
  has not been deployed. No production account changes in this label pass.
- Independent reviewer found no source blockers; checkout-lock assertions and
  the stale missing-cycle comment were corrected from review feedback.

## Opportunities kept separate

Explain how a lower paid subscription coexists with a higher complimentary grant,
including the grant expiry and cancellation floor. That needs a complete copy and
state audit across purchase, change, cancellation and resume; it is outside this
label-only fix. A price-preview visit does not certify a purchase, webhook or
payment flow. Sandbox billing evidence and launch holds remain in the master audit.
