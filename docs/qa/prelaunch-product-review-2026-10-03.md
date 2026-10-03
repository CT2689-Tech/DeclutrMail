# DeclutrMail pre-launch product review — 2026-10-03

**Recommendation:** address the 25 P2 findings before broad public marketing, then complete an authenticated release rehearsal. The audit also flags 14 P3 improvements and one verification-fixture gap. No P1 defect was established in the reviewed scope; that is not a launch sign-off.

This is a new read-only audit of the current working tree at base commit `f4843f07`, including the prior homepage/copy work. No product code, mailbox data, subscriptions, or account settings were changed during this audit. All findings below remain open.

## Reviewers and coverage

| Review                                | Scope                                                                                                                                                       | Evidence                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Public/content reviewer               | 47 public routes; every guide, answer, essay, comparison and alternative; 17 FAQ answers; 17 changelog entries; 35 legacy redirects; feeds/SEO/error states | Source and contract inspection                                                |
| Core-flow reviewer                    | Home, Senders/list/detail, Triage, Screener, Later, Activity, shared shell and recovery                                                                     | Source, tests inspected, selected mobile fixtures; safe keyboard reproduction |
| Account/settings reviewer             | Sign-in, onboarding, Autopilot, Quiet, Brief, Follow-ups, Billing, all Settings pages, account deletion, admin                                              | Source and state/test inventory                                               |
| Independent visual/accessibility pass | 48 public routes; 113 selected states across 63 app Storybook groups; 20 additional fixture checks                                                          | Browser DOM, axe, screenshots, source applicability checks                    |

The production inventory contains **66 concrete route entries/families**: 48 public routes and 18 authenticated/onboarding entries, including `/senders/[id]`. Development prototypes are excluded from that count; their production exclusion was checked in source. The detailed route/state inventory and reviewer notes are in [review.json](/Users/chintant/projects/DeclutrMail/docs/qa/prelaunch-2026-10-03/review.json).

Public pages were opened at 1440px in light mode and checked at 320px in light mode. All 48 loaded without a Next error overlay, page overflow, broken visible images, or unresolved local fragment links. Main-content axe checks found no violations in those light-mode pages. Every public route also received a 320px dark screenshot; 10 representative dark public pages received axe checks and had no reported violations. These are bounded checks, not proof that every interaction is accessible.

Authenticated screens were reviewed through their implementation and component fixtures. The 113-state pass covers selected major populated, empty, error, loading, preview, tier and recovery variants, not every possible combination. Four stories failed to render and two displayed an unintended blank/error state (QA-01). Narrow standalone helper stories with deliberate fixed desktop widths were excluded from product overflow findings; the full-screen Triage and expanded Screener findings below use their production layout.

## Fix order

| Order | Work                                                                                           | Findings                                                                         |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | Guard actions while dialogs, filters and provider mutations are pending                        | CORE-01, CORE-03, SYS-02                                                         |
| 2     | Restore reliable time, entitlement and connection recovery behavior                            | CORE-02, SYS-01, SYS-04, CORE-05, CORE-06, CORE-08, SYS-07                       |
| 3     | Keep small-screen escape/navigation controls visible and destructive text readable             | UI-01, UI-02, UI-06, SYS-09, UI-03, CORE-09                                      |
| 4     | Make counts, dates, saved receipts and safety/billing claims match verified state              | PUB-01, PUB-02, PUB-03, PUB-05, CORE-04, CORE-07, SYS-03, SYS-05, SYS-06, SYS-08 |
| 5     | Close QA-01 and rehearse the actual authenticated flows; then address P3 copy/structure polish | Remaining findings below                                                         |

P2 means a meaningful behavior, recovery, trust or accessibility issue to address before public marketing. P3 means a smaller consistency, semantic or presentation improvement. Priority is not a claim that an unexecuted server consequence has been observed.

## Findings

### Core decisions and recovery

#### CORE-01 · P2 · Triage decision shortcuts remain active behind modal dialogs

**Where:** /triage. **State:** Keyboard Help or another dialog open over focus card

**Fix:** Apply a shared keyboard ownership guard before invoking any decision shortcut; suspend underlying decision listeners while modal help, navigation or data controls own focus. Add a regression test for opening Help then pressing a verb.

**Evidence and limits:** Browser verified safely: 390px triage-triagescreen--default; '?' opened one aria-modal Keyboard Shortcuts dialog. A single 'A' then opened Archive email from Groupon behind it, leaving two aria-modal dialogs. No confirmation or write performed. Keep write consequence is source-verified only.

- [apps/web/src/features/triage/action-toolbar.tsx:99](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/action-toolbar.tsx:99) — Window key handler suppresses only typing/modifiers/verb capability, then invokes onAction; it has no modal/dialog ownership guard.
- [apps/web/src/features/triage/focus-card.tsx:65](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/focus-card.tsx:65) — actionsDisabled is only busy or inlinePreviewGates.blocked; Keyboard Help/dialog state does not disable it.
- [apps/web/src/features/triage/focus-card.tsx:279](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/focus-card.tsx:279) — Toolbar keyboardEnabled is tied only to actionsDisabled.
- [apps/web/src/features/triage/triage-screen.tsx:1215](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/triage-screen.tsx:1215) — Keep is dispatched immediately via dispatchAction, while other verbs open pending preview.
- [apps/web/src/features/triage/focus-stack.tsx:80](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/focus-stack.tsx:80) — Sibling Skip handler already suppresses shortcuts when any aria-modal dialog is present.

#### CORE-02 · P2 · Custom Later time uses device timezone while the screen and presets use account timezone

**Where:** /later. **State:** Custom return time while device timezone differs from account preference

**Fix:** Interpret the custom wall time in the same explicit account zone as presets/rows, or clearly name and consistently display the device zone. Preview the resolved return time before saving, including DST handling.

**Evidence and limits:** Source plus pure runtime demonstration: with device TZ=UTC/account America/Los_Angeles, entering 2026-10-04T09:00 serializes 09:00Z and renders back as 2:00 AM Los Angeles, seven hours earlier than the apparent 9:00 AM choice. No application timer changed. Existing screen tests mock account zone to device zone and do not cover this difference.

- [apps/web/src/features/snoozed/snoozed-screen.tsx:121](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snoozed-screen.tsx:121) — Page explicitly identifies return times with useUserTimeZone account zone.
- [apps/web/src/features/snoozed/snoozed-screen.tsx:511](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snoozed-screen.tsx:511) — Change return menu computes presets in the account timezone.
- [apps/web/src/features/snoozed/snoozed-screen.tsx:534](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snoozed-screen.tsx:534) — Custom validation parses datetime-local with new Date(custom), which uses device-local zone.
- [apps/web/src/features/snoozed/snoozed-screen.tsx:590](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snoozed-screen.tsx:590) — Custom submission serializes device-local Date directly; the account timezone is not used.
- [apps/web/src/features/snoozed/snooze-times.ts:139](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snooze-times.ts:139) — Preset contract explicitly says saved wall time should match the zone rendered by Later rows.
- [apps/api/src/senders/snooze.service.ts:80](/Users/chintant/projects/DeclutrMail/apps/api/src/senders/snooze.service.ts:80) — API persists the supplied ISO instant; it cannot recover the intended timezone.

#### CORE-03 · P2 · Stale Activity rows are blocked for pointer users but remain actionable from the keyboard

**Where:** /activity. **State:** URL filter transition with placeholder rows retained

**Fix:** Make the retained results inert while the filter changes, and guard mutation/selection callbacks against stale-query context. Keep filter controls usable and communicate the loading state.

**Evidence and limits:** Source-only; native pointer-events:none does not suppress keyboard focus/activation. No live filter-transition Undo attempted. Existing tests inspected without running; no keyboard placeholder-transition coverage found.

