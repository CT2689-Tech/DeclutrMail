# Triage inline Unsubscribe + Delete archived scope — 2026-10-25

## Flow contract

User intent: use Include archived email in Triage's remembered inline
Unsubscribe + Delete preview consistently with Senders and the full sheet.
The choice starts off, Any age remains the default, and selected age/reach govern
both the visible count and confirmed request. Mode changes and cancel/reopen reset
reach. Missing, stale or failed all-mail counts must block confirmation without
falling back to an inbox count. Onboarding's inbox-only scope is unchanged.

Owner/integrator: this session, `codex/triage-inline-archived`, isolated worktree
from main `57303e6d`. Owns Triage preview assembly/rendering, scope/confirmation
wiring, focused tests/stories and this audit. No API, worker, automation, billing,
OAuth or migration changes. No dependency on another open PR.

Production evidence from the preceding browser check: inline Unsubscribe + Delete
showed Any age and inbox count but no archived choice; full Triage Delete and
Senders did offer it. Live verification will only open, edit and cancel previews;
no emails, unsubscribe requests or review decisions may be confirmed.

## Cause and repair

Three separate omissions affected only the remembered inline path:
`InlinePreviewBlock` had no scope control and hardcoded inbox-only impact text;
`activeReach` accepted only sheet previews; inline confirmation omitted reach.
The authenticated preview assembler now passes the existing shared scope control
as a node, preserving the public simulator import boundary. Both surfaces use the
selected Delete scope and inline confirmation sends that scope with its age.
Archive and Unsubscribe only still use inbox counts; changing mode resets reach.

## Verification

- Two click/shortcut regressions failed before the fix because the archived
  choice was absent. Tests now cover selected counts/payloads/Gmail links,
  archived-only mail, zero age windows, missing counts, failed refresh/retry,
  reset after mode changes/cancel, and onboarding's inbox-only restriction.
- Triage suite plus final action-file rerun: 32 files / 593 tests passed
  (final action file: 131 passed). Adjacent Senders/public demo: 211 tests passed.
  No API/worker contract changes.
- Full typecheck completed for all packages; a test-only Testing Library option
  error was corrected and the affected web check rerun. ESLint passed with six
  existing unused-disable warnings. Formatting passed.
- Production web build, all 49 route bundle budgets and prerender checks passed.
  Storybook production build passed; added interactive scope, archived-only and
  unavailable-count stories.
- Isolated synthetic production web/API browser: two Inbox + one archived email.
  Any age opens count two, archived off; checking shows three with Inbox and
  archived scope. Older180 yields zero/disabled and retains the choice.
  Cancel/reopen restores Any age/count two/archived off. At 320px, content width
  equals viewport width. All previews cancelled. Server log has no action POST;
  DB labels remain two INBOX + one archived, zero TRASH. No worker or provider
  credentials were present. Temporary native SWC preload stayed outside the repo.
- Added an actual-server Playwright journey that seeds a synthetic remembered
  preference and archived email, verifies counts/reset, asserts no action POST
  and unchanged Inbox count, and restores its preference/message in finally.
  CI execution remains separate from the local built-in browser smoke.

Independent source/test/design/usability review passed with no blockers. The
reviewer checked fixture cleanup, failure gating, mode/reset and onboarding cases,
and read final validation logs. Integration evidence is linked in the PR. Production
verification after deployment will open/change/cancel previews only. No confirmed
unsubscribe, deletion, review decision or real mailbox mutation is authorized.

## Opportunities and limits

The bounded consistency gap is repaired. Existing manual scope controls and
counts suffice; no new data or feature is needed. Provider execution/Undo and
onboarding/billing changes are outside this preview-only task.
