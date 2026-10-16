# Delete to Undo audit — 2026-10-15

## Flow contract and ownership

Audit Delete → mandatory preview → confirmed Trash result → zero-current sender removal → Undo → confirmed provider restoration → sender/count/control recovery without reload. Preserve each email's original Inbox or archived location and any independent accepted unsubscribe state. A partial Delete keeps the sender with remaining current counts; Undo restores only the frozen deleted message IDs. Unknown, failed or partially restored results must not be called complete.

Use the existing isolated worktree on fresh main `2bf3493dc`, branch `codex/delete-undo-refresh`. This task owns the sender page/list lifecycle tests, Undo completion contract and affected readers if a defect is reproduced, plus this audit. The independent reviewer inspects provider restoration and final correctness without authoring the repair. Open PR #1044 overlaps the detail heading only; no dependency or ownership claim. Integration owner: this task. Follow existing authorization for normal review, queue merge and deployment.

Default exclusions: onboarding, billing, OAuth permissions, privacy/retention changes, permanent deletion, broad mailbox mutations and unrelated visual redesign. Synthetic fixtures cover destructive/failure cases. A production mailbox mutation, if needed, must have a concrete narrow target and restoration plan before execution; no credentials or real mailbox content enter repository evidence.

| Transition                             | UI and data expectation                                                                                                     | Verification                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Eligible current mail                  | Preview uses current scope and exact count                                                                                  | Synthetic tests/browser; release pending |
| Delete queued/running                  | Prevent duplicate dispatch; no premature success                                                                            | Synthetic tests/browser; release pending |
| Delete confirmed, zero current mail    | Remove list row; detail shows zero and inert mail-moving controls; Undo stays available                                     | Synthetic tests/browser; release pending |
| Delete confirmed, current mail remains | Keep row with actual remaining counts and eligible controls                                                                 | Synthetic tests/browser; release pending |
| Undo queued/running                    | Wait for every restore operation in the chosen scope                                                                        | Synthetic tests; release pending         |
| Undo confirmed                         | Restore original locations; row returns when it matches filters; counts and controls reconcile without reload or Gmail sync | Synthetic tests/browser; release pending |
| Undo partial/failure/unknown           | Honest failure/retry state; re-read any partial change                                                                      | Synthetic tests; release pending         |
| Undo after accepted Unsubscribe        | Preserve accepted request; never reopen one-click dispatch                                                                  | Synthetic tests/browser; release pending |
| Account/scope switch                   | Prevent old-scope feedback/cache writes in the new mailbox                                                                  | Synthetic tests; release pending         |

## Findings and opportunities

Existing worker source restores the frozen Inbox and archived partitions separately and updates the local metadata mirror before successful terminal status. The single Delete cycle was correct, but its old list test omitted current counts and never proved actual zero-current removal. Replaced it with complete stateful page/list regressions and retained the accepted Unsubscribe state.

| Finding                                                                                                       | User effect                                                                             | Repair                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2: whole-decision Undo exposed only the first reverse job; already-reverted primary short-circuited siblings | Success and one cache refresh could precede other email restoration                     | Return every reverse handle; poll the frozen set in one bounded read. Whole-decision replay checks unfinished siblings. Explicit Activity/member scope stays one action. |
| P2: retries reused the same cached terminal reverse result                                                    | A second attempt could instantly fail again without reading the new queued work         | Reset matching scoped progress before successful enqueue subscribers enable their poll. Regression uses production 30-second stale time and deferred fresh status.       |
| P2: Inbox Report hid Undo after failed or unavailable progress                                                | No retry path or clear feedback                                                         | Restore the button and show existing failure/unknown copy for panel-owned attempts. External tray watchers stay quiet.                                                   |
| P2: external restore handles/callbacks survived mailbox changes                                               | A late old-mailbox result could clear new-mailbox feedback or poll with the wrong scope | Reset/tag handles, guard mutation observers and callback generations, and preserve origin scope.                                                                         |

No worker/provider mutation contract, Undo window, cleanup scope, schema, permission, billing or Gmail data collection changed.

