# Needs first review: archived Delete scope

Relates to D226 and ADR-0028.

## Cause and change

The shared `ActionReachControl` returned no UI when inbox and all-mail counts were equal, including zero. The screen passed the all-mail count correctly. Equality is scoped to the selected email age: recent archived mail can exist while both 180-day counts are zero. Even a selected archived scope could disappear after a refetch returned equal counts.

Keep the existing Include archived email checkbox visible for equal counts and show the existing same-scope explanation. Needs first review, Senders, Sender Detail, Triage and Unsubscribe's Delete add-on share this control. Inbox only and the 180-day Delete default remain unchanged. Unknown archived counts still disable widening; zero or unavailable selected counts still block confirmation. No API, worker, database or mailbox behavior changed.

A read-only check of the reported sender in the signed-in production UI found zero current inbox and archived emails despite two historically received messages. This is not evidence that two archived messages should be deleted. No real mailbox mutation was performed.

## Verification

- Added a screen-level regression using the real first-review screen, row, preview, query hook and request transport with synthetic responses. It failed before the fix because Include archived email was absent. After the fix, explicit archived scope plus Any age previews two messages and posts `reach: all_mail` with no age restriction. No request fires while adjusting controls.
- 343 affected component and Screener tests pass, including keyboard, mailbox switching, stale/error handling and cancellation. Another 112 Unsubscribe backlog and marketing simulator tests pass after updating their obsolete hiding assertion.
- Full workspace typecheck and lint pass (six pre-existing lint warnings); independent reviewer also built Storybook successfully.
- Built-in browser smoke of the actual production preview with synthetic data passes: matching zero age counts, explicit archived selection, widening to Any age, cancellation/reopen defaults, synthetic confirmation payload, entirely empty mail, and unavailable archived counts. No console warnings/errors. At 320px the checkbox fits without horizontal overflow.
- Added six browser regressions (archived-only, entirely empty and unavailable at 320px and 360px) to the existing render-cleanup-review suite. CI executes these; local browser interaction used Codex's built-in browser.

## Integration

Owner: this chat. No dependencies on open PRs. Shared production file: `apps/web/src/components/action-scope-controls.tsx`; the Senders modal has a matching comment update. Tests and the existing browser fixture cover the affected consumers. Independent design-system review found no production defects; its stale test finding was fixed and rerun. Required checks and normal merge queue govern merge. This document records local/source verification, not deployment or post-release verification.
