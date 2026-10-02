# One-flow audit, repair, review, and PR

Use this as the master prompt for one DeclutrMail user journey. The installed
`$declutrmail-flow-audit` skill loads this file. Replace the bracketed inputs or
state them in your request; omitted optional inputs use the rules below.

> Audit and improve **[flow]** end-to-end in **[environment/account]**. Follow
> `docs/runbooks/user-flow-audit.md`. Cover correctness, usability, accessibility,
> performance, recovery, useful data, and feature opportunities. Reproduce gaps,
> fix the evidence-backed issues in scope, use an independent reviewer, and open
> a PR. Ask me about material ambiguity while continuing independent work.
> Exclude **[exclusions; default: onboarding and billing]**. Do not merge or deploy.

## Operating contract

Read the repository's current AGENTS.md, CLAUDE.md and parallel-development
runbook before branching. Use an isolated worktree; state ownership, dependencies
and integration owner. Preserve other work. Use current source and product
contracts rather than treating old plans as requirements.

This workflow authorizes an independent reviewer subagent, local fixes and tests,
and a PR for the selected flow. It does not authorize merging, deployment,
purchases, new permissions, irreversible deletion or production resets. Respect
existing session authorization; do not repeatedly ask about routine choices.
Never send email, unsubscribe real mail, change a plan, or run a broad mailbox
mutation merely to generate test evidence. Follow the applicable tool confirmation
rules. Prefer isolated synthetic data for destructive, failure and edge cases.

If the flow is unspecified, ask which journey to audit; meanwhile inspect the
flow inventory and current repository state. Confirm the intended account and
browser session from the visible account identity before testing and again before
any mutation. Do not infer identity from URL, window order, plan or past history.
If the intended account cannot be verified, continue source/local work and ask for
the missing access. Keep evidence for each account and environment separate.

Onboarding and billing are excluded by default. Include either only when the user
explicitly names it as this audit's target. Plan-specific constraints that affect
the chosen flow may be observed; purchases and plan changes are separate work.

## 1. Define the complete story

Write a compact flow contract before editing:

- User intent, entry points, eligibility, active account and relevant plan.
- Discovery → decision → preview → confirmation → queued/in-progress → terminal
  result → persistence after refresh/revisit → recovery/Undo → return to work.
- Inputs, filters, scope, current versus historical counts, protected exclusions,
  server/provider boundary, and what proves the user achieved the outcome.
- Sibling surfaces exposing the same operation and their expected consistency.
- Explicit exclusions and the smallest safe production test, if needed.

Map applicable states: first/return visit, loading, empty, zero eligible, partial
or stale data, errors/retry, offline/reconnect, cancelled preview, repeated click,
concurrent work, protected items, account switching, quota limits, partial success,
unknown outcome, expired Undo and recovery failure. Mark irrelevant states with
reasons rather than manufacturing test cases.

## 2. Audit from every useful angle

Exercise the whole story, not isolated buttons. Use source/contracts plus browser
observations; distinguish reproduced defects, source-confirmed risks and untested
hypotheses. Explore:

- Correctness and safety: identity, scope, permission, preview accuracy, deduplication,
  result reconciliation, provider completion, durable state and honest Undo.
- Usability: discoverability, labels, decision confidence, navigation, defaults,
  unwanted friction, keyboard/focus, accessibility and phone-width layouts.
- Resilience and speed: loading feedback, slow/failing dependencies, cancellation,
  stale caches, race conditions, sensible recovery and perceived latency.
- Product value: missing capabilities, useful shortcuts, better next steps, and
  information that would materially help the user choose or understand an outcome.
- Data surfaces: relevant counts, time ranges, freshness, provenance, exclusions,
  denominators and uncertainty. Verify a trustworthy source before exposing a
  metric. Do not turn unknown into zero, unavailable into absent, or queued into done.
- Trust: privacy, sensitive content exposure, account isolation and truthful copy.
  Optional analytics must not become a product dependency or capture mailbox content.

For each finding record severity, affected state/surface, expected versus actual,
evidence, user impact, proposed repair, and how to verify it. For feature additions
and enhancements, explain the user need, existing data/source, scope, tradeoffs,
and acceptance criteria. Prioritize by impact and confidence, not novelty.

## 3. Repair within the bounded flow

Fix reproduced bugs and small, well-supported usability/data gaps in this flow,
including sibling surfaces necessary for consistent behavior. Preserve the design
system, existing adapters and canonical action vocabulary. Do not silently change
product policy, pricing, permissions or architecture.

Ask concise questions when materially different product choices remain, a feature
requires new data collection, the scope would expand, or an external action needs
authorization. State the exact decision and recommendation. Continue independent
work while awaiting answers. Silence is not approval. Keep larger opportunities
in a prioritized list; do not silently implement speculative features or omit them
from the audit. Mark each implemented, deferred pending a decision, or out of scope.

## 4. Verify outcomes, not attempts

Use the smallest meaningful regression tests. For a bug, demonstrate the test fails
against the old behavior and passes with the repair where practical. Cover relevant
failure/unknown states and affected siblings. Run repository-required typecheck,
lint, tests and appropriate build/bundle checks. Avoid repeated tests absent changes
or unresolved concerns.

Use an isolated synthetic browser session to verify the changed build, including
keyboard/focus and a narrow layout where applicable. Resume authorized production
testing against the intended account, but clearly separate deployed baseline
behavior from unmerged local changes. A preview, successful HTTP response or queued
job is not proof of the provider outcome. Wait for terminal state and verify the
persisted result, then Undo and restoration if included in scope. Restore test
mutations and verify restoration; record any residue or uncertain outcome.

Capture minimal privacy-safe evidence. Never commit real mailbox addresses, subject
lines, message bodies, tokens or unredacted production screenshots. Use synthetic
examples in tests and documentation. Identify concrete blockers and unverified
boundaries; never call an unexecuted journey passed.

## 5. Independent review and integration

Ask a reviewer subagent to inspect the final diff and flow contract independently,
including adjacent states, correctness, design/copy, privacy and regression risk.
Give the reviewer evidence and scope, not a requested verdict. The reviewer should
not author the implementation it is approving. Resolve actionable findings and
request re-review of relevant changes. If a reviewer cannot run, explicitly report
review as pending; do not label self-review independent.

Create a focused PR following the repository template with the concrete problem,
resulting behavior, verification evidence/limits, ownership and deferred decisions.
Attach it to the task. Keep ready, queued, merged, deployed and production-verified
states distinct. Do not merge or deploy without separate authorization. If a required
check is blocked, use a draft PR with the blocker rather than claiming readiness.

## Deliverable

Save a concise privacy-safe audit record in `docs/execution/` and finish with:

- Flow and environment/account alias tested; excluded areas.
- Findings fixed, with before/after behavior.
- Prioritized enhancement, feature and useful-data opportunities, including decisions
  still needed and why they were not silently implemented.
- Actual tests, browser evidence, reviewer result, blockers and residual risk.
- PR link and precise integration state; any production test residue.

Persist through repair, review and PR. Stop only for a concrete external blocker or
required user decision, completing independent work first. Do not broaden one-flow
work into an unlimited product rewrite.
