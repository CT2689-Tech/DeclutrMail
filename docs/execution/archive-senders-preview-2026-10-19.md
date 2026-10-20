# Archive previews: targeted layout A passes

The founder approved Delete previews, then requested the same targeted pass for Archive in Senders, with current defaults preserved and review before extending Archive to Triage or Screener. This is a separate review patch stacked on draft Delete PR #1081 at `f2c419b305600f9e8f3c35b4b1a2611ef1f82fec`. Owner and integration owner: this chat. No merge or release is requested.

## Scope and behavior

The Senders list, inspector, full sender detail and bulk selection already share ConfirmActionModal. Standalone Archive now uses its review layout: sender/selection title, Email age, Details, and one persistent impact summary beside a short Archive button. The existing recovery note stays beside that action. The summary explains that matching emails leave the inbox and stay in Gmail. Counts live in the summary, rather than the button. Production purple/plum tokens are inherited without overrides.

Archive still opens with Inbox only and Any age (`olderThanDays: null`). It gains no archived-email checkbox: even when the preview provides all-mail counts, Archive uses the inbox buckets. Age selection remains opt-in. Older-than labels express the existing age semantics; a selected age displays the same approximate client-clock cutoff approved for Delete. The server continues to resolve the age at execution time. No default, request payload, API, worker, quota, protection, exclusion or Undo policy changes.

Loading and failed previews hide cached impact counts and keep confirmation disabled. Empty-age selection keeps the age control available; empty inbox and Protected handling retain their existing guards. Protected single-sender confirmation still says Archive anyway. Cancelling and reopening restores the action's existing defaults.

The existing Delete presentation is renamed CleanupPreview/CleanupImpact so both actions can share it. In the first pass, Triage and Screener changes were import/prop wiring for their existing Delete presentation only; Archive was extended to those surfaces after founder review, as recorded below. The Senders design study inherits the same real confirmation component. The original prototype worktree is untouched.

Owned files: the renamed shared cleanup presentation/stories, Senders confirmation and its stories/tests, Senders list/detail/inspector test selectors, the Senders Archive Undo browser-test selector, and the Triage/Screener Delete import wiring. No shared backend contracts, lockfiles or infrastructure are changed.

## Review preview

The actual Senders component is served with fictional counts at Storybook story `senders-archivepreview--default`. Additional stories cover loading, unavailable, empty inbox and Protected states. Confirmation records an on-screen sample result only; it does not call Gmail.

Built-in browser checks: default 128 inbox messages at Any age; selecting Older than 30 days showed 120 and a cutoff; Older than 1 year showed zero and disabled Archive without hiding the age control. Cancelling/reopening restored Any age. Default sample confirmation reported 128 inbox emails, any age. Protected retained Archive anyway. At 320 × 568 the impact, recovery note and action remained together with no horizontal dialog overflow (310px client/scroll width). Default browser sizing was restored. Screenshots are saved outside the repository.

## Validation and review state

All 4,728 web tests passed (3 existing skips across 381 files). Typecheck, lint and static Storybook build passed. New semantic tests cover inbox-only/default payload despite available all-mail data, age recovery/reopen defaults and fail-closed stale/failed previews. Existing mocked Senders integrations continue to assert real action options, bulk exclusions, quota/protection and Undo, with counts checked in the impact summary where their old selectors expected title/button counts.

The CI-flag-parity production build passed, with all 52 route bundle budgets and 32 static-route prerender checks passing without a budget rebaseline. Reversing only the Archive layout failed the new presentation/default test; restoring it passed. Final checks and the exact commit are recorded in the draft PR. Independent design-system review is pending; this document does not claim it. Browser evidence uses fictional component fixtures. The local Docker daemon is unavailable, so no local API/database browser journey or real Gmail mutation is claimed. Keep the patch for founder review before extending to other Archive flows or release.

## Second pass: Triage and Screener Archive

After reviewing Senders Archive, the founder requested the same targeted layout for Archive in Triage and Screener, preserving their defaults and keeping other actions out of scope. This continues the same Archive draft PR; it remains stacked on Delete #1081 and is not approved for merge/release.

- Triage single-sender modal retains Inbox only and Any age, with no date picker or archived-mail option. Its existing Don’t ask again for Archive checkbox stays unchecked on open; cancellation/reopen resets it. Confirmation still sends `archiveHistoric: false`, `wakeAt: null` and `rememberPreference: false` by default. The existing action request retains `primary: { type: 'archive', olderThanDays: null }`, without widened reach.
- Triage’s remembered inline preview uses the same sender title, live impact and short button; its explicit confirmation, cancellation, shortcut and Protected rules remain unchanged. Domain/recommended group Archive uses the same presentation with the live eligible-sender title, aggregated inbox count, per-sender Details and existing Protected exclusion note. Group scope remains Any age with no reach/age controls. Later in the same group component is unchanged.
- Screener retains its inline preview, Inbox only and Any age. It gains no age picker/cutoff or archived option. Its existing decision request omits `olderThanDays` and `reach` for Archive. The 180-day window remains Delete-only. Protected still says Archive anyway, unavailable/zero previews stay disabled, and confirming remains guarded.

All four Archive surfaces reuse CleanupImpact; no API, worker, action handler, quota, protection, preference persistence, Undo window, other verb or Autopilot behavior changes. Only Archive titles/buttons/layout change; count assertions were moved to the impact summary without dropping scope, persistence and completion coverage. The public Triage simulator consumes these actual components and its selectors follow the same presentation.

667 focused Triage/Screener/simulator tests passed. New component tests explicitly preserve the all-age/inbox-only defaults despite available all-mail counts, and existing mocked screen integrations now explicitly reject a widened reach or new age field on Archive requests. Reverting the two new component presentations made both new default/layout assertions fail; the restored candidate is verified separately. An initial broad run hit an Inbox Report Undo test’s one-second UI wait; that unmodified 16-test file passed in isolation. No unrelated Inbox Report change was made. The final broad run passed all 4,730 web tests (3 existing skips across 381 files); no Inbox Report changes were needed. Exact revision and checks are recorded in the PR.

The production build, all 52 bundle budgets and 32 static-route checks passed without a rebaseline. Workspace typecheck, lint, static Storybook and formatting are checked before publication. Independent design-system review remains pending; no gate completion is inferred from the scope workflow.

Built-in browser with fictional mail: modal and inline Triage showed 128 inbox matches at Any age; group Triage showed 256 across two senders and its sample-only confirmation retained that scope. Screener showed 128, confirmed sample-only as inbox-only/any age and reopened at the same defaults. Triage’s remember toggle reset after cancellation. Screener Protected retained Archive anyway; Triage empty inbox disabled Archive and showed no matches. At 320×568, Triage retained impact/recovery/actions/preference together (310px client/scroll width). Screener’s existing inline page scroll kept impact/recovery/actions together (246px client/scroll width). Browser sizing was restored. Review stories are `triage-actionsheet--archive-default`, `triage-actionsheet--archive-inline`, `triage-actionsheet--archive-batch` and `screener-decidepreview--archive-default`; both primary components also cover loading/unavailable/empty/Protected.

Browser evidence is component-fixture evidence, not provider completion. No local API/database stack or real Gmail action was run. The original prototype worktree remains unchanged. Hold this candidate for founder review before other actions or release.