- [apps/web/src/features/activity/api/use-activity.ts:78](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/api/use-activity.ts:78) — keepPreviousData retains the previous filter rows during a new filter fetch.
- [apps/web/src/features/activity/activity-screen.tsx:368](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/activity-screen.tsx:368) — showingStaleRows is query.isPlaceholderData; surrounding comment intends stale rows to be non-interactive.
- [apps/web/src/features/activity/activity-screen.tsx:470](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/activity-screen.tsx:470) — Wrapper has aria-busy and pointerEvents:none, but no inert or descendant disabled guard.
- [apps/web/src/features/activity/activity-screen.tsx:2578](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/activity-screen.tsx:2578) — Undo invokes mutation on click/keyboard activation; disabled only tracks an already pending Undo, not stale-filter data.
- [apps/web/src/features/activity/activity-screen.tsx:318](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/activity-screen.tsx:318) — Selection toggle also has no placeholder-data guard.

#### CORE-04 · P2 · Zero-match preview promises a confirmation result while disabling confirmation

**Where:** /screener. **State:** Archive/Later/Delete preview with true zero matching email

**Fix:** Align zero-state explanation with the gate. Preserve the zero-move safety guard and direct users to Keep when they intend to record a decision without moving email; test the note and disabled button together.

**Evidence and limits:** Source and test inspection only; no zero-match rendered fixture available and no decide mutation attempted.

- [apps/web/src/features/screener/decide-preview.tsx:205](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/decide-preview.tsx:205) — Zero-match note says Confirming records the decision and removes the sender from Screener.
- [apps/web/src/features/screener/decide-preview.tsx:220](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/decide-preview.tsx:220) — confirmDisabled is true for every mail-moving verb whose liveCount is 0.
- [apps/web/src/features/screener/decide-preview.test.tsx:401](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/decide-preview.test.tsx:401) — Existing zero-header test still comments that Confirm stays live and asserts the promise, without asserting actual enabled state.
- [apps/api/src/screener/screener.service.ts:158](/Users/chintant/projects/DeclutrMail/apps/api/src/screener/screener.service.ts:158) — API can resolve a zero-message no-op, but this UI intentionally blocks zero-count execution, so that API capability is not reachable from this button.

#### CORE-05 · P2 · Unresolved sync failure disappears from primary chrome merely because it aged

**Where:** shared shell. **State:** Incremental sync error older than 60 minutes with no later success

**Fix:** Keep unresolved latest sync outcomes discoverable until a newer success, explicit dismissal with persistent status, or reconnection. A quiet persistent status can replace a prominent stale banner, but age alone should not imply recovery.

**Evidence and limits:** Browser verified: hidden-when-stale rendered only its explanatory story note; data-testid sync-error-banner was absent. Source confirms there was no successful stamp. Existing tests intentionally encode expiry, so this is a product-reliability issue despite passing expectations.

- [apps/web/src/features/sync/sync-error-banner.tsx:133](/Users/chintant/projects/DeclutrMail/apps/web/src/features/sync/sync-error-banner.tsx:133) — A later successful sync legitimately clears the error.
- [apps/web/src/features/sync/sync-error-banner.tsx:138](/Users/chintant/projects/DeclutrMail/apps/web/src/features/sync/sync-error-banner.tsx:138) — A retryable error also clears after SYNC_ERROR_WINDOW_MS without evidence of recovery.
- [apps/web/src/features/sync/sync-error-banner.stories.tsx:140](/Users/chintant/projects/DeclutrMail/apps/web/src/features/sync/sync-error-banner.stories.tsx:140) — HiddenWhenStale fixture has last_synced_at:null and a 90-minute-old terminal error.
- [apps/web/src/features/mailboxes/account-menu.tsx:335](/Users/chintant/projects/DeclutrMail/apps/web/src/features/mailboxes/account-menu.tsx:335) — Account menu still labels the same unresolved ready mailbox Not syncing only when health reads are mounted by opening it.

#### CORE-06 · P2 · Triage empty completion language can claim the user is done before the mailbox is ready

**Where:** /triage. **State:** Empty queue during queued/syncing/failed readiness after an earlier decision

**Fix:** Compose empty-state readiness before completion language. Keep any real today tally, but show that scan/reconnection is incomplete or failed and expose its recovery action.

**Evidence and limits:** Source-only for the broken readiness cases. Browser verified ordinary ready/empty-quiet presentation. Existing test confirms the positive-decisions failure case is currently intentional rather than an untested guess.

- [apps/web/src/features/triage/triage-screen.tsx:234](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/triage-screen.tsx:234) — Only failed readiness is derived; queued/syncing are not passed to the empty state.
- [apps/web/src/features/triage/triage-screen.tsx:1563](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/triage-screen.tsx:1563) — Empty state receives a syncFailed boolean rather than full readiness.
- [apps/web/src/features/triage/empty-state.tsx:71](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/empty-state.tsx:71) — Failed scan branch only applies when decidedToday===0.
- [apps/web/src/features/triage/empty-state.tsx:90](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/empty-state.tsx:90) — Zero-decisions branch asserts Nothing needs a decision regardless of queued/syncing readiness.
- [apps/web/src/features/triage/empty-state.tsx:161](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/empty-state.tsx:161) — Positive-decisions branch says You are done for now even with syncFailed=true.
- [apps/web/src/features/triage/empty-state.test.tsx:39](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/empty-state.test.tsx:39) — Existing test explicitly preserves omission of failed-scan copy once there was progress today.
- [apps/web/src/features/onboarding/derive-step.ts:60](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/derive-step.ts:60) — Already-onboarded users bypass initial-readiness gating, so these states remain reachable in the core app.
- [apps/web/src/features/screener/empty-state.tsx:37](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/empty-state.tsx:37) — Sibling Screener empty state distinguishes scan-in-progress and failed readiness instead of claiming completion.

#### CORE-07 · P2 · Error copy asserts untouched state and automatic background recovery without outcome evidence

**Where:** root/global errors, core route errors and account menu. **State:** Render failure or ambiguous mutation failure

**Fix:** Delete unverifiable assurances and automatic-retry promises. State only what could not be loaded or confirmed, give one next step, and reconcile ambiguous write outcomes before claiming no change. Keep factual Gmail safety statements only when the operation contract proves them.

**Evidence and limits:** Root AppError default browser fixture displayed the exact assurance/background-retry copy. Global behavior and ambiguous-write examples are source-only; no crashes, deletions or Keep writes induced. Parent-reported blank GlobalError fixture is a coverage gap.404 is not blanket included.

- [apps/web/src/app/error.tsx:53](/Users/chintant/projects/DeclutrMail/apps/web/src/app/error.tsx:53) — Root error promises mailbox/decisions untouched and retry the rest in the background, but only passes reset/escape to RouteErrorScreen.
- [apps/web/src/components/route-error-screen.tsx:61](/Users/chintant/projects/DeclutrMail/apps/web/src/components/route-error-screen.tsx:61) — Boundary only captures diagnostics and exposes manual reset/escape; it does not reconcile mutation outcome or schedule background retry.
- [apps/web/src/app/global-error.tsx:102](/Users/chintant/projects/DeclutrMail/apps/web/src/app/global-error.tsx:102) — Global heading says DeclutrMail is reloading although reload begins only on the explicit reset button.
- [apps/web/src/app/global-error.tsx:112](/Users/chintant/projects/DeclutrMail/apps/web/src/app/global-error.tsx:112) — Global failure likewise promises untouched mailbox/decisions without reading persisted/provider state.
- [apps/web/src/features/triage/triage-screen.tsx:973](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/triage-screen.tsx:973) — Keep onError says nothing changed; request failure can be an ambiguous response after server commit.
- [apps/web/src/features/mailboxes/account-menu.tsx:538](/Users/chintant/projects/DeclutrMail/apps/web/src/features/mailboxes/account-menu.tsx:538) — Indexed-data deletion onError says Nothing was deleted even though it only knows the request failed client-side.
- [apps/api/src/mailboxes/mailbox-accounts.service.ts:582](/Users/chintant/projects/DeclutrMail/apps/api/src/mailboxes/mailbox-accounts.service.ts:582) — Deletion endpoint disconnects first, then durably queues deletion, before returning its response; lost response cannot prove no write.