## Verification and release

Current evidence before release:

- Single Delete UI cycles pass for mixed 3 inbox / 2 archived and archived-only 0 inbox / 21 archived, in list and both detail layouts, using real cache/status hooks with a synthetic API. No reload/remount/manual cache update causes restoration.
- Built-in browser exercises the actual page, list, inspector, mandatory preview and global Undo tray using an isolated synthetic transport. Full Delete removes the row; Undo restores it and eligible controls. Partial Delete keeps the remaining archived count visible. Archived-only Undo restores 0 inbox / 21 archived; Archive/Later remain inert, Delete becomes eligible, accepted Unsubscribe stays inert. Desktop and 320px phone checked; scrollWidth 310 <= 320; no console errors. Fixture-only unavailable endpoint warnings were observed. Temporary harness, tab and owned dev server removed before production build.
- Final affected suites pass 331 web tests across nine suites and 167 API tests across three suites. The shared glossary suite passes four tests. Existing socket/localhost diagnostic output is not represented as warning-free. Independent reviewer passed 12 API and 52 web cases, plus 11 later recovery/account/report cases, typecheck and lint; six existing unrelated lint warnings.
- Independent review applied architecture, design-system, usability, React and state/account criteria and found the retry/scope/feedback gaps above; they were repaired and re-reviewed. A clean production web build, 51-route bundle budget, public prerender check, root typecheck, root format check and lint all pass. Lint reports six existing unrelated warnings.
- No production mailbox mutation performed so far. Live Gmail restoration is not proved by synthetic transport/provider tests or a successful deployment.

## Read contract and rollout

`POST /api/actions/undo-status` is a read-only HTTP 200 endpoint under existing mailbox/auth/CSRF guards and the existing 120-per-minute read bucket. The strict request contains 1–2,000 UUID `actionIds` (up to two label jobs per 1,000-sender decision). One database read verifies every distinct ID is a reverse job owned by that mailbox. It reports progress until all are terminal, failure if any failed, and success only when every successful job has a committed reversal journal. Unknown journal/read outcomes stay unconfirmed. Only aggregate counts/status are returned; no message identifiers/content are added.

Undo responses add optional `actionIds` while retaining `actionId`; clients fall back to the old single-handle read when the array is absent. Both API and web releases must be verified before claiming this whole-decision repair live. Completed/legacy token replay stays queue independent; a new whole-decision Undo refuses still-running reversible forward siblings rather than silently excluding them. This repository has no tracked OpenAPI document; typed/Zod contracts and controller tests document the read boundary.

## Prioritized opportunities and exclusions

- Implemented: current counts and original-location-aware control recovery using existing metadata, complete-scope progress, fresh retries and isolated mailbox feedback. No new analytics/data collection.
- Deferred: a per-sender partial-restore breakdown could help explain failed multi-sender Undo; existing aggregate affected counts provide a starting point, but designing that additional result surface is outside this bounded correctness repair.
- Existing provider test boundary: fake Gmail checks original-label partition calls, not independently observed Gmail labels. A narrow approved live cycle requires before/after message-label readback and restoration verification. No broad restore, permanent delete, unsubscribe request or test email is needed or authorized by this audit record.

## Regression and negative-control evidence

- Final affected web run passes 331 tests across nine suites, including restored row/count/control state, group progress, Activity scope, retained-row reads, retry and account boundaries.
- Restoring only the old primary-token shortcut makes the new replay test fail: `reverted` is true while a sibling remains queued. Restoring cached progress makes the production-stale-time retry assertion fail with the old terminal snapshot. Both temporary source changes are restored in `finally`.
- Before the report repair, two new failed/unknown cases could not find the hidden Undo button; the successful case passed. With repair, success waits for the group and failure/unknown retains retry and visible feedback.
- Temporary local route and server were removed. Its generated Next cache is preserved outside the checkout, and the clean production build regenerates route types without the temporary fixture. A resource-contention glossary timeout was rerun under normal load and passes without changing its baseline or timeout. Merged, deployed and live-verified states will be recorded separately in the PR.
