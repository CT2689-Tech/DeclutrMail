# Senders Archive: targeted layout A pass

The founder approved Delete previews, then requested the same targeted pass for Archive in Senders, with current defaults preserved and review before extending Archive to Triage or Screener. This is a separate review patch stacked on draft Delete PR #1081 at `f2c419b305600f9e8f3c35b4b1a2611ef1f82fec`. Owner and integration owner: this chat. No merge or release is requested.

## Scope and behavior

The Senders list, inspector, full sender detail and bulk selection already share ConfirmActionModal. Standalone Archive now uses its review layout: sender/selection title, Email age, Details, and one persistent impact summary beside a short Archive button. The existing recovery note stays beside that action. The summary explains that matching emails leave the inbox and stay in Gmail. Counts live in the summary, rather than the button. Production purple/plum tokens are inherited without overrides.

Archive still opens with Inbox only and Any age (`olderThanDays: null`). It gains no archived-email checkbox: even when the preview provides all-mail counts, Archive uses the inbox buckets. Age selection remains opt-in. Older-than labels express the existing age semantics; a selected age displays the same approximate client-clock cutoff approved for Delete. The server continues to resolve the age at execution time. No default, request payload, API, worker, quota, protection, exclusion or Undo policy changes.

Loading and failed previews hide cached impact counts and keep confirmation disabled. Empty-age selection keeps the age control available; empty inbox and Protected handling retain their existing guards. Protected single-sender confirmation still says Archive anyway. Cancelling and reopening restores the action's existing defaults.

The existing Delete presentation is renamed CleanupPreview/CleanupImpact so both actions can share it. Triage and Screener changes are import/prop wiring for their existing Delete presentation only; their Archive flows and other actions retain their current presentation and behavior. The Senders design study inherits the same real confirmation component. The original prototype worktree is untouched.

Owned files: the renamed shared cleanup presentation/stories, Senders confirmation and its stories/tests, Senders list/detail/inspector test selectors, the Senders Archive Undo browser-test selector, and the Triage/Screener Delete import wiring. No shared backend contracts, lockfiles or infrastructure are changed.

## Review preview

The actual Senders component is served with fictional counts at Storybook story `senders-archivepreview--default`. Additional stories cover loading, unavailable, empty inbox and Protected states. Confirmation records an on-screen sample result only; it does not call Gmail.

Built-in browser checks: default 128 inbox messages at Any age; selecting Older than 30 days showed 120 and a cutoff; Older than 1 year showed zero and disabled Archive without hiding the age control. Cancelling/reopening restored Any age. Default sample confirmation reported 128 inbox emails, any age. Protected retained Archive anyway. At 320 × 568 the impact, recovery note and action remained together with no horizontal dialog overflow (310px client/scroll width). Default browser sizing was restored. Screenshots are saved outside the repository.

## Validation and review state

All 4,728 web tests passed (3 existing skips across 381 files). Typecheck, lint and static Storybook build passed. New semantic tests cover inbox-only/default payload despite available all-mail data, age recovery/reopen defaults and fail-closed stale/failed previews. Existing mocked Senders integrations continue to assert real action options, bulk exclusions, quota/protection and Undo, with counts checked in the impact summary where their old selectors expected title/button counts.

The CI-flag-parity production build passed, with all 52 route bundle budgets and 32 static-route prerender checks passing without a budget rebaseline. Reversing only the Archive layout failed the new presentation/default test; restoring it passed. Final checks and the exact commit are recorded in the draft PR. Independent design-system review is pending; this document does not claim it. Browser evidence uses fictional component fixtures. The local Docker daemon is unavailable, so no local API/database browser journey or real Gmail mutation is claimed. Keep the patch for founder review before extending to other Archive flows or release.