#### CORE-08 · P2 · A background read failure replaces the entire useful queue with a cold-error screen

**Where:** /screener and /later. **State:** Transient background refetch failure after useful rows loaded

**Fix:** Keep retained same-scope rows on background failure, show a compact stale/retry state, and fail closed only for mutation previews whose fresh proof is unavailable. Reserve full-page error for an initial load with no usable data.

**Evidence and limits:** Source-only composition review; no production network failure induced. TanStack retained-data behavior is explicitly documented and handled in sibling Triage/Activity implementation.

- [apps/web/src/features/screener/compose-state.ts:22](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/compose-state.ts:22) — Any isError returns error even when input.rows is populated from retained query data.
- [apps/web/src/features/screener/screener-route.tsx:45](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/screener-route.tsx:45) — Composer receives queue.data and queue.isError separately, so retained rows with an error can reach this branch.
- [apps/web/src/features/snoozed/snoozed-screen.tsx:136](/Users/chintant/projects/DeclutrMail/apps/web/src/features/snoozed/snoozed-screen.tsx:136) — Later renders full error when query.isError even if usable rows remain.
- [apps/web/src/features/triage/compose-state.ts:36](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/compose-state.ts:36) — Triage already preserves a loaded queue on background failure and uses the cold error only when required data is missing.
- [apps/web/src/features/activity/activity-screen.tsx:343](/Users/chintant/projects/DeclutrMail/apps/web/src/features/activity/activity-screen.tsx:343) — Activity likewise keeps retained rows and confines cold error to no data.

#### CORE-09 · P3 · Recent-message status icons are named generic spans, so their accessible meaning can be ignored

**Where:** /senders/[id] and sender inspector. **State:** Recent message unread/attachment indicators

**Fix:** Use semantic named images or visually hidden status text linked to the message row; hide any purely decorative dot. Rerun accessibility checks for populated desktop/mobile detail and inspector.

**Evidence and limits:** Browser DOM verified default fixture had 8 generic Unread spans and 2 generic Has attachment spans. Parent axe scan reports 10 aria-prohibited-attr violations in default/mobile, matching these instances. No standalone axe scan executed by this reviewer.

- [apps/web/src/features/senders/detail/recent-messages.tsx:226](/Users/chintant/projects/DeclutrMail/apps/web/src/features/senders/detail/recent-messages.tsx:226) — Empty unread/read dot span has aria-label but no nameable role or text alternative.
- [apps/web/src/features/senders/detail/recent-messages.tsx:347](/Users/chintant/projects/DeclutrMail/apps/web/src/features/senders/detail/recent-messages.tsx:347) — Attachment span has aria-label but generic role; its child SVG is aria-hidden.

#### CORE-10 · P3 · Shared route error introduces a second nested main landmark

**Where:** authenticated route error boundaries. **State:** Feature route exception within AppShell

**Fix:** Use a neutral container or labelled section for feature errors inside AppShell; reserve a main landmark for standalone root/marketing/global error pages.

**Evidence and limits:** Source-only composition. The standalone AppError fixture has one main, correctly; the nested case requires the production shell composition and was not rendered in this fixture audit.

- [packages/shared/src/shell/app-shell.tsx:220](/Users/chintant/projects/DeclutrMail/packages/shared/src/shell/app-shell.tsx:220) — Authenticated shell wraps children in its main landmark.
- [apps/web/src/components/route-error-screen.tsx:77](/Users/chintant/projects/DeclutrMail/apps/web/src/components/route-error-screen.tsx:77) — RouteErrorScreen itself renders another main.
- [apps/web/src/app/(app)/activity/error.tsx:18](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(app)/activity/error.tsx:18>) — Feature route errors mount RouteErrorScreen inside the still-present shell.

### Onboarding, settings and billing

#### SYS-01 · P2 · Mailbox limit disappears when the optional billing read fails

**Where:** /settings. **State:** Known entitlement tier while billing is disabled or unavailable

**Fix:** Use the auth entitlement from useTier for mailbox capacity, as Brief settings and AccountMenu already do. Reserve the billing read for subscription facts.

**Evidence and limits:** Source-confirmed; not runtime-tested. Mock Free with one active mailbox and billing 503 BILLING_DISABLED/read failure, and assert Add Gmail plus disconnected reactivation are limit-disabled while existing-mailbox reauthorization remains available.

- [apps/web/src/features/settings/settings-index/settings-screen.tsx:300](/Users/chintant/projects/DeclutrMail/apps/web/src/features/settings/settings-index/settings-screen.tsx:300) — The mailbox allowance is derived only from billing.data?.tier, with null on BILLING_DISABLED/read failure, although useTier supplies the known auth entitlement immediately below.
- [apps/web/src/features/settings/settings-index/settings-screen.tsx:372](/Users/chintant/projects/DeclutrMail/apps/web/src/features/settings/settings-index/settings-screen.tsx:372) — MailboxesCard receives null inboxLimit when billing has no data.
- [apps/web/src/features/settings/settings-index/mailboxes-card.tsx:54](/Users/chintant/projects/DeclutrMail/apps/web/src/features/settings/settings-index/mailboxes-card.tsx:54) — atLimit is false for a null limit, so Add Gmail remains enabled at line 71 and disconnected reactivation loses its plan-limit guard at line 124.
- [apps/api/src/common/entitlements/entitlements.service.ts:452](/Users/chintant/projects/DeclutrMail/apps/api/src/common/entitlements/entitlements.service.ts:452) — The API independently rejects connection when connected >= the actual tier limit, creating a predictable refused path.

#### SYS-02 · P2 · Pause and cancellation can be submitted concurrently

**Where:** /billing. **State:** Pause request in flight inside cancellation dialog

**Fix:** Apply one busy state for isPausing || isCanceling to the primary action and the sheet dismissal lifecycle. Keep the correct pending label for the action that actually started.

**Evidence and limits:** Source-confirmed; deferred-provider outcome not exercised. Use a mocked unresolved pause promise and assert cancellation and all dismiss paths stay unavailable until the pause settles.

- [apps/web/src/features/billing/cancel-modal.tsx:149](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/cancel-modal.tsx:149) — The primary cancellation action is marked busy only by isCanceling; isPausing does not disable it or lock the sheet.
- [apps/web/src/features/billing/cancel-modal.tsx:194](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/cancel-modal.tsx:194) — The Pause button correctly disables for either mutation, showing the asymmetric lock.
- [packages/shared/src/components/preview-sheet/preview-sheet.tsx:68](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/preview-sheet/preview-sheet.tsx:68) — Sheet busy/dismissal protection is derived from primary.busyLabel; therefore an in-flight pause still permits cancel, Escape, scrim and Keep current plan.
- [apps/web/src/features/billing/billing-screen.tsx:810](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/billing-screen.tsx:810) — Pause runs a separate mutation from cancellation, without a parent guard against cancellation during that request.

#### SYS-03 · P2 · Feedback selection and success receipt carry across Brief editions

**Where:** /brief. **State:** Historical edition selected after feedback saves, or while a feedback request is unresolved

**Fix:** Reset selection, receipt and mutation state when the observation identity changes; prevent a late response for the prior reference from marking the new edition saved. A keyed Brief feedback instance can provide the immediate scope boundary.

**Evidence and limits:** Source-confirmed; not executed. Save Useful on an edition whose initialRating is null, switch to another null-rated edition and assert no selection or saved receipt carries over. Repeat with the first request resolving after the switch.

- [apps/web/src/features/feedback/inline-feedback.tsx:62](/Users/chintant/projects/DeclutrMail/apps/web/src/features/feedback/inline-feedback.tsx:62) — selected and savedNow are local state; the only reset effect at line 66 depends on initialRating, not referenceId/surface. Successful mutation sets savedNow=true at line 72.
- [apps/web/src/features/brief/brief-screen.tsx:325](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/brief-screen.tsx:325) — InlineFeedback is reused without key={brief.id} when the historical switcher changes its referenceId, unlike the explicitly keyed NoiseSection above.
- [apps/web/src/features/feedback/inline-feedback.test.tsx:23](/Users/chintant/projects/DeclutrMail/apps/web/src/features/feedback/inline-feedback.test.tsx:23) — Existing tests cover initial value, successful save and failure, but no reference-change case.

