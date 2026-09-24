# Warm Editorial authenticated-app audit

Date: 2026-09-22. Branch: `claude/product-simplification-ideas-5a8515`.

## Scope and implementation

This slice applies the approved Warm Editorial direction to the real authenticated feature screens. It retains the existing data sources, routes, query state, forms, capability checks and action lifecycle. Shared palette, shell, navigation and general components are owned by the integration slice; sender screens and public pages are separate parallel slices.

Feature-local presentation lives in `apps/web/src/features/editorial/page.tsx` and its CSS module. It provides a compact paper-page rhythm, restrained editorial headings, a small orientation line and a factual summary strip. It imports existing shared token variables and introduces no theme runtime, API request or new dependency.

| Route / feature     | Presentation change                                                                                                              | Preserved data and interaction                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home`             | Visible page heading, split cleanup-history and next-step composition, supporting statistics, useful first-run/sync/error states | Existing `HomeState`, authoritative archive/delete totals excluding undo, sender decisions, since date, every secondary statistic, exact feature-owned CTA and target. No invented inbox score, savings or progress percentages.                                     |
| `/triage`           | Editorial heading and orientation; more precise bordered focus card with sender and count typography                             | Focus/list preference, queue, session progress, all five verbs, skip, why, protection, batch actions, keyboard/swipe behavior, mandatory preview, allowance and undo.                                                                                                |
| `/autopilot`        | Compact state summary, stronger rule rows and paper surface                                                                      | Existing rules, suggestions, details, thresholds, previews, pause/resume, enable/disable, observe/activate and capability gating. New summary counts derive only from loaded rules; active rules without required capability are included in inactive, never acting. |
| `/screener`         | New-sender orientation and editorial heading                                                                                     | True pending count, loaded queue, search/keyboard decisions, protection override, preview and unsubscribe follow-through. No new claim that incoming mail is blocked.                                                                                                |
| `/brief`            | Editorial daily-edition heading, readable narrative, differentiated section headings                                             | Snapshot period/history, reply/FYI/noise, every displayed count, grouping, source links, archived outcomes, blocked targets and bulk preview.                                                                                                                        |
| `/later`            | Time-oriented page framing                                                                                                       | Wake buckets, timestamps, sender/message counts, syncing states, individual/bulk return, retry and server-confirmed outcomes.                                                                                                                                        |
| `/followups`        | Conversation-oriented framing and aligned reading width                                                                          | Recipient, subject, elapsed time, all priority groups, Gmail links and dismiss.                                                                                                                                                                                      |
| `/quiet`            | Schedule framing and precise visible behavior description; bordered settings surface                                             | One card per mailbox, local start/end, timezone, overnight explanation, validation/save and current state. Copy states that Autopilot pauses; it does not claim Gmail stops receiving mail.                                                                          |
| `/activity`         | Editorial history header with all controls retained                                                                              | Search, filters/chips, date windows, all-time/window statistics, weekly review, day/sender grouping, pagination, selection, individual/bulk undo, partial failures, recovery and support bundle.                                                                     |
| `/settings`         | Workspace framing; common editorial `PageHeader` and bordered preference groups                                                  | Mailbox health/reconnect, deep-link anchors, action preferences, notifications, Brief preferences, email preferences, plan links and account deletion flow.                                                                                                          |
| `/settings/privacy` | Aligned privacy/data page                                                                                                        | Full inventory, data export, privacy controls and retention/recovery disclosures.                                                                                                                                                                                    |
| `/settings/senders` | Aligned sender-policy page                                                                                                       | Filters, protected sender policies, unprotect and all existing states.                                                                                                                                                                                               |
| `/settings/help`    | Aligned glossary/support presentation                                                                                            | Every glossary term, help link and support form; no support message sent by verification.                                                                                                                                                                            |
| `/billing`          | Editorial plan/billing page heading and aligned width                                                                            | All plan, currency, allowance, scheduled change, founding, invoice, provider, cancel and checkout surfaces. No billing implementation or behavior changed; no Paddle or other provider request issued during this slice.                                             |
| `/onboarding`       | Editorial type and paper panel for step shell and sync gate                                                                      | All steps, protection review, connection controls, skip, retry, escape, first triage and scan states.                                                                                                                                                                |
| `/admin/security`   | Visible title and operator-log framing                                                                                           | Operator access gate, audit filters, event fields, pagination and closed-enum payloads. Unauthorized branch is unchanged.                                                                                                                                            |

Only presentation and factual view composition changed. Existing loading/error child surfaces continue to use shared primitives. No new mutation path, replacement SDK, migration, feature removal or backend change is included.

## Verification evidence

- Existing feature regression suite: **77 files / 1,175 tests passed** across Home, Triage, Autopilot, Brief, Later, Quiet, Follow-ups, Activity, Screener, Settings, Billing, Onboarding and Admin Security.
- After rule-summary, Quiet form, Brief narrative, sync-panel and Help adjustments, targeted rerun: **21 files / 237 tests passed** across Autopilot, Quiet, Brief, Onboarding and Help.
- Web TypeScript check passed after the final functional presentation changes.
- ESLint passed across all owned feature folders, including Help, plus the authenticated Help route.
- Follow-up review fixed Home subtitle CSS overriding the orientation label and constrained onboarding primary buttons to the new panel width, allowing long labels to wrap. Home + onboarding rerun: **12 files / 105 tests passed**; scoped ESLint passed.
- Integration browser review found cramped Autopilot observe-complete text at 390px. The explanation now reserves a useful reading width and places the grouped controls on their own wrapping row at narrow widths; upgrade link wraps. Existing Autopilot screen suite: **63 tests passed**; component ESLint passed. Parent owns rendered recheck at 320px/390px.
- Follow-up mobile fixes: Triage focus Storybook frame now fits the viewport (the former fixed560px fixture caused the592px document); production focus layout unchanged. Screener compact rows keep sender name, domain, first-seen, subject and recommendation visible on separate readable lines. Screener + focus tests: **6 files / 107 tests passed**; after retaining first-seen in compact rows, Screener rerun **5 files / 73 tests passed**. Scoped lint passed.
- Changed files formatted with the repository's Prettier configuration.
- React best-practices review: existing hook/query and mutation ownership retained; no new effects or listeners; no new telemetry; CSS remains scoped; links stay links; labels and control accessibility preserved; existing preview/protection/undo tests remain green.

The broad regression run emitted the existing error-path React diagnostic in `triage-screen.quota-wiring.test.tsx`; Vitest reported every test passed. This is not claimed as a runtime browser result.

## Browser coverage and integration handoff

The subagent handed visual verification to the integration agent; completed representative coverage is recorded in [the integration handoff](design-integration-status-2026-09-22.md). This subagent's Computer Use runtime reported no available browsers (`listBrowsers` returned an empty array), so it could not independently open the app or Storybook. The integration agent has an authenticated browser. The currently selected preview mailbox was reported to have revoked Gmail access and empty data; do not reconnect it or mutate Gmail for design checks.

Use existing synthetic Storybook states for populated coverage:

- `Home/HomeView`: Cleared, SendersDecided, NewUser, Syncing, SyncFailed, Loading, LoadError.
- `Triage/FocusCard`: Default, Protected, WhyOpen, Busy, InlinePreview.
- `Autopilot/AutopilotScreen`: Default, AllPaused, PreUpgradeObservePreview and confirm states.
- `Autopilot/RuleCard`: Observing, Active, NotRunningOnPlus, Paused, Disabled, PreviewReady, PreviewError.
- `Features/Brief/BriefScreen`: Populated, Mobile, QuietInbox, TemplateFallback, NoiseAllProtected, WithHistory.
- `Features/Later/LaterScreen`: Populated, Mobile, CountSyncing, Loading, ErrorState.
- `Features/Followups/FollowupsScreen`: Populated, AllOverdue, Mobile.
- `Quiet/QuietHoursCard`: Configured, QuietNow, CrossesMidnight, Disconnected, ErrorState.
- Existing Activity, Screener, Privacy, Billing and onboarding stories retain their original fixtures.

Integration checks: inspect 320px, 390px, 900px and desktop; light/dark contrast; focus visibility; header-control wrapping; no horizontal overflow; bottom-navigation/Undo overlap; and populated previews with real controls. Do not treat a revoked/empty live mailbox as populated visual coverage. Do not run the Gmail-mutating `undo.spec.ts` as a visual check.

## Final preservation review

Reviewed the owned diff against the branch baseline after implementation:

- No query, cache key, API adapter, mutation callback, action enum, schema, capability or route logic was removed or rewritten. The main Home container and pure state composer are unchanged.
- Home still distinguishes loading, query failure, failed scan, syncing empty mailbox, genuine first use, sender-only progress, and cleared-email progress. It renders no made-up totals when data is unavailable and retains all secondary statistics.
- Screener keeps `totalPending !== null` gating; a buffered queue length is never presented as the true total. Autopilot summary is absent for errors/loading and treats tier-blocked active rules as inactive.
- Brief keeps empty/quiet states, historical date anchors, template narrative fallback, protected/non-actionable noise and archived/failed outcomes. Activity keeps invalid filters, first-page/next-page errors, original loaded rows, partial undo failure and recovery access.
- Quiet retains timezone/overnight/error/disconnected states and original save validation. Later preserves unknown counts/syncing states and return errors. Onboarding retains scan-retry/disconnect/logout and does not convert a failed scan to successful empty state.
- Settings controls and deep-link refs remain mounted. Unknown-tier privacy, billing-disabled/error, scheduled changes and invoice/provider gates are unchanged. Admin unauthorized output is untouched.

Exact populated Storybook IDs (standard IDs derived from the existing CSF titles/exports):

- `home-homeview--cleared`; edges `home-homeview--senders-decided`, `home-homeview--new-user`, `home-homeview--sync-failed`.
- `triage-focuscard--default`; protection/preview `triage-focuscard--protected`, `triage-focuscard--inline-preview`.
- `autopilot-autopilotscreen--default`; gated `autopilot-autopilotscreen--pre-upgrade-observe-preview`.
- `autopilot-rulecard--not-running-on-plus`.
- `features-brief-briefscreen--populated`; `features-brief-briefscreen--with-history`, `features-brief-briefscreen--noise-all-protected`.
- `features-later-laterscreen--populated`; `features-later-laterscreen--count-syncing`.
- `features-followups-followupsscreen--populated`.
- `features-activity-activityscreen--populated`; `features-activity-activityscreen--next-page-error`, `features-activity-activityscreen--undo-in-progress`.
- `screener-screenerscreen--default`; `screener-screenerscreen--protected-override-preview`.
- `quiet-quiethourscard--configured`; `quiet-quiethourscard--crosses-midnight`.
- `settings-privacydata--two-mailboxes`; `settings-privacydata--tier-unknown`.
- `features-billing-billingscreen--pro-subscriber`; `features-billing-billingscreen--payment-unconfirmed`.

Use `/iframe.html?id=<id>&viewMode=story` on the local Storybook server. These are source-derived IDs, not a claim that this subagent opened them.

No commit or deployment was performed by this slice.

### Home fidelity correction against the final approved render

Compared the active `editorial.tsx` Overview render (not obsolete sidebar CSS). Restored the large two-line greeting with terracotta emphasis, angled progress stamp, asymmetric opportunity panel, attention rows, and activity module in `features/home`. The stamp uses the existing all-time summary, keeps the earliest-action month, and excludes undone outcomes. All secondary metrics remain visible. Sender previews project up to three valid identities from the already-fetched Triage bootstrap; counts are explicitly **last 90 days**, not the prototype’s fictional inbox counts. Sender names link to existing detail routes. No new requests or mutations. When that queue is unavailable/empty, the right panel presents existing recorded progress, without invented senders. Attention rows use the two existing capability-gated pending counts; unknown/zero counts do not claim waiting work. Activity links to the real outcome history. Loading, error/retry, empty, syncing, failed-scan, and unresolved-mailbox handling remain intact.

Validation: focused Home suite 3 files / 29 tests passed; Home ESLint passed. Whole-web typecheck encountered only the concurrently edited shared `app-shell.tsx` Sidebar `animateWidth` prop mismatch, reported to the shared-shell owner. Browser fidelity handoff: `home-homeview--cleared` now has three synthetic story-only sender projections and both pending counts; the production container always uses live projections. Browser visual verification remains with parent.
