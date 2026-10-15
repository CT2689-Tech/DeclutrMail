# Sender actions and feedback clarity

## Flow contract

Owner and integration owner: this Codex session. Isolated branch: `codex/sender-action-clarity`. No dependencies on open PRs. Owned surfaces: sender list/detail action presentation, shared action copy, notifications and Undo presentation; related Triage help and saved-filter shortcuts. Existing design tokens and typefaces remain the design system; card/foreground surfaces and shared progress indicators distinguish feedback from controls.

Intent: decide what to do with a sender, preview the eligible mail, confirm, follow real progress to a terminal result, inspect current counts, and undo. Keep records a Triage decision without moving mail. Protected excludes bulk/automatic cleanup; manual overrides retain the existing preview acknowledgement. Later moves inbox mail to DeclutrMail/Later until the selected return time. Archived counts include Later because their source counts all non-inbox mail excluding Trash/Spam/Drafts/Chat. No separate Later count is available on the sender DTO, so do not invent one.

| State / transition                 | Presentation and recovery                                                                                         | Verification                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Idle / saved Keep / Protected      | Stable verbs, separate decision/safety labels and visible scope                                                   | Component tests and synthetic browser |
| Zero inbox / unknown counts        | Individual Archive/Later controls unavailable only for known zero; bulk scope and Delete archived reach unchanged | Regression tests                      |
| Preview / cancel / confirmation    | Existing scope, schedule and acknowledgement retained                                                             | Existing modal suites                 |
| Working / unknown outcome          | Separate status, sender remains locked; real progress persists                                                    | Row/status and tray suites            |
| Done / partial / failure           | Result carries affected emails, independent of current totals; retry remains discoverable                         | Row/tray regression suites            |
| Undo / revisiting / account switch | Existing server-confirmed reversal and mailbox isolation retained; compact control names recent actions           | Tray/Undo suites                      |

Exclusions: billing, onboarding, provider behavior changes, production mailbox mutations, new data collection, and redesign of unrelated screens. Browser verification uses synthetic local data. No real mail will be changed for evidence. Merge authorization comes from the user's AGENTS.md preference and remains subject to required reviews/checks.

## Findings and disposition

- Result replaces an action, sometimes remains clickable: separate action/result presentation in list and detail.
- Keep and Protected overlap in wording: explain the existing distinct policies at their controls; show saved Keep independently.
- Later destination/count is obscured by archived totals: label current totals and include the actual destination/return semantics, without a fabricated Later count.
- Notifications and Undo use opposing surfaces and an ambiguous compact Undo count: share the card surface and name the compact recent-actions control.
- Saved-filter shortcuts look selected: use explicit shortcut wording and neutral shared buttons.
- No-channel copy recommends Archive as a substitute for stopping future mail: state the observed capability only.

## Verification record

Before implementation, two new toolbar regressions failed against main: the Later button was replaced with a result, and zero-inbox Archive/Later remained offered. Final verification and review evidence will be recorded after implementation.

## Final checks and review

- Scoped web suite: 916 passed, 3 existing skips across 60 files; shared semantics/notification/Undo suites: 102 passed across 4 files. Full shared suite: 920 passed across 86 files after the CI glossary identified two new phrases; both were replaced without expanding its shrink-only baseline. Follow-up layout checks cover the final control grouping.
- Negative controls: original toolbar failed stable Later-label and zero-inbox assertions; failed Keep Undo had no Retry through the real ToastHost; compact recent-actions opener unmounted on hover/focus. Each regression passed with its corresponding repair.
- Keep Undo is reconciled after server confirmation for every completed sender (hook-level callbacks work for bulk too). Failure retains saved Keep state, offers Retry for transient errors, and preserves the server's Unprotect-first instruction for `PROTECTED_SENDER`.
- Independent reviewer: design-system gate and flow/copy/recovery review passed with no remaining blocker. Independent focused checks passed 32 tests, 8 Undo pill interactions, and 13 final row surface tests.
- Shared wording follow-up: 124 affected sender/Triage tests and all 17 Screener keyboard tests passed. Screener retains its disabled click/keyboard guard while expecting the same shared unsubscribe explanation. Independent glossary/capability review passed 21 tests.
- Built-in browser: real SenderList, sender actions, detail page, shared toast and Undo components with explicitly synthetic data in local Next development. Checked 1280px desktop, 375px and 320px phone widths, light/dark themes, Protected and saved Keep, zero/unknown counts, working/success/failure, compact history opening and Undo count restoration. Final 320px DOM content width matched viewport; no horizontal overflow. Saved synthetic screenshots outside the repository.
- Initial hot-reload barrel cache and temporary fixture timestamp hydration errors were removed from the final verification run; the final reload/action had no new browser JavaScript/hydration error. The fixture-only local route was removed before the release build. Local API guard reads return expected 404 without an API server; provider completion is covered by existing integration seams, not claimed from this component smoke.
- No production mailbox mutation, provider request, billing change, schema change, permission change, or telemetry data collection was performed.

## Deferred opportunity

Keep has no durable Undo entry after its short notification expires. The existing policy Undo API still permits reversal; exposing it persistently in saved-decision management is a separate small enhancement. Mail-changing actions retain their existing Activity Undo windows, and this change does not alter those windows or provider recovery.

Release web build, all-workspace typecheck and lint passed (six existing unused-disable warnings, no lint errors). All 51 bundle budgets and 32 public-route prerender checks passed. The PR records the exact commit and integration state. This audit records local/synthetic verification, not a live Gmail-provider journey.