#### SYS-04 · P2 · Cleanup onboarding retries a connection conflict instead of reconciling it

**Where:** /onboarding. **State:** First cleanup review receives CurrentMailboxGuard 409 after the connection changes

**Fix:** Apply the protection review's designed connection-conflict recovery to the first cleanup review and use ErrorState for failed reads.

**Evidence and limits:** Source-confirmed; not executed. Return SELECT_MAILBOX/NO_ACTIVE_MAILBOX for the first cleanup read while cached me still has an active mailbox, and assert Refresh connection re-derives the appropriate step without writing skipped:true.

- [apps/web/src/features/onboarding/step-first-triage.tsx:83](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-first-triage.tsx:83) — Every read error, including ApiError scope 409s, becomes an EmptyState with Try again invoking the same firstTriage.refetch at line 95.
- [apps/api/src/onboarding/onboarding.controller.ts:97](/Users/chintant/projects/DeclutrMail/apps/api/src/onboarding/onboarding.controller.ts:97) — The first-triage endpoint is explicitly protected by CurrentMailboxGuard.
- [apps/web/src/features/onboarding/step-protection-review.tsx:110](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-protection-review.tsx:110) — The sibling protection review already handles mailbox scope conflicts with Refresh connection and resetMailboxScopedCache, which updates me and re-derives onboarding.
- [apps/web/src/app/onboarding/page.tsx:220](/Users/chintant/projects/DeclutrMail/apps/web/src/app/onboarding/page.tsx:220) — The remaining corner escape writes skipped:true, so it abandons onboarding rather than repairs the connection state.

#### SYS-05 · P2 · Historical Noise rows and archive preview still say yesterday

**Where:** /brief. **State:** Viewing a historical Brief containing Noise senders

**Fix:** Thread the edition's covered-date wording through every frozen-count label. Describe the action's wider scope as all inbox mail now versus email in this Brief, so the preview is truthful for every edition.

**Evidence and limits:** Source-confirmed; not executed. Select a historical edition with Noise, assert its rows use that covered date, then open the archive preview and assert no stale yesterday qualifier remains.

- [apps/web/src/features/brief/brief-screen.tsx:320](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/brief-screen.tsx:320) — The edition-aware dayWord reaches NoiseSection, but line 743 renders NoiseRow without passing it.
- [apps/web/src/features/brief/brief-screen.tsx:1119](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/brief-screen.tsx:1119) — NoiseRow always formats the frozen count as messages yesterday.
- [apps/web/src/features/brief/noise-archive-sheet.tsx:118](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/noise-archive-sheet.tsx:118) — The shared preview always describes its scope as not only yesterday's mail, even when opened from a historical edition.
- [apps/web/src/features/brief/brief-screen.test.tsx:643](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/brief-screen.test.tsx:643) — The historical-language regression test checks heading and screen-help only; it does not cover rows or the archive sheet.

#### SYS-06 · P2 · A failed billing read asserts that no charge or plan change occurred

**Where:** /billing. **State:** Cold subscription read failure without a local pending-payment record

**Fix:** Scope the reassurance to the read operation, or state that billing details could not be confirmed. Preserve the distinction between an unavailable read and an actual transaction outcome.

**Evidence and limits:** Source-confirmed copy issue; not runtime-tested. Render the cold read-failure fixture and assert it does not claim an account-wide no-charge outcome.

- [apps/web/src/features/billing/billing-screen.tsx:2094](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/billing-screen.tsx:2094) — BillingErrorState says No charge or plan change was made. A failed read cannot establish the transaction or webhook outcome, including activity on another device.
- [apps/web/src/features/billing/billing-screen.tsx:2121](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/billing-screen.tsx:2121) — The schema-unknown sibling correctly scopes its assurance to Loading this page made no charge or plan change.

#### SYS-07 · P2 · Read-only Autopilot tells users to retry but offers no retry control

**Where:** /autopilot. **State:** Free tier's read-only rule catalog fails to load

**Fix:** Use the standard recoverable ErrorState and wire Retry to rules.refetch. Keep the read-only preview and upgrade messaging independent from catalog recovery.

**Evidence and limits:** Source-confirmed; not executed. Reject the catalog GET once, then succeed; assert a visible retry control recovers the rule list without upgrading or navigating away.

- [apps/web/src/features/autopilot/autopilot-entitlement-surface.tsx:118](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/autopilot-entitlement-surface.tsx:118) — The rules.isError branch renders Couldn't load your preset rules / Try again in a moment, with no action or refetch handler.
- [apps/web/src/features/autopilot/api/use-autopilot-rules.ts:13](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/api/use-autopilot-rules.ts:13) — The hook returns the normal query result, including refetch; the surface could expose a real recovery action.

#### SYS-08 · P2 · Support-assisted payment copy promises access beyond the enforced dunning deadline

**Where:** /billing. **State:** Past-due payment method cannot be changed through the self-service provider path

**Fix:** Use neutral support-next-step copy and, when known, the actual access deadline. Do not imply contacting support guarantees continued paid access.

**Evidence and limits:** Source-confirmed policy/copy mismatch; no provider calls made. Render the Razorpay/unsupported past_due variant and assert its assurance respects the recorded entitlement deadline or makes no indefinite access promise.

- [apps/web/src/features/billing/payment-method-card.tsx:117](/Users/chintant/projects/DeclutrMail/apps/web/src/features/billing/payment-method-card.tsx:117) — For showSupportPath plus isPastDue the card states Your plan stays active while we sort this out with you, without a time or entitlement boundary.
- [apps/api/src/billing/billing-webhook.service.ts:677](/Users/chintant/projects/DeclutrMail/apps/api/src/billing/billing-webhook.service.ts:677) — past_due gets an entitlement deadline derived from the period end plus the dunning window.
- [apps/api/src/billing/billing-reconciliation.sweep.ts:86](/Users/chintant/projects/DeclutrMail/apps/api/src/billing/billing-reconciliation.sweep.ts:86) — The sweep changes expired past_due subscriptions to canceled once entitlement_ends_at passes; support correspondence does not suspend that guard.

#### SYS-09 · P2 · Account deletion removes the visible keyboard focus ring

**Where:** /settings#account. **State:** Keyboard focus in the typed account-deletion confirmation field

**Fix:** Remove the inline outline reset or add a dedicated visible focus style independent of phrase validity.

**Evidence and limits:** Source-confirmed style override; rendered keyboard verification remains needed because the parent reports the modal Storybook fixture lacks a QueryClient provider. Tab into the field with an incomplete phrase and confirm a visible ring in both themes.

- [apps/web/src/features/account-deletion/delete-account-modal.tsx:242](/Users/chintant/projects/DeclutrMail/apps/web/src/features/account-deletion/delete-account-modal.tsx:242) — The typed-confirm input sets inline outline:none. Its boxShadow at line 239 changes only for an exact phrase match, not focus.
- [packages/shared/src/styles/tokens.css:338](/Users/chintant/projects/DeclutrMail/packages/shared/src/styles/tokens.css:338) — The shared :focus-visible rule supplies the normal outline; an inline outline:none overrides it.

#### SYS-10 · P3 · Continue to Senders actually opens Overview or the retained billing destination

**Where:** /onboarding. **State:** First review completed or no candidates found

**Fix:** Use a destination-neutral completion label such as Open workspace, or derive the destination label from the same routing decision. Update both completion panels and their matching copy/tests.

**Evidence and limits:** Source-confirmed; not executed. Complete each first-review goal with no returnTo and with a validated billing intent, checking that the CTA truth matches the resulting destination.

