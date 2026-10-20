# Archive previews: layout A and Email age

The founder approved the Archive layout and requested Email age across Senders, Triage and Screener, including inline and group previews. This replaces the earlier constraint to preserve the absence of age controls in Triage/Screener. Archive opens at **Any age**, inbox only, and returns to that default for every new preview. Other actions and Autopilot are outside this pass.

This review patch is stacked on draft Delete PR #1081 at `f2c419b305600f9e8f3c35b4b1a2611ef1f82fec`. Draft Archive PR #1082 remains for founder review; no merge or release is authorized. Owner and integration owner: this chat. The original dirty prototype worktree is untouched.

## Behavior and scope

| Surface                                              | Archive age and confirmation                                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Senders list, inspector, full sender detail and bulk | Shared ConfirmActionModal: Any age, optional older-than selection, matching inbox count, sample and Gmail search, age carried in confirmation. Email age remains visible even with an empty inbox. |
| Triage single-sender sheet                           | Pending Archive owns the age. The selected bucket drives impact, subject sample, Gmail search, Details and click/Cmd/Ctrl-Enter payload.                                                           |
| Triage remembered inline preview, list and focus     | Same pending selection and count as the sheet. Both the button and repeated Archive shortcut dispatch that selection. Age is not saved as a preference.                                            |
| Triage domain and recommended groups                 | One age applies to the aggregate and each sender in Details. Click and Cmd/Ctrl-Enter enqueue the same age for the sender selection. Protected senders remain excluded.                            |
| Screener inline preview                              | Existing pending window now supports Archive. Click and Enter send the age used for the displayed inbox count. Archive still cannot include archived email.                                        |

The common layout keeps a stable sender/selection title, visible Email age, Details and an impact summary beside the short Archive button. Counts stay in the summary. Matching emails leave the inbox and stay in Gmail; the existing recovery note remains next to confirmation. Production purple/plum tokens are inherited.

Options are Any age, Older than 30 days, Older than 90 days, Older than 180 days and Older than 1 year. A chosen age displays the approved approximate client-clock cutoff. These are older-email selections, not “Last 30 days.” The API resolves the cutoff again at execution time; the preview is a current estimate, not a fixed message snapshot.

Loading, refetch and failed previews hide stale impact counts and block confirmation. Triage also removes stale subject examples and Gmail handoffs during an Archive refetch. A missing selected bucket stays unavailable instead of falling back to the all-age count. Group confirmation also requires the selected bucket for each unprotected sender. Zero matches keep Email age editable and disable the mutation; users can return to Any age. Cancel, a new sender/action or mailbox reset clears the age selection.

Existing API contracts already support Archive olderThanDays; no API, worker, quota, protection, exclusion or Undo policy is changed. Triage and Screener frontend request wiring changes from all-age-only to carrying the chosen age. Delete, Later, Keep, Unsubscribe and Autopilot behavior remain unchanged. The public inbox simulator is not given an age selector: its synthetic data has no dated messages, and this pass does not invent age data or a simulated filter.

## Review previews

Static Storybook on localhost:6020 uses fictional counts and sample-only confirmations; it does not call Gmail.

- `senders-archivepreview--default`
- `triage-actionsheet--archive-default`
- `triage-actionsheet--archive-inline`
- `triage-actionsheet--archive-batch`
- `screener-decidepreview--archive-default`

Default, loading, unavailable, empty inbox and Protected stories remain available for the primary components. The default fixture has 128 inbox emails; Older than 30 days has 120, and Older than 1 year has zero. The two-sender group has 256 total at Any age and 240 at 30 days, with 120 shown for each sender. Sample confirmation reports the selected count and age. Reopening restores Any age.

Built-in browser checks cover default → 30 days → zero matches → cancel/reopen, inline and group confirmation, and 320×568 layouts. Triage's body scroll exposes the age control while impact, recovery and actions stay in the footer; no horizontal dialog overflow (310px client/scroll width). Screener uses normal page scrolling, with no horizontal preview overflow (246px client/scroll width). Temporary browser sizing is restored. Screenshots are stored outside the repository.

## Verification and review state

New mocked-network regressions assert the selected count and actual Archive request for Triage modal click/keyboard, inline click/repeated shortcut, group keyboard, and Screener click/Enter. They check default/reset behavior, zero/missing buckets, stale-refetch blocking, subject samples and Gmail scope. Existing Senders tests cover its age options and confirmation payload; a regression keeps Email age visible for an empty inbox. Existing protection, quota, action lifecycle and Undo coverage remains intact.

Negative control: reverting only the Triage and Screener Archive age fields in the request made all six single-sender wire tests fail. The exact candidate bytes were restored. Check receipts and final revision are recorded in the draft PR.

All 4,742 web tests passed (3 existing skips across 381 files). The CI-flag-parity production build, all 52 route bundle budgets and all 32 static-route prerender checks passed without a budget rebaseline. Workspace typecheck, lint (zero errors, six existing unused-disable warnings), changed-file formatting and static Storybook all passed. Exact receipts are recorded in the draft PR.

Independent design-system review remains pending. Local browser evidence is component-fixture evidence, and mocked request assertions are not provider completion. No production mailbox mutation or local API/database browser journey is claimed. Hold for founder review before other actions, merge or release.
