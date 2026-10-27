# Plain-language audit — October 27, 2026

## Scope and ownership

User-authorized audit, copy fixes, review, and normal-queue merge across Home,
Cleanup/previews, Automations, Activity/Undo, onboarding, and Plan & billing.
Base: `704cd2d8b1b60fff40b4b66ba86199172bd82571`.
Integration owner: this Codex session (`codex/plain-language-audit-20261027`).

Owned changes: display copy in the six feature areas, shared launch copy
(`ws1.ts` and decks `ws1`, `ws2`, `ws5`), corresponding assertions, and this report.
There are no dependencies on another PR. Open PR #1176 owns onboarding survey and
source reporting; this audit changes only separate scan-recovery sentences in
its shared onboarding files. No shared contracts, workers, migrations, manifests,
lockfiles, provider settings, or billing/mailbox mutations are changed.

## Method and decisions

Applied copy-editing sweeps (clarity, voice, usefulness, evidence, specificity,
reassurance, next step), Web Interface Guidelines, React review, and an independent
cavecrew review. Reviewed screen strings and shared sources, then traced sensitive
claims to their render inputs and owning implementation. Target is familiar,
concrete language; readability formulas were not used to shorten safety facts.

| Flow                 | Findings fixed                                                                                                                                                        | Boundaries retained                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                 | Internal reporting terms (`scope`, `outcomes`, `metadata`, `snapshot`, `quota`), unclear size labels, vague empty state, and allowance without a unit                 | Scanned coverage, estimated sizes, unknown values, reporting windows, and Undo exclusions                                                      |
| Cleanup and previews | `eligible` in no-email feedback, `scope` in archived-email empty state, unclear unsubscribe status, dense detail introduction                                         | Canonical verbs, count/destination/Undo preview, Inbox versus archived reach, age filter, requests versus sender compliance                    |
| Automations          | `preset` becomes `built-in`; `Observe` becomes `Watch first` in help; historical match/read-rate explanations and included-sender counts are plainer                  | Rule matches differ from senders with email available for a change; Protected exclusions and approval/automatic modes remain explicit          |
| Activity and Undo    | `Outcome` filter becomes `Result`; recovery status describes success; support download explains its contents without ZIP/CSV/JSON terminology in the main explanation | Wire filter names, independent privacy opt-ins, full-filter coverage, technical details disclosure, Undo limits and non-recallable unsubscribe |
| Onboarding           | `fetched`/`stored` headings, permission-grant errors, stalled-scan copy, goal descriptions and starting-rule errors                                                   | Generated permission/data inventories and locked privacy sentence; scan progress does not claim a Gmail mutation                               |
| Plan & billing       | Allowance units, internal selector/entitlement terminology, complimentary-plan explanation, paid-time resume and locked plan-selection copy                           | Prices, limits, tax/refund/renewal terms, current-plan versus subscription distinction, unknown payment outcomes and no-charge resume guard    |

Representative changes:

- “Review the exact scope before confirming.” → “See what will change before you confirm.”
- “Scanned mail estimate” → “Estimated size of scanned emails”.
- “Scanned inbound metadata · Updated …” → “Totals updated …”.
- “Gmail needs a fuller permission grant” → “Allow Gmail access to continue”.
- “Retained billing period” → “paid time”.
- “Adds a separate JSON appendix for support correlation.” → “Adds a separate file to help support trace what happened.”

The compact meter now says `{remaining} emails left`; the full meter says
`{remaining} emails left to clear · resets {resetDate}`. The accessible description
continues to include the total monthly limit and reset date. No meter math changes.

## Accuracy checks

- `HomeView` renders snapshot counts and sizes from `overview.snapshot.data`.
  `InboxReportService.getSnapshot` sets `asOf` to the calculation time, so the footer
  says **Totals updated**, not Last scanned. The existing connection status has
  its own last-scan time.
- Home size estimates remain approximate, incomplete sizes remain explicit, and
  unknown size never becomes zero. The estimate does not claim total Gmail or
  Google storage usage or storage saved.
- Automation preview uses `actionableSenderCount` separately from
  `wouldMatchCount`. Sender-rule detail calls out **senders with matching email**
  because its configured-sender list can also contain Protected senders.
- Gmail marked-read status is never called an open rate or evidence of actual
  reading. Historical match evidence stays historical; raw diagnostics remain
  available in Details.
- `ACTION_ALREADY_RECOVERED` is returned for a related successful action in
  `action-recovery.service.ts`, so the copy says **already succeeded on retry**.
- Billing wording still distinguishes included access from a separate paid
  subscription and states that resuming can replace the current plan. Dates,
  renewal amounts, refund windows, and provider-state conditions are unchanged.
- Consent still renders `GMAIL_OAUTH_ACCESS` and the generated Gmail inventories.
  Permission labels preserve Gmail/Google capitalization. The locked privacy
  sentence is unchanged.

## Review and verification

Independent review found and corrected: the matching-sender subset label,
successful retry wording, a mistaken unknown-size assertion, and Home totals-note
scope. Follow-up review found no blockers or weakened behavior assertions.

Browser smoke used Codex's built-in browser and synthetic local fixtures:

- Home in its actual Next app preview, at 375px and 1440px; no horizontal overflow.
- Delete preview, expanded Details, age/reach controls, count/destination/Undo.
- Automation activation preview, included/excluded senders, Watch first/Act now,
  and unsubscribe consequences; no final mutation.
- Activity support dialog, filters, download/privacy explanation and opt-ins.
- Paused-subscription billing state and Review resume, including paid-time,
  current-plan consequences, and final confirmation copy; no payment operation.
- Onboarding consent and insufficient-permission recovery with Reconnect Gmail.

No console errors were observed on these Next app previews. Storybook itself hit
an existing Vite-client `Unexpected identifier 'assert'` error in the built-in
browser. The actual Next runtime rendered the same components successfully via a
temporary fixture route, which was removed before validation/commit. This is
synthetic UI verification, not a production or provider-lifecycle claim.

Validation for this change uses workspace typecheck, lint, the repository script
tests, shared and web tests, guard hooks, formatting, production build, bundle and
prerender checks. Final outcomes and required integration checks are recorded on
the PR. Merge, deployment, and production verification are separate states.