- [apps/web/src/features/onboarding/step-first-triage.tsx:157](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-first-triage.tsx:157) — The completion button reads Continue to Senders.
- [apps/web/src/features/onboarding/step-protection-review.tsx:192](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-protection-review.tsx:192) — The protection completion button repeats Continue to Senders; the unknown-split body at line 427 also promises that destination.
- [apps/web/src/app/onboarding/page.tsx:205](/Users/chintant/projects/DeclutrMail/apps/web/src/app/onboarding/page.tsx:205) — Successful completion executes router.replace(returnTo ?? '/home'), not /senders.

#### SYS-11 · P3 · Default quiet-hours draft is labelled Saved before any save exists

**Where:** /quiet. **State:** Mailbox has no saved quiet-hours configuration

**Fix:** Show Off/unconfigured, or omit the receipt until an actual persisted configuration exists. Keep the disabled-by-default behavior.

**Evidence and limits:** Source-confirmed; not rendered by this reviewer. Inspect Unconfigured and save a mocked first configuration; Saved should appear only for the latter.

- [apps/web/src/features/quiet/quiet-hours-card.tsx:131](/Users/chintant/projects/DeclutrMail/apps/web/src/features/quiet/quiet-hours-card.tsx:131) — A null server config is replaced by DEFAULT_DRAFT and useBrowserDefault=true.
- [apps/web/src/features/quiet/quiet-hours-card.tsx:159](/Users/chintant/projects/DeclutrMail/apps/web/src/features/quiet/quiet-hours-card.tsx:159) — The default draft is also used as baseline; browser timezone initialization updates both baseline and draft, so dirty stays false.
- [apps/web/src/features/quiet/quiet-hours-card.tsx:292](/Users/chintant/projects/DeclutrMail/apps/web/src/features/quiet/quiet-hours-card.tsx:292) — Any nondirty form displays Saved, including the null-config state.
- [apps/web/src/features/quiet/quiet-hours-card.stories.tsx:62](/Users/chintant/projects/DeclutrMail/apps/web/src/features/quiet/quiet-hours-card.stories.tsx:62) — The Unconfigured story explicitly supplies a ready state with config:null.

#### SYS-12 · P3 · Preset selection still claims preparation after the status read has stopped

**Where:** /onboarding. **State:** Preset rule read fails or reaches its polling cap

**Fix:** Distinguish a loading/waiting response from inability to confirm preparation. Keep the valid ability to save selections, and expose recovery when the catalog read failed.

**Evidence and limits:** Source-confirmed; not executed. Exercise a cold rule-read failure and repeated empty 200 responses to the cap, confirming neither makes an unverified preparation promise.

- [apps/web/src/features/onboarding/step-preset-pick.tsx:108](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-preset-pick.tsx:108) — Rule polling stops immediately on query error and after RULES_SEED_MAX_POLLS at line 110.
- [apps/web/src/features/onboarding/step-preset-pick.tsx:248](/Users/chintant/projects/DeclutrMail/apps/web/src/features/onboarding/step-preset-pick.tsx:248) — Every not-loading/unseeded state still renders Your suggestions are still being prepared, without distinguishing a failed read or capped wait.

#### SYS-13 · P3 · Review-only activation component can display an automatic-action choice

**Where:** /autopilot; isolated ActivateRuleModal story. **State:** Review-only preset with intent=enable and default canRunUnattended=true

**Fix:** Enforce the review-only invariant inside ActivateRuleModal as well as its caller. Correct the story to represent the current preset behavior, with a separate non-review-only fixture for the Watch/Act choice.

**Evidence and limits:** Parent observed the contradiction in mobile Storybook; this reviewer independently confirmed source. Add an isolated component case that cannot render Act now for either review-only preset, regardless of omitted canRunUnattended.

- [apps/web/src/features/autopilot/activate-rule-modal.tsx:132](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/activate-rule-modal.tsx:132) — reviewOnly is computed, but offersChoice at line 139 does not include !reviewOnly.
- [apps/web/src/features/autopilot/activate-rule-modal.tsx:236](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/activate-rule-modal.tsx:236) — The displayed Act now option is accompanied at line 242 by Acts on matching email now and as it arrives, contradicting the review-only subtitle and note.
- [apps/web/src/features/autopilot/activate-rule-modal.stories.tsx:54](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/activate-rule-modal.stories.tsx:54) — The fixture uses AUTO_ARCHIVE_LOW_ENGAGEMENT, a review-only preset, and EnableWithWatchFirst at line 75 omits canRunUnattended, taking its true default.
- [apps/web/src/features/autopilot/autopilot-screen.tsx:1058](/Users/chintant/projects/DeclutrMail/apps/web/src/features/autopilot/autopilot-screen.tsx:1058) — The current production caller correctly passes false for review-only presets, so the live route is presently protected from this contradictory choice.

### Public content and demo

#### PUB-01 · P2 · Published Gmail recheck guarantee is stronger than the worker implementation

**Where:** /terms; /pricing.md; /llms.txt; public uses of ACTION_PREVIEW_CLAIM. **State:** Manual sender action between preview and execution

**Fix:** Remove the claim that Gmail is rechecked. Describe that the matching scope is resolved again when execution starts and the final count can differ, or implement and verify an actual provider recheck before retaining the guarantee. Keep the current-index wording in the Delete guide; that wording matches the implementation.

**Evidence and limits:** Source trace from selector resolution through Gmail mutation adapter; no provider mutation or production freshness test performed. A Gmail label-name lookup is not a current message-scope recheck.

- [packages/shared/src/copy/action-safety.ts:11](/Users/chintant/projects/DeclutrMail/packages/shared/src/copy/action-safety.ts:11) — Canonical action-preview copy says DeclutrMail checks Gmail again when the action runs.
- [apps/web/src/app/(marketing)/terms/page.tsx:74](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/terms/page.tsx:74>) — Terms specifically says the worker re-checks Gmail at execution.
- [apps/web/src/app/(marketing)/pricing.md/route.ts:143](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/pricing.md/route.ts:143>) — Machine-readable pricing repeats the execution-time Gmail check.
- [apps/web/public/llms.txt:3](/Users/chintant/projects/DeclutrMail/apps/web/public/llms.txt:3) — Static public summary repeats the same guarantee.
- [packages/workers/src/label-action.worker.ts:303](/Users/chintant/projects/DeclutrMail/packages/workers/src/label-action.worker.ts:303) — Sender selector is resolved again by resolveSenderActionIds.
- [packages/workers/src/label-action.worker.ts:689](/Users/chintant/projects/DeclutrMail/packages/workers/src/label-action.worker.ts:689) — resolveSenderActionIds selects provider IDs from the local mailMessages database using senderActionWhere; it does not fetch current Gmail scope.
- [packages/workers/src/label-action.worker.ts:381](/Users/chintant/projects/DeclutrMail/packages/workers/src/label-action.worker.ts:381) — The resolved local IDs are passed directly to Gmail batchModify.
- [apps/api/src/gmail/gmail-client.service.ts:671](/Users/chintant/projects/DeclutrMail/apps/api/src/gmail/gmail-client.service.ts:671) — batchModify only posts the supplied IDs and label changes in chunks; it performs no Gmail message-scope read.

#### PUB-02 · P2 · Public machine-readable copy promises a preview for every action

**Where:** All public routes via SoftwareApplication JSON-LD; /pricing.md. **State:** Structured data and machine-readable action semantics

**Fix:** Align JSON-LD and pricing markdown with the visible guide: Keep records an inline decision; mail-moving actions show the affected-email preview; unsubscribe confirms its method and any optional separate cleanup. Include Delete with Archive/Later when listing Activity Undo.

**Evidence and limits:** Compared shared JSON-LD and markdown against production ActionSheet branches, visible product guide, and canonical recovery copy. Source-only.

