# Archive and Later to Undo audit — 2026-10-15

## Flow contract and ownership

Audit Archive → preview → completed movement → Undo and Later → dated preview → completed movement → Undo on the sender page, inspector and list. Archive/Later affect eligible Inbox mail only; existing archived mail remains current. Neither operation should remove a sender from the unfiltered current-mail list. Preserve the approved completed-row retention rule: even if an Inbox-only filter drops the server row, retain the completed row with fresh counts while current archived mail remains; Undo returns it to the matching server result. Current counts, suggestions, action availability and completed-result marks must follow confirmed state without reload or manual sync. Preserve an independent accepted unsubscribe request.

Later additionally applies the resolved Gmail Later label and schedules return. Undo removes that label from this action's frozen IDs and clears its return schedule only when safe, preserving any newer or remaining Later work. Partial time-window actions retain the actual remaining Inbox and archived counts. Unknown/failed progress cannot count as successful restoration.

Reuse the attached isolated worktree on fresh main `fe7c0f262`, branch `codex/archive-later-undo`. Integration owner: this task. Own affected sender lifecycle tests and bounded repairs supported by reproduction, plus this audit. Independent reviewer traces provider/timer semantics without authoring repairs. Open #1044 overlaps the detail heading only; no dependency. #972 worker-pool migration is unrelated and excluded. Follow existing authorization for normal checks, queue merge and release of requested repairs.

| Transition                                   | Expected UI and data                                                                                                                   | Evidence                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Current Inbox + archived mail                | Exact eligible Inbox count in preview; archived mail unaffected                                                                        | Page/pane/list lifecycle cases and rendered synthetic smoke                     |
| Preview cancelled, unavailable or stale-zero | No mail mutation; retry/close remains available                                                                                        | Existing stale preview/cancel/zero tests; no contract change                    |
| Archive confirmed                            | Inbox decreases, archived increases; unfiltered row stays; a filtered-out completed row retains fresh facts while current mail remains | Page/pane/list lifecycle cases and rendered synthetic smoke                     |
| Later confirmed                              | Same count movement; Later label and return time recorded                                                                              | Page/pane/list lifecycle cases and rendered synthetic smoke                     |
| Undo queued/running                          | Prevent duplicate restore; wait for complete frozen reverse set                                                                        | Shared #1063 contract; caller sweep and real aggregate lifecycle tests          |
| Undo confirmed                               | Original Inbox/archived counts and controls return; result mark clears; row returns under matching filter                              | Page/pane/list lifecycle cases and rendered synthetic smoke                     |
| Later Undo confirmed                         | Original labels restored; completed schedule removed without disturbing newer/remaining Later mail                                     | Page/pane/list lifecycle cases and rendered synthetic smoke                     |
| Partial/unknown/failure/account switch       | Honest feedback, fresh partial readback, retry and scope isolation                                                                     | Existing #1063 failures/isolation plus Activity done/failed warmed-reader cases |

Exclusions: onboarding, billing, OAuth/privacy/retention changes, migrations, Undo-window changes, unrelated redesign, broad mailbox mutations and real unsubscribe requests. The previous one-email Delete test is complete and does not authorize additional live mail moves. Prepare any further production test with a named minimal target and exact restoration plan before requesting approval.

## Findings, verification and release

### Fixed finding

P2 — Later's list and recovery alert were omitted from terminal-action, global Undo and Activity Undo refreshes. The list keeps a five-minute fresh cache and its screen/recovery alert normally poll every 60 seconds. Newly moved mail could stay absent, or an undone row and recovery warning could linger until that periodic read. This is a cache omission, not a provider/timer restoration defect.

Added the canonical `snoozedKeys.all` prefix to the three existing refresh paths. This refetches active readers and marks inactive cached readers stale without new polling, retries, provider writes or data collection. Failed/unknown results still refresh possible partial changes. The separate Activity action-only Undo keeps its existing scope.

### Evidence and boundaries

- Four new/extended warmed-reader cases fail against main before the repair: the real Later screen does not show newly moved mail or remove an undone row/recovery alert, and Activity's done/failed outcomes leave fresh Later readers unchanged. All four pass after the cache repair.
- Ten page/pane cycles and seven list cycles cover complete Archive/Later, partial Archive, original mixed counts, accepted Unsubscribe preservation, action availability and Undo result clearing without reload/remount/manual invalidation. Filtered-out completed rows retain current archived mail with fresh facts under the previously approved retention rule; Undo returns the row to the server's matching result.
- Full affected web run: 352 tests across 11 suites pass. Root lint passes with six existing unrelated warnings. Existing socket diagnostic output is preserved rather than described as warning-free.
- Independent reviewer reproduced the missing cache boundary, swept terminal readers and Activity's direct transport, and passed eight cache cases, 17 lifecycle cases and seven worker cases. Worker/API restoration is unchanged: Archive Undo adds Inbox; Later Undo also removes the resolved Later label and clears only a matching safe timer. Existing stale-version wake tests protect replacement schedules. Fake provider acceptance and mirror checks do not prove actual Gmail labels.
- Built-in-browser smoke on real production components with isolated synthetic transport passed full page Archive/Later cycles, a 320px inspector Later cycle and list Archive/Later cycles. Counts change from 3 Inbox / 2 archived to 0 / 5, then return to 3 / 2 on confirmed Undo; Archive/Later disable at zero Inbox while Delete stays eligible, accepted Unsubscribe stays inert and the result mark clears. A warmed five-minute Later reader changes 0 → 1 → 0 senders without reload, remount, manual invalidation, focus or waiting for the periodic poll. Escape closes the list menu and preview focus starts on Cancel. No console warnings/errors were captured. Screenshots and state readback remain outside the repository. The temporary fixture route was removed before build.
- Clean production build, root typecheck, full formatting, bundle budgets (51 routes) and prerender checks pass. The final typecheck caught an accidental duplicate test fixture in an adjacent test; it was removed, the full 170-case list suite passed again, and root typecheck passed. Independent final review reports no implementation, privacy or caller blocker. CI/queue/release remain pending; no production mutation performed for this follow-up. Source/tests, merged/deployed state and real Gmail readback will be reported separately.

### Opportunities and exclusions

- Implemented: immediate refresh of the existing Later list/recovery facts on all relevant action and Undo completion paths.
- Deferred: a dedicated per-action Later schedule history could explain why an older Undo preserves a newer or shared timer. The existing timer/version data supports investigation, but a new history surface is outside this bounded consistency repair.
- No worker/provider, Undo window, schema, billing, OAuth, retention or analytics change. Live verification, if approved, uses one named email for Archive → Undo and Later → Undo with exact original-label readback after each cycle.
