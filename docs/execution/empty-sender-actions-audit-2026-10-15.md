# Empty sender action audit — 2026-10-15

## Contract and ownership

Confirmed zero inbox mail disables Archive and Later. Confirmed zero inbox and zero archived mail disables Delete. Archived mail still permits an explicit Delete preview, including its all-mail option. Unknown current counts must not be represented as zero; the mandatory preview resolves their scope. Lifetime received totals do not determine present actionability. Keep and future unsubscribe intent remain independent of current mail counts.

Own shared sender capability rules, page/pane/list/menu/shortcut/selection consumers, stale-confirm checks and focused tests/stories. Integration owner: this task on isolated `codex/empty-sender-actions`, based on fresh main `4e6a1ca`. PR #1060 independently changes sender feedback and has local zero-inbox gates; preserve its design and avoid duplicate work. No API, provider, schema, billing or permission changes. No real Gmail mutation to generate evidence.

## States to verify

| State                                        | Expected action controls and dispatch                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Inbox 0, archived 0, positive lifetime total | Archive/Later/Delete inert, visible reason; click/shortcut/menu/selection cannot submit        |
| Inbox 0, archived positive                   | Archive/Later inert; Delete preview remains available                                          |
| Inbox positive                               | All mail-moving actions available with preview, subject to existing protection/lock/plan rules |
| Count null / unavailable                     | Never a false zero; retain fresh preview                                                       |
| New zero readback while preview open         | Refuse obsolete dispatch; preserve scope rather than silently change it                        |
| Mixed empty/eligible/protected selection     | Accurate eligible counts and exclusion explanations, no empty-mail entries dispatched          |
| Successful cleanup / Undo / new mail         | Controls follow reconciled current counts; recovery and policy actions remain available        |

## Findings and evidence

Live authenticated original sender page reproduced current inbox 0 / archived 0 with active Archive, Later and Delete. Source confirms shared capability predicates return true regardless of counts. The three highest-ranked hypotheses were channel/count-independent capability predicates, lifetime/current-count confusion, and obsolete confirmation facts. Tests fail against the original predicates; source uses no lifetime total in capability checks, but ignored current locations entirely. Immediate readback tests independently reproduce the stale-confirm risk.

| Finding                                                        | Severity / effect                                                         | Repair and evidence                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared predicates always allowed mail moves                    | P2: zero-current page exposes actions that have no work                   | Exact current-zero predicates; toolbar/page/pane/menu/lead/swipe/selection use them. Clear reason text. Archived-only Delete and unknown-count preview retained.                                                                                                           |
| Confirmations retained old positive facts                      | P2: another surface can empty the sender after preview                    | Extend dispatch-time trusted canonical/completion readback to Archive/Later/Delete. Original page/list code submits once in all six new race cases; fixed code submits zero. Preserve newer positive reads after old zero and ignore invalidated records.                  |
| Bulk exclusions assumed only protection/unsubscribe capability | P3: empty rows would be described as people and remain in submitted scope | Explicit empty-mail skip count and per-action scope copy. Empty rows are removed before preview and dispatch; positive Protected rows remain for existing server exclusion/reporting. Composed empty + eligible + Protected test verifies both reasons and exact selector. |
| Done feedback could still advertise acting again               | P3: completion label retained a repeat hint when count now zero           | Keep completed count/Undo feedback, but no “again” wording or pointer treatment for unavailable actions.                                                                                                                                                                   |

## Verification and boundaries

- Initial negative regressions: old predicates/toolbar fail six assertions (empty mail and archived-only matrix). Unknown counts remain unknown rather than a false zero.
- Dispatch negative control: temporarily restoring the original page/list implementations fails all six immediate-zero tests with one POST when zero is expected; a `finally` block restores both files.
- Built-in browser with real components and synthetic senders: empty controls/menu/selection disabled; A/L/D shortcuts emit zero actions. Archived-only Delete emits one synthetic action; unknown counts permit preview entry. Desktop and 320px compact layout checked, scrollWidth 310 <= 320; no console errors. Phone sheet explains archived-only unavailable Archive/Later. Temporary harness and owned server removed before the clean production build.
- Independent reviewer applied design-system, flow and usability criteria: 120 tests passed before final composed fixture follow-up; no implementation blocker. Advisory mobile copy and combined Protected case addressed.
- Current-head tests: 487/487 pass across 10 affected suites. Typecheck and lint pass (0 errors, 6 existing unrelated warnings). Clean production build, all 51 route bundle budgets and 32 static public prerender checks pass; root formatting also passes. Post-merge serving/browser evidence will be recorded with the PR as it completes. Production verification is read-only; no Gmail move, unsubscribe, Undo or restoration is performed to generate evidence.

## Opportunities and exclusions

The implemented improvement is clearer eligibility/exclusion reasons using existing current counts. No new data collection is needed. Broader feedback/layout work belongs to #1060 and is preserved during integration. New provider status, changes to cleanup scope, retention, billing, onboarding, account permission, server execution, and Undo contracts are out of scope. Fresh preview remains authoritative for age windows, all-mail scope, protected overrides and quota. Existing backend enforcement is unchanged.