- [apps/web/src/app/(marketing)/site-json-ld-description.ts:20](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/site-json-ld-description.ts:20>) — Both description branches claim every action is previewed, then include Keep among the five decisions; both also mention Activity recovery only for Archive and Later.
- [apps/web/src/app/(marketing)/pricing.md/route.ts:141](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/pricing.md/route.ts:141>) — Every Unsubscribe action is described as showing a matching count/sample/exact Gmail change, even when no backlog cleanup is selected.
- [apps/web/src/app/(marketing)/how-it-works/page.tsx:106](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/how-it-works/page.tsx:106>) — Visible guide correctly says Keep is inline and affected-email previews apply to mail-moving actions.
- [apps/web/src/features/triage/action-sheet.tsx:71](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/action-sheet.tsx:71) — Keep is explicitly never previewed.
- [apps/web/src/features/triage/action-sheet.tsx:132](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/action-sheet.tsx:132) — The live affected-email preview gate covers Archive, Later, Delete, and Unsubscribe only when historic Archive is selected.
- [packages/shared/src/copy/action-safety.ts:29](/Users/chintant/projects/DeclutrMail/packages/shared/src/copy/action-safety.ts:29) — Canonical recovery claim includes Activity Undo for Delete.

#### PUB-03 · P2 · Demo outcome counts archived mail as cleared from Inbox

**Where:** /inbox-simulator?workspace=triage; /inbox-simulator?step=4. **State:** Completed demo after Delete with Inbox + archived

**Fix:** Track inbox-removed count separately from total affected count, or label the total as Emails acted on. Verify the completed summary for Delete with archived reach and for Archive/Later/unsubscribe-with-backlog.

**Evidence and limits:** Deterministic source calculation: archived messages contribute to the value despite already being outside Inbox. Parent can reproduce with the guided Delete sample and complete the tour.

- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:667](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:667) — affectedCount includes syntheticArchivedCount when Delete reach is all_mail.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1317](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1317) — OutcomeSummary sums the entire affectedCount into clearedFromInbox.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1324](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1324) — That total is labelled Cleared from Inbox.

#### PUB-04 · P3 · Guided-tour query does not select the workspace that renders the tour

**Where:** /inbox-simulator?tour=1. **State:** Direct guided-tour query link

**Fix:** When parsing tour=1, select Triage as well as guided mode. Preserve an explicit Senders choice only if that query combination is intentionally supported and documented.

**Evidence and limits:** Source state initialization and render-branch trace; step=1–4 already sets the required workspace. No runtime assertion by this reviewer.

- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:447](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:447) — Workspace defaults to Senders.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:520](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:520) — Only workspace=triage or a step query selects Triage.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:521](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:521) — tour=1 selects guided mode without selecting Triage.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:946](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:946) — SendersSimulator renders while workspace is Senders; the guided tour is in the other branch.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:848](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:848) — Changing demo mode uses tour=1 as its URL representation.

#### PUB-05 · P2 · Recovery explanation omits Activity Undo for a paired Delete

**Where:** /how-to/unsubscribe-from-emails-gmail; /how-it-works. **State:** Paired unsubscribe with separate Archive or Delete

**Fix:** Say that a separate Archive or Delete has its own Activity Undo until its deadline, while the sent unsubscribe request cannot be recalled. Preserve the distinction with Trash without adding a longer caveat.

**Evidence and limits:** Compared guide, lifecycle figure, and canonical recovery semantics. Source-only; no actual unsubscribe request sent.

- [apps/web/src/features/marketing/learn/how-to-content.ts:835](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/how-to-content.ts:835) — The guide explicitly supports a secondary Archive or Delete in the unsubscribe confirmation.
- [apps/web/src/features/marketing/learn/how-to-content.ts:861](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/how-to-content.ts:861) — Recovery paragraph says only the archive portion is reversible while its Activity window is open and then gives Delete only Gmail Trash recovery.
- [apps/web/src/features/marketing/product-story/diagrams.tsx:245](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/product-story/diagrams.tsx:245) — Lifecycle note only says a paired Archive has its own Undo, despite Delete being a supported paired cleanup.
- [packages/shared/src/copy/action-safety.ts:29](/Users/chintant/projects/DeclutrMail/packages/shared/src/copy/action-safety.ts:29) — Delete can be undone from Activity until its displayed deadline; Trash is an additional fallback.

#### PUB-06 · P3 · Daily-review CTA lands in the default Senders demo

**Where:** /beta. **State:** Open-beta daily review link

**Fix:** Link this CTA to /inbox-simulator?workspace=triage, or change its label to match the sender workspace.

**Evidence and limits:** Source destination versus simulator default state; no navigation performed by this reviewer.

- [apps/web/src/app/(marketing)/beta/page.tsx:127](</Users/chintant/projects/DeclutrMail/apps/web/src/app/(marketing)/beta/page.tsx:127>) — Try the daily review demo links to bare /inbox-simulator.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:447](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:447) — Bare simulator URL starts in Senders; Daily Triage is a separate workspace.

#### PUB-07 · P3 · Autopilot guide asks readers to enable the same rule twice

**Where:** /how-to/auto-archive-future-emails-in-gmail. **State:** Numbered Autopilot instructions

**Fix:** Place the activation preview in the first step. Make the third step review the collected suggestions, names, and exceptions rather than repeat the pre-activation instruction.

**Evidence and limits:** Read the complete ordered steps and preceding always-Observe explanation. Source-only.

- [apps/web/src/features/marketing/learn/how-to-content.ts:564](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/how-to-content.ts:564) — First step is Turn on review.
- [apps/web/src/features/marketing/learn/how-to-content.ts:568](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/how-to-content.ts:568) — Second step waits for representative traffic after the preset is enabled.
- [apps/web/src/features/marketing/learn/how-to-content.ts:573](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/how-to-content.ts:573) — Third step says to review the sample before turning on the rule.

#### PUB-08 · P3 · Homepage privacy summary repeats the same data boundary

**Where:** /. **State:** Privacy & control section, then expanded inventory

**Fix:** Keep one clear boundary in the section lede and use the summary for distinct facts such as the stored fields, access controls, and decision controls. Let the disclosure add the full inventory rather than duplicate its introduction. Keep useful Start free repetition in header/hero/final CTA.

**Evidence and limits:** Adjacent visible source copy plus expanded disclosure; this is a focused duplication finding, not a recommendation for a homepage rewrite.

- [apps/web/src/features/marketing/landing/sections.tsx:145](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/landing/sections.tsx:145) — The lede states the canonical no-full-email-contents boundary.
- [apps/web/src/features/marketing/landing/sections.tsx:164](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/landing/sections.tsx:164) — A nearby Full messages stay in Gmail item repeats the same no-full-email-contents claim.
- [apps/web/src/features/marketing/landing/sections.tsx:174](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/landing/sections.tsx:174) — Expanded data inventory renders another full PrivacyBadge card.
- [CLAUDE.md:723](/Users/chintant/projects/DeclutrMail/CLAUDE.md:723) — Repository copy budget puts trust/privacy copy once per flow at its decision point.

#### PUB-09 · P3 · Several button labels exceed the repository copy budget

**Where:** Public article/comparison topic CTAs; /inbox-simulator. **State:** Shared topic demo buttons and simulator controls

**Fix:** Use short, destination-specific labels such as Preview Unsubscribe, Preview automation, Delete and recovery, Try Senders, Workspace guide, Preview rule, and Explore senders. Keep article titles and explanatory prose descriptive.

**Evidence and limits:** Word count of actual button/CTA strings against explicit repository budget; no assumption that every prose link is a button.

- [apps/web/src/features/marketing/learn/journey-links.ts:4](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/learn/journey-links.ts:4) — Try an unsubscribe preview has four words; the other topic labels at lines 7, 10, and 12 also have four.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:906](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:906) — Where this fits in your workspace uses six words.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1305](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1305) — Preview the Autopilot rule uses four words.
- [apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1429](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:1429) — Explore all sample senders uses four words.
- [CLAUDE.md:721](/Users/chintant/projects/DeclutrMail/CLAUDE.md:721) — Button or menu item budget is three words or fewer.

#### PUB-10 · P3 · Waitlist error claims a network failure for every failed request

