# Sender workspace design audit — 2026-09-22

## Scope and result

Production Senders and Sender Detail now use the approved warm editorial direction: compact evidence rows on the left, persistent inspector space on the right, serif identity headings, restrained bordered working surfaces, and an explicit selected-row treatment. This is the existing production feature, not the design-prototype fixture path. Shared application tokens and navigation are owned by the coordinating change.

The initial inspector invites selection without inventing a recommendation or auto-selecting a sender. Selecting a row mounts the existing live `SenderDetailRoute`. At the mobile-shell breakpoint of 760px and below, navigation opens the dedicated sender page. Narrow desktop windows retain the right inspector. Full-page and pane modes use the same content and mutation logic. Loading geometry now follows the split workspace.

## Data inventory

| Information                         | Presentation                                                    | Source and semantics                                                                                   |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sender name/address, brand identity | List and inspector identity                                     | Existing `Sender` projection; address retained, not replaced by domain                                 |
| Total received                      | List count with explicit “received”; inspector historical total | `totalReceived`, within retained/indexed history; not the current action set                           |
| Current inbox                       | Row evidence and inspector primary count                        | `inboxCount`; absent/null remains unknown, not zero                                                    |
| Recent volume                       | Inspector, with explicit 90-day label                           | Existing detail `monthlyVolume` contract and adapter; retained as-is                                   |
| Marked-read proportion              | Row evidence, explicit 90d; inspector statistics                | `readRate`, not email opens or confirmed reading                                                       |
| Third-party read-state adjustment   | Existing inspector explanation                                  | `readRateSweeperMarked`, displayed only when supplied and relevant                                     |
| 12-month volume trend               | Inspector evidence grid                                         | Existing sender timeseries and Spark component                                                         |
| Last seen, outbound correspondence  | Inspector evidence grid                                         | Existing `lastSeenDays`, `wroteToCount`; “You wrote”, not reply inference                              |
| Protection and exact reason         | Row shield, inspector toggle and visible reason                 | Existing protection state/reason and manual policy behavior                                            |
| Unsubscribe lifecycle               | Existing row and inspector status/callouts                      | Existing endpoint/manual/failed/uncertain states; no blanket success claim                             |
| Recommendation                      | Existing optional disclosure under actions                      | Existing verdict, reasoning, provenance, scored time and stale handling; separate from action emphasis |
| Recent messages                     | Existing detail list                                            | Subject, Gmail preview snippet, timestamp, read state, size and existing Gmail links                   |
| Decision history                    | Existing timeline and Activity link                             | Actual recorded actions, source, count and undone state; not engine suggestions                        |
| Result/axis counts                  | Header, filters and saved views                                 | Existing server aggregates and stale/missing cues; no page-sum substitute                              |

No contracts, API endpoints, Gmail fields, storage, billing, model calls or telemetry payloads were added.

## Behavior parity

| Existing behavior                                                                 | Status                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Search/typeahead, debounce, query state, widening recovery                        | Preserved; input styling only                                |
| Filter axes/chips, saved-view apply/save/delete, sort                             | Preserved; control geometry only                             |
| Domain rollups and expansion                                                      | Preserved                                                    |
| Cursor pagination, optional infinite loading, manual load more                    | Preserved                                                    |
| Checkbox and shift-range selection, bulk selection, mobile FAB                    | Preserved                                                    |
| j/k and arrow navigation, canonical action keys, typing/modal guards              | Preserved                                                    |
| Existing desktop pane query state, close, Escape, full-page link                  | Preserved                                                    |
| Phone navigation to dedicated sender page                                         | Preserved                                                    |
| Protected exclusions and explicit single-sender override                          | Preserved                                                    |
| K/A/U/L/D, mandatory preview, default age/reach choices, composite unsubscribe    | Preserved through the existing preview/confirmation pipeline |
| Action pending/working/completed/failed states, mailbox binding, overdue handling | Preserved                                                    |
| Undo/recovery, mailto continuation, bulk unsubscribe outcomes                     | Preserved                                                    |
| Stale-row inertness, scan pending/failed, no-match/empty/error states             | Preserved                                                    |
| Lazy-loaded inspector and existing query cache                                    | Preserved; no extra fetch dependency introduced              |

The only new visible facts are existing current-inbox and marked-read fields in the list, and current-inbox scope in the inspector summary. Unknown values do not become zero. No data/action controls were moved behind a new paywall or removed.

## Verification

