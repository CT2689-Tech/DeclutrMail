# Delete Email age: review patch

The founder requested Delete next across Senders, Triage and Screener, including inline previews: default Email age to **Older than 180 days**, keep **Any age** available, and use the same age/scope for counts and the action. Review this patch before Later. This supersedes the earlier preservation of Triage's all-age Delete default.

Owner and integration owner: this chat. Worktree: `delete-age-preview`, branch `codex/delete-age-preview`. This patch depends on draft Archive PR #1082 at `8b2049271947c0e49e50f7961a9e501bf5261547`, which depends on draft Delete layout PR #1081. It is held for founder review; no merge or production release is authorized. The Archive and original prototype worktrees are untouched.

## Result

- Senders list, inspector, full sender detail and bulk already share ConfirmActionModal and the 180-day default. Email age now remains visible even with an empty inbox. Widening to include archived email preserves the chosen age; its invitation count uses that same age. A missing selected Delete count cannot arm click or keyboard confirmation.
- Triage starts a new Delete preview at 180 days in the pending-action store. Email age drives the inbox/all-mail bucket, impact summary, Details, subject sample, Gmail search and request. Any age is explicit null and is preserved as such. Click and Cmd/Ctrl-Enter confirm the same age shown. Age and reach belong to the same pending action, so changing one preserves the other; cancel, a new preview and mailbox reset clear both immediately.
- Triage's shared inline renderer supports the same age control, impact and short Delete button. Its count and repeated-shortcut dispatch use the same pending selection. The existing product rule still requires the full sheet for Delete: this patch adds no Delete skip-sheet preference. The inline story and integration fixture exercise that renderer without changing which surface the product opens.
- Screener's inline Delete already starts at 180 days. It now retains a selected archived scope when that count becomes unavailable, hides the stale impact and blocks click/Enter confirmation. The checked scope control stays enabled so the user can narrow to Inbox only.

The shared client previously converted malformed/missing all-mail age counts to zero. It now treats an incomplete or invalid all-mail block as unavailable, matching the boundary's documented contract. This avoids false zero claims and an inbox-count fallback under a wider Delete request. Explicit Inbox only remains recoverable. Valid zero counts are still legitimate and block a no-op; Email age remains editable.

Counts are a preview snapshot. The selected age and reach are carried into the existing API; the worker resolves matching messages at execution time. There is no new backend contract, worker filter, quota rule, Protected override/exclusion rule or Undo policy. Archive behavior remains as reviewed; Later, Unsubscribe and Autopilot are not extended. The public simulator has no dated fixture messages and is not given an age filter backed by invented data.

Owned files: Senders confirmation and Delete story/tests; Triage store, screen, shared preview/detail presentation and stories/tests; Screener count/confirm gating and keyboard tests; the existing frontend all-mail preview normalizer and its regressions. No lockfiles, backend, database or infrastructure files change.

## Review fixtures

Static Storybook uses fictional mail and sample-only confirmations. The primary review stories are:

- `senders-deletepreview--default`
- `triage-actionsheet--delete-default`
- `triage-actionsheet--delete-inline` (renderer fixture; no new product skip-sheet setting)
- `screener-decidepreview--delete-default`

The default fixtures show 84 inbox matches at 180 days, 128 at Any age, 96 at 180 days including archived email, and 146 at Any age including archived email. Older than 1 year has zero inbox matches. Selected-age cutoff wording uses the existing approximate client-clock display. Delete’s empty-age and tied-age messages use day labels matching the selector, instead of the old “6 months+” wording. Primary component stories also cover loading, unavailable, empty inbox and Protected states.

## Verification

Focused tests cover actual Triage request bodies for modal click/keyboard, explicit Any age at widened reach, inline button/repeated shortcut, zero and unavailable buckets, age/reach reset, samples and Gmail scope. Screener regressions verify an unavailable archived age blocks both click and Enter, then an explicit Inbox-only choice submits the matching age. Senders checks missing-default blocking and recovery through Any age. Existing action lifecycle, Protected, quota, Archive and Unsubscribe coverage stays in the full suite.

Negative control: reverting only the Triage Delete age request, Screener's unavailable-reach guard and Senders' missing-age guard makes all five selected regressions fail. Exact candidate bytes are restored before final checks. Final full-suite, typecheck, lint, formatting, production build/budget, Storybook and browser receipts are recorded in the draft PR.

All 4,759 web tests pass (3 existing skips across 381 files), as do workspace typecheck, lint (zero errors, six existing unused-disable warnings), changed-file formatting, static Storybook, the CI-flag-parity production build, all 52 route bundle budgets and all 32 static-route prerender checks. No bundle rebaseline is needed.

Built-in browser: all three default fixtures show 84 inbox matches at Older than 180 days. Triage preserves archived scope when changed to Any age (146); Senders sample confirmation reports 146, inbox and archived, Any age. Triage inline shows 128 at Any age and states destination, future effect and recovery once. Senders’ zero-age state keeps the selector editable and disables Delete. At 320×568 the modal body scroll exposes age and scope above persistent impact/recovery/actions; Senders and Triage each measure 310px client/scroll width. Screener's existing page scroll keeps those controls/actions accessible with 246px client/scroll width. Temporary browser sizing is restored. Screenshots are saved outside the repository; review tabs return to 180 days and Inbox only.

Independent design-system review remains pending. Browser component fixtures and mocked request tests do not establish provider completion. No real Gmail action or local API/database browser journey is claimed. Hold this candidate for founder review before Later, merge or release.
