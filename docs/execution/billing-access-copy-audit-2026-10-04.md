# Billing access disclosures — 2026-10-04

## Flow and scope

Returning paid subscriber: Plan & billing → review cancellation → consider pause
→ pending/error feedback → return to billing. Pending refund: current plan →
understand remaining subscription access. Decisions D117, D118, D120, D253.

This bounded follow-up uses synthetic Storybook states, an isolated authenticated
Next development runtime, and existing integration tests. It changes disclosures
only; provider operations, pricing, entitlement and
grant policies, analytics, and API contracts remain unchanged. Onboarding and
live payments are excluded. Prior sandbox provider rehearsals established that
pause removes subscription access immediately and pending refund grace can end
before the paid period.

## Findings repaired

- **P2, pause offer:** the old text disclosed stopped billing but promised rules
  stayed exactly as they were. A pause immediately removes this subscription's
  access; effective downgrade can move active rules to Observe. The offer now
  states immediate subscription-access loss and automatic billing resumption in
  30 days, and preserves only the accurate saved-senders/history claim.
- **P2, pending refund:** the old text promised the plan until provider approval
  or paid-period end. Bounded refund grace can expire earlier. The notice now
  names approval or grace expiry. Subscription-specific wording avoids claiming
  a complimentary grant also ends. No invented deadline is displayed.

## Verification and review

- Final model/screen/modal tests: 149 passed after comment and lazy-modal test cleanup.
- Old-source negative control: three updated model/screen refund and pause
  assertions failed against the old disclosures after the lazy-modal wait fix.
  An earlier isolated rerun exposed an existing lazy-modal timing assumption;
  the pause test now awaits the dynamically imported modal before asserting.
  The corrected existing test awaits its real asynchronous UI boundary.
- Workspace typecheck passed; lint passed with six existing warnings, zero errors.
- Codex browser: pause offer inspected at 1280×900 and 390×844; disclosure wraps
  without horizontal overflow. Modal keyboard focus cycles from Keep current
  plan back to Pause; dialog retains aria-modal. Pending controls are disabled;
  error remains visible with retry available. Callbacks are no-ops, so these
  story checks cannot change a real subscription.
- Existing RefundPending story: corrected note visible at default and phone
  width without horizontal overflow. Its invoice panel is not seeded and shows
  an unavailable-data state; this is not a production invoice-failure finding.
- Full Next development flow: confirmed synthetic account, active paid fixture,
  cancellation preview and immediate-access disclosure, keyboard focus cycle,
  Keep current plan dismissal, refresh persistence, then pending-refund note on
  the actual billing page. No browser console errors. Runtime PID/cwd and both
  changed source hashes matched the owned isolated copy. Temporary local fixture
  states were restored exactly for the subscription and materially for the
  workspace; its database updated_at trigger advances. No provider mutation was
  performed in this copy-verification pass, and no production account changed.
  Owned API, Next and Redis processes were stopped after verification.
- Independent flow reviewer inspected source, entitlement/grant distinctions,
  React/a11y semantics and static states: no blockers. Nearby inaccurate grace
  comments were corrected. Browser observations belong to the implementing
  agent; final evidence handed back for independent review.

Empty/no-subscription is inapplicable to the paid cancellation modal; existing
billing-screen tests cover no subscription and complimentary plans. No real
mailbox content or production screenshots are committed.

## Opportunities retained

- **Useful data:** expose the server's actual refund grace deadline in the billing
  contract, with grant-aware wording and refresh behavior. Current payload lacks
  that deadline; this copy fix must not manufacture a date from paid-period end.
- **Entitlement clarity:** audit complimentary-grant floors across paid-plan CTAs
  and cancellation previews so buying a lower plan is not labeled an upgrade and
  cancellation does not promise Free while a grant remains.
- **Date clarity:** state the timezone used for billing boundaries consistently.
  A provider UTC boundary can be the previous calendar day locally.

These are separate follow-ups, not silently implemented policy or contract changes.

## Integration handoff

Owner: this flow-audit session. Isolated branch `codex/billing-access-copy`, based
on main `6023528de6bed3e6a57ebc0f82d299d2a95b03e5`. Owned files are the two billing
copy sources, their existing model/screen tests, the new cancellation stories,
and this record. No dependencies on the independent refund-classification or
renewal-reconciliation PRs, and no shared infrastructure/lockfile/migration edits.
The PR records its exact candidate, required CI, review and integration state;
local verification does not establish deployment or production verification.