- Existing list, screen, row, inspector, detail and confirmation suites exercised: 288 total tests across the final relevant runs. The prior test requiring exactly one number per row was updated to the approved richer evidence layout; it now verifies distinct lifetime/current/90-day scopes.
- Added a missing-evidence test proving absent inbox/read data is not rendered as zero.
- Added an inspector test proving current inbox, recent volume and historical total remain distinct; the existing pane test now asserts an unknown inbox renders an em dash.
- Final row/pane/screen rerun: 115 tests passed. Existing list/detail/confirmation tests passed before the subsequent presentation-only loading/control polish.
- Search/filter regression suites: 18 tests passed after control restyling.
- ESLint passes for changed production components; changed files formatted with Prettier.
- Next.js/React review: no new effects, subscriptions, API calls or render-time network dependencies; existing client/server boundaries and lazy inspector retained.

### Browser evidence handoff

The coordinating agent owns authenticated browser verification and screenshots. CUA Chrome and in-app browser entrypoints were unavailable in the sender subagent's tool environment; no live mailbox operations were attempted. The coordinator reported an authenticated local account with revoked Gmail and an empty mailbox, so that route alone cannot establish populated-state usability.

Populated Storybook surfaces for review:

- `senders-senderlist--default`
- `senders-senderlist--selected-and-open`
- `senders-senderlist--rows-say-what-is-happening`
- `senders-senderlist--phone`
- `senders-senderdetailpage--default`
- `senders-senderdetailpage--pane`
- `senders-senderdetailpage--protected`
- `senders-senderdetailpage--mobile-narrow`
- `senders-senderdetailpage--loading`, `--error-state`, `--empty`

The detail story harness now supplies its required query provider. Story samples remain story-only. Browser checklist: desktop selected row + inspector; 320/390px full-page detail; light/dark; long name/address wrapping; search/filter controls; all five action buttons; protection and preview visibility; recent messages and timeline; no horizontal overflow. No real Archive/Delete/Unsubscribe/Protect operations should be used for visual QA.

## Known limits

This change does not expand backend capability. Recommendations can be stale, read labels are not actual opens, unsubscribe acceptance does not prove mail will stop, and received totals differ from currently actionable messages. These distinctions remain explicit in the existing feature behavior.

## Inspector footer follow-up

The populated inspector now has a separate scrolling evidence region and one persistent K/A/U/L/D action group at the bottom. No duplicated active toolbar or new action handler is introduced. The full-page action location and shortcuts remain unchanged. Pane height reserves 300px for the full-width heading, shell and reconnection-banner space; the empty inspector follows the same bounds. Decision data and helper labels added by this change are at least 11px.

The Pane story explicitly includes 128 current inbox messages; `senders-senderdetailpage--pane-unknown-inbox` preserves the unknown-count case. Detail/pane/action-toolbar regression run passed all 73 tests, including one-and-only-one instance of each canonical action in the persistent group. Parent browser QA remains the source for pixel/overflow verification.

## Final integration follow-ups

Historical-email controls now remain available when preview counts happen to match, restoring production-main choice availability; existing empty-inbox and capability gates remain. Confirmation regression tests cover these choices. Mobile rows reserve readable space for identity, status and scoped evidence. Loading splits now use the same >760px breakpoint and proportions as the live workspace. The timeline empty state is location-neutral because pane actions sit below it. The final screen/pane focused run passed 95 tests; scoped lint passed.

Completed browser coverage and the live-mailbox verification boundary are recorded in [the integration handoff](design-integration-status-2026-09-22.md).

## Approved editorial composition parity

Compared the active `EditorialPrototype` sender JSX and final cleanup CSS overrides (rather than its obsolete sidebar styles). The page heading now precedes both columns and carries the terracotta italic “/ Make room.” accent. Search, saved views, filters, sort, bulk controls and the existing sender rows share one ruled list panel. Loading uses the same full-width heading and >760px split. Container-responsive row behavior is retained.

The inspector restores horizontal avatar/identity (44px avatar in pane), compact 30px sans-serif scope counts and thin-rule evidence sections. Current inbox, 90-day received, lifetime received, marked-read rate, history, protection and all five actions remain. No preview, mutation, undo, keyboard or polling handlers changed. The single action footer remains outside the scrolling evidence region.

Verification: five targeted screen/detail/pane/row/list suites passed all 181 tests; scoped ESLint passed. Browser comparison and overflow validation are owned by the coordinating agent.