**Where:** /pricing and public disabled-billing waitlist surfaces. **State:** Waitlist submission rejection

**Fix:** Use a truthful generic failure with a next action, such as Couldn’t join the waitlist. Try again., or distinguish verified network and server causes.

**Evidence and limits:** Source catch/error-class trace; rejection states were not injected by this reviewer.

- [apps/web/src/features/marketing/pricing/waitlist-form.tsx:38](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/pricing/waitlist-form.tsx:38) — All thrown errors use the same generic error state.
- [apps/web/src/features/marketing/pricing/waitlist-form.tsx:113](/Users/chintant/projects/DeclutrMail/apps/web/src/features/marketing/pricing/waitlist-form.tsx:113) — The displayed error says the server could not be reached.
- [apps/web/src/lib/api/waitlist.ts:24](/Users/chintant/projects/DeclutrMail/apps/web/src/lib/api/waitlist.ts:24) — The form delegates to apiPost, whose rejected responses include server HTTP errors as well as network failures.
- [apps/web/src/lib/api/client.ts:53](/Users/chintant/projects/DeclutrMail/apps/web/src/lib/api/client.ts:53) — ApiError represents any non-2xx response; a responding server can therefore produce this state.

### Independent visual and accessibility findings

#### UI-01 · P2 · Protected confirmation clips Cancel on a narrow phone

**Where:** /screener. **State:** Expanded protected Delete preview at 320px

**Fix:** Reduce the mobile indentation and wrap or stack the confirmation rail. Keep both confirmation and Cancel fully visible at 320px and with long sender names.

**Evidence and limits:** Browser-observed in the real component fixture in both themes. Core reviewer measured scrollWidth 344 for a 320px viewport and Cancel at x 266–344. Production AppShell can turn this overflow into clipping; the full authenticated composition was not traversed.

- [apps/web/src/features/screener/screener-row.tsx:277](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/screener-row.tsx:277) — Expanded content retains 68px left padding.
- [apps/web/src/features/screener/decide-preview.tsx:347](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/decide-preview.tsx:347) — Preview adds 16px of inner padding.
- [apps/web/src/features/screener/decide-preview.tsx:453](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/decide-preview.tsx:453) — Confirm and Cancel use a flex rail without wrapping.
- [packages/shared/src/components/button.tsx:115](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/button.tsx:115) — Button text is nowrap.

[Browser screenshot](/Users/chintant/projects/DeclutrMail/docs/qa/prelaunch-2026-10-03/screener-protected-320-dark.png)

#### UI-02 · P2 · Triage clips the List switch on a narrow phone

**Where:** /triage. **State:** Ready Focus layout at 320px

**Fix:** Allow the progress and layout selector to occupy separate lines or shorten the mobile progress label. Keep Focus and List visible and operable at 320px, including larger counts.

**Evidence and limits:** Browser-observed in triage-triagescreen--default, light and dark: viewport 320, scrollWidth 372. Screenshot shows Focus while List is offscreen. The fixture wrapper has no fixed minimum width; this overflow comes from the production screen header.

- [apps/web/src/features/triage/triage-screen.tsx:1502](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/triage-screen.tsx:1502) — The inner progress/mode-switch group is a single flex row with no wrap.
- [apps/web/src/features/triage/session-progress.tsx:35](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/session-progress.tsx:35) — Session progress remains nowrap.

[Browser screenshot](/Users/chintant/projects/DeclutrMail/docs/qa/prelaunch-2026-10-03/triage-layout-switch-320-dark.png)

#### UI-03 · P2 · Activity link is visually indistinguishable from surrounding text

**Where:** /brief. **State:** Populated Brief, both themes

**Fix:** Give the link an underline or another persistent non-color distinction, retaining focus styling.

**Evidence and limits:** Browser axe link-in-text-block violation: link-to-surrounding-text contrast 1.46:1 in light and 1.21:1 in dark, with no underline. This is the real Brief component.

- [apps/web/src/features/brief/brief-screen.tsx:417](/Users/chintant/projects/DeclutrMail/apps/web/src/features/brief/brief-screen.tsx:417) — See what changed explicitly removes text decoration and sits inside a paragraph.

#### UI-04 · P3 · Shared state components skip heading levels

**Where:** /home; /triage; /screener; /later; /followups; /settings/privacy; /settings/senders; /admin/security. **State:** Page-level empty/error states and privacy card

**Fix:** Support a semantic heading level in the shared primitives. Use h2 for page-level states and preserve h3 for a state nested under a section heading.

**Evidence and limits:** Browser axe heading-order findings across the named screen fixtures. PrivacyData was rechecked in both themes; public placements with an intervening h2 did not report this issue.

- [packages/shared/src/components/empty-state/empty-state.tsx:112](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/empty-state/empty-state.tsx:112) — EmptyState hardcodes h3 regardless of its position under a page h1.
- [packages/shared/src/components/error-state/error-state.tsx:67](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/error-state/error-state.tsx:67) — ErrorState similarly hardcodes h3.
- [packages/shared/src/components/privacy-badge.tsx:91](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/privacy-badge.tsx:91) — Card PrivacyBadge hardcodes h3 and is the first heading after h1 on Privacy & data.

#### UI-05 · P3 · Security table has an inaccessible scroll region and low-contrast warning pills

**Where:** /admin/security. **State:** Populated security-event table, light theme and narrow layout

**Fix:** Make the labelled scroll region keyboard-focusable and verify keyboard scrolling. Darken the warning foreground or adjust its background so small text meets 4.5:1.

**Evidence and limits:** Browser axe scrollable-region-focusable and color-contrast findings. Warning pill measured 4.22:1 on its rendered background. Admin access/auth enforcement was source-reviewed, not exercised with a real operator session.

- [apps/web/src/features/admin-security/security-events-screen.tsx:309](/Users/chintant/projects/DeclutrMail/apps/web/src/features/admin-security/security-events-screen.tsx:309) — Horizontal table wrapper has overflowX:auto but no focus target or keyboard instruction.
- [apps/web/src/features/admin-security/security-events-screen.tsx:363](/Users/chintant/projects/DeclutrMail/apps/web/src/features/admin-security/security-events-screen.tsx:363) — Warning rows use the shared amber Pill.
- [packages/shared/src/components/pill.tsx:14](/Users/chintant/projects/DeclutrMail/packages/shared/src/components/pill.tsx:14) — Amber pill combines amber foreground and amberBg wash.
- [packages/shared/src/styles/tokens.css:63](/Users/chintant/projects/DeclutrMail/packages/shared/src/styles/tokens.css:63) — Light amber foreground resolves to #b45309.

#### UI-06 · P2 · Dark danger text loses contrast on tinted surfaces

**Where:** /triage; /senders/[id]; /screener; /activity. **State:** Dark-theme danger and protected-warning text

**Fix:** Provide a stronger text-danger token for soft/tinted surfaces and remove opacity from meaningful confidence labels where it breaks contrast. Verify each rendered background rather than changing only one button.

**Evidence and limits:** Browser axe measured Triage Delete 3.18:1; sender detail Delete 3.44:1; Screener pressed Delete 3.28:1 and Protected warning 3.09:1; Activity Review 4.20:1; Screener unsure 4.25:1. These small text instances need 4.5:1. Disabled controls were not used as evidence.

- [packages/shared/src/styles/tokens.css:180](/Users/chintant/projects/DeclutrMail/packages/shared/src/styles/tokens.css:180) — Dark danger foreground is #e5636a, reused across multiple surface fills.
- [apps/web/src/features/triage/action-toolbar.tsx:161](/Users/chintant/projects/DeclutrMail/apps/web/src/features/triage/action-toolbar.tsx:161) — Delete uses the danger foreground on the default button surface.
- [apps/web/src/features/screener/screener-row.tsx:324](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/screener-row.tsx:324) — Pressed Delete combines dangerBg and danger text.
- [apps/web/src/features/screener/screener-row.tsx:244](/Users/chintant/projects/DeclutrMail/apps/web/src/features/screener/screener-row.tsx:244) — Suggestion confidence applies 0.85 opacity, further lowering contrast.

