# Post-action suggestion audit — 2026-10-15

## Flow contract and ownership

Follow-up to the accepted-Unsubscribe sender detail still showing Suggested: Unsubscribe. Cover the full sender page and shared inspector, current policy and unsubscribe lifecycle, completed Keep/Archive/Later/Delete, partial cleanup, failed/unknown results, refresh/revisit and Undo. Onboarding, billing, scoring algorithms, provider mutations and historical data are excluded.

A suggestion must remain useful against current facts: a standing Keep or Protected choice takes precedence; an unsubscribe already in progress or accepted is represented by its lifecycle rather than a repeat suggestion; inbox moves need current inbox mail. Partial cleanup must retain a suggestion that still applies, and Undo/new inbox mail may make an inbox suggestion useful again. Historical engine records remain intact; suppressing a suggestion does not assert that future mail stopped.

Own the suggestion eligibility projection, sender page/inspector consumers, focused tests/stories and this audit. Integration owner: this chat. Reuse its clean isolated worktree on codex/post-action-suggestions, based on current origin/main 26e4817. No dependent PR, API/worker/schema change, or production mailbox write is planned.

## Diagnosis and bounded fix

The production sender detail showed Request accepted and zero inbox/archived mail alongside Suggested: Unsubscribe. The API deliberately retains the historical engine recommendation in the file-local `buildRecommendation` helper in `senders.read-service.ts`; the web adapter carries it through. Both the page and inspector rendered that stored read without reconciling current policy, unsubscribe lifecycle or mail counts. A fresh accepted response reproduced the contradiction, ruling out cache freshness as the primary cause.

The shared `currentRecommendation` presentation projection now checks those current facts at both the route (lazy scoring/explanation) and renderer (including local Keep/Protect state). It leaves engine history and scoring unchanged. Hidden historical reads do not trigger refresh/explanation work; never-scored Keep/Protected senders do not trigger scoring either.

| Current facts                                                  | Result                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keep policy or Protected                                       | Retire old suggestions; honor the user's standing choice.                                                               |
| Unsubscribe requested/accepted/unconfirmed                     | Lifecycle owns the result; suppress repeat Unsubscribe suggestion. Acceptance still does not prove future mail stopped. |
| Manual unsubscribe action/draft/sent                           | Existing lifecycle callout owns follow-up; suppress generic repeat suggestion.                                          |
| Legacy unsubscribe policy with null outcome                    | Preserve Outcome unknown, suppress repeat suggestion.                                                                   |
| Unsubscribe unavailable                                        | Preserve lifecycle information without an inapplicable recommendation.                                                  |
| Unsubscribe failed                                             | A still-relevant retry suggestion remains eligible.                                                                     |
| Explicit Unsubscribe policy plus historical Keep               | Suppress the contradictory Keep suggestion.                                                                             |
| Archive or Later, zero inbox mail                              | Retire the fulfilled inbox suggestion.                                                                                  |
| Partial or unknown inbox count                                 | Retain a still-applicable suggestion; never infer zero from missing counts.                                             |
| Defensive historical Delete, zero inbox and archived           | Retire it. Delete is not currently an engine primary recommendation.                                                    |
| Undo or new inbox mail                                         | Fresh eligible facts can restore the suggestion.                                                                        |
| Archive/Delete completed, future-mail Unsubscribe still useful | Retain that distinct suggestion; moving existing mail does not request unsubscribe.                                     |

No new visual component, action, preview bypass, provider write, schema, analytics event or historical-data deletion is introduced. The existing five actions and lifecycle callouts remain intact.

## Sibling flow audit

- Full sender page and inspector use the same route/ReadyState and now the same eligibility projection.
- Triage's `triageNotDecidedRecently` query already excludes completed Keep/Archive/Unsubscribe/Later/Delete activity for its existing seven-day window and respects reverts/Undo. That deliberate window is unchanged.
- Screener reads use `screenerAwaitingWhere`; durable terminal completion resolves `decidedAt`, while failures remain actionable. These paths do not blindly render the historical detail recommendation.
- Existing action cache invalidation and mutation/Undo tests remain intact. New route tests exercise fresh wire responses and completed readback/cache transitions for all five actions. They do not claim a new provider mutation was exercised.

## Regression and browser evidence

- Initial accepted-Unsubscribe regression failed in both page and pane against the old renderer (2/2), then passed with the projection.
- Negative control restored only the original renderer temporarily: all 10 new route assertions failed. The fixed source was restored in a `finally` block and independently reverified.
- Five focused web suites passed **153/153**: projection, sender page, inspector, recommendation banner and API adapter. Coverage includes lifecycle/legacy failures, zero/partial/unknown counts, cross-policy conflicts, no unnecessary scoring, readback and Undo/new-mail restoration.
- Triage read, Screener read and Screener service suites passed **75/75**. No API changes were needed.
- The web test runner emitted an existing socket-hang-up diagnostic while returning success; no failed assertion or nonzero test exit was suppressed.
- Built the real Next application with a temporary synthetic-only harness importing the committed stories. In Codex's built-in browser: accepted, Keep, Archive, Later and Delete completion facts hid fulfilled suggestions; restored inbox facts brought Archive back; partial cleanup (7 inbox/14 archived) retained Archive. Accepted and partial cases also passed in inspector layout. No real Gmail action was executed. The harness was removed before the final build/PR.
- Four committed stories cover accepted unsubscribe, completed Keep, empty inbox and partial cleanup. The change adds no focusable element or dialog; existing controls and keyboard/preview contracts are unchanged.

## Independent review and release boundary

The independent reviewer applied design-system and flow-completeness gates, found and verified fixes for legacy unknown/unavailable unsubscribe states, contradictory Keep suggestions and never-scored Keep/Protected refresh work. Final review found no implementation blocker or design-system violation; **63/63** independently run tests passed, including all 10 new route assertions.

Final build, workspace checks, normal merge-queue result, serving revision and read-only production UI verification will be recorded with the PR as they complete. Local synthetic behavior, merged source, deployed release and real production rendering are separate evidence. This follow-up performs no additional unsubscribe, deletion or mailbox mutation, and does not establish that a sender has stopped sending future mail.