## Verification gap — QA-01

**P2: the visual fixtures need repairs before they can support a launch decision.**

- AccountDeletion ModalStep1: No QueryClient set
- StepProtectionReview ReassuranceLeads: app router invariant
- SyncGate Failed: No QueryClient set
- SelectionBar MixedSelection: Unhandled tier undefined
- GlobalError Default: blank render
- Activity Empty: cold error rather than expected empty state

Repair providers/props/caches and the root-error rendering fixture, then confirm that each named story actually displays its intended state. Rehearse the full authenticated flows in the isolated harness after it is available.

These observations concern the verification fixtures; they are not proof that the production routes crash. Production coverage for these states remains source-only.

## Route coverage

Each production route is enumerated below. “Source + fixture” does not imply authenticated end-to-end execution. Individual error, tier, confirmation and recovery branches are listed in the accompanying JSON.

| Route                                            | Review method                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/`                                              | Public render:1440px light;320px light DOM + dark screenshot         |
| `/activity`                                      | Source + selected component fixtures; authenticated route unverified |
| `/admin/security`                                | Source + selected component fixtures; authenticated route unverified |
| `/alternatives/clean-email`                      | Public render:1440px light;320px light DOM + dark screenshot         |
| `/alternatives/leave-me-alone`                   | Public render:1440px light;320px light DOM + dark screenshot         |
| `/alternatives/sanebox`                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/alternatives/trimbox`                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/alternatives/unroll-me`                        | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers/best-way-to-clean-gmail-2026`          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers/how-undo-works-for-gmail-cleanup`      | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers/is-it-safe-to-connect-gmail-app`       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers/sender-level-vs-message-level-cleanup` | Public render:1440px light;320px light DOM + dark screenshot         |
| `/answers/what-is-metadata-only-email-analysis`  | Public render:1440px light;320px light DOM + dark screenshot         |
| `/autopilot`                                     | Source + selected component fixtures; authenticated route unverified |
| `/beta`                                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/billing`                                       | Source + selected component fixtures; authenticated route unverified |
| `/blog`                                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/blog/metadata-only-is-a-design-constraint`     | Public render:1440px light;320px light DOM + dark screenshot         |
| `/blog/reversible-does-not-mean-risk-free`       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/blog/why-cleanup-starts-with-senders`          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/brief`                                         | Source + selected component fixtures; authenticated route unverified |
| `/changelog`                                     | Public render:1440px light;320px light DOM + dark screenshot         |
| `/compare`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/contact`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/cookies`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/demo`                                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/faq`                                           | Public render:1440px light;320px light DOM + dark screenshot         |
| `/followups`                                     | Source + selected component fixtures; authenticated route unverified |
| `/help`                                          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/home`                                          | Source + selected component fixtures; authenticated route unverified |
| `/how-it-works`                                  | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to`                                        | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/auto-archive-future-emails-in-gmail`    | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/bulk-delete-emails-from-one-sender`     | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/clean-gmail-by-sender`                  | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/gmail-storage-full`                     | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/stop-promotional-emails-gmail`          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/how-to/unsubscribe-from-emails-gmail`          | Public render:1440px light;320px light DOM + dark screenshot         |
| `/inbox-simulator`                               | Public render:1440px light;320px light DOM + dark screenshot         |
| `/later`                                         | Source + selected component fixtures; authenticated route unverified |
| `/methodology`                                   | Public render:1440px light;320px light DOM + dark screenshot         |
| `/onboarding`                                    | Source + selected component fixtures; authenticated route unverified |
| `/pricing`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/privacy`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/quiet`                                         | Source + selected component fixtures; authenticated route unverified |
| `/refunds`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/screener`                                      | Source + selected component fixtures; authenticated route unverified |
| `/security`                                      | Public render:1440px light;320px light DOM + dark screenshot         |
| `/senders`                                       | Source + selected component fixtures; authenticated route unverified |
| `/senders/[id]`                                  | Source + selected component fixtures; authenticated route unverified |
| `/settings`                                      | Source + selected component fixtures; authenticated route unverified |
| `/settings/help`                                 | Source + selected component fixtures; authenticated route unverified |
| `/settings/privacy`                              | Source + selected component fixtures; authenticated route unverified |
| `/settings/senders`                              | Source + selected component fixtures; authenticated route unverified |
| `/sign-in`                                       | Public render:1440px light;320px light DOM + dark screenshot         |
| `/terms`                                         | Public render:1440px light;320px light DOM + dark screenshot         |
| `/triage`                                        | Source + selected component fixtures; authenticated route unverified |
| `/vs/clean-email`                                | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/gmail`                                      | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/gmail-filters`                              | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/leave-me-alone`                             | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/meta-muse`                                  | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/sanebox`                                    | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/trimbox`                                    | Public render:1440px light;320px light DOM + dark screenshot         |
| `/vs/unroll-me`                                  | Public render:1440px light;320px light DOM + dark screenshot         |

## Design improvements after the behavior fixes

- **Home:** bring the next task and its count forward on small screens. The 320px ready fixture leads with a multi-line poetic headline, repeated “clearer” subtitle and progress stamp before the primary review action. Keep the brand typography, but compress this introduction when work is waiting. Evidence: [Home view](/Users/chintant/projects/DeclutrMail/apps/web/src/features/home/home-view.tsx:35) and [mobile fixture](/Users/chintant/projects/DeclutrMail/docs/qa/prelaunch-2026-10-03/home-next-step-320.png). This is a hierarchy recommendation, not a broken route.
- **Follow-ups:** make its introduction more scannable. The population window, refresh cadence, recent-reply warning, Gmail next step and Mark resolved effect form a long opening paragraph. Keep one line describing the task, then place the factual cadence/limitations behind its existing help surface or beside the affected control. Do not remove information needed to interpret the list.
- **Public calls to action:** keep useful Start free placements, and shorten topic buttons rather than removing destination-specific CTAs indiscriminately. Homepage privacy repetition is flagged in PUB-08; repeated conversion actions are intentional.

## Release rehearsal still required

The isolated Docker harness was unavailable (`docker info` did not complete), so this pass did not traverse real authenticated routes or run provider-connected journeys. No real Gmail action, unsubscribe request, deletion, or payment was executed. The missing checks are concrete:

- First connection → scan queued/syncing/failed → first decision/protection review → actual completion destination; repeat with a retained billing intent and with a mailbox 409 conflict.
- Login/reconnect/account switch → Home and each scoped queue; verify that old mailbox rows and pending actions cannot survive a scope change.
- Keep, Archive, Later, Delete, unsubscribe methods and paired cleanup → preview/confirmation → job result → Activity recovery/Undo; include Protected, zero-match, count changes and ambiguous responses.
- Autopilot Watch first versus unattended eligibility, Quiet hours/timezones, historical Brief/feedback and Follow-ups resolution with synthetic isolated data.
- Sandbox checkout → webhook confirmation → plan/limit changes → pause/cancel → refund recovery; exercise delayed and failed provider responses. Production cutover verification remains a separate step under the repository billing instructions.
- Keyboard-only and screen-reader pass with the actual shell;320px,390px and desktop in both themes; longer data, larger counts and text zoom.

Acceptance: close or explicitly defer each finding with a reason, add regressions for the meaningful behavior changes, confirm repaired fixtures show their intended state, then record the isolated end-to-end outcomes. Passing component/source checks alone should not be reported as public launch readiness.

## Evidence retention

The three reviewer JSON files preserve 175 source coverage entries and full finding evidence. The aggregate JSON contains all 39 product findings, route coverage and limitations. The folder also preserves public browser checks,20 followup fixture checks, selected story IDs, the surviving 30 resumed story records, and focused screenshots. A transient disk-full write erased the first 83 accumulated raw story records; their screenshots/progress were inspected, and actionable browser findings were rechecked. No user files were deleted.
