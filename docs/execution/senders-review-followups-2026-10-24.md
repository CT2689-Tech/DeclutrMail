# Guided Review follow-ups

Owner and integration owner: this Codex session, in `codex/senders-review-followups`.
Base: `4b79a6c`. No dependency on open PRs. Owned surfaces: Guided Review session
exit, Suggested focus-card presentation, their tests and this record. Existing
action handlers, eligibility, previews, confirmation, execution and Undo stay intact.

## Flow contract

- All senders selection → Review selected → native sender details → return while
  sender data loads → Back to Senders must retain the saved selection. Validate
  token, user, mailbox, scope and expiry before restoring navigation context.
- Loaded sessions retain the action owner's current selection, including a
  deliberate clear. Expired, missing or mismatched sessions never restore IDs.
  Loading and failed reads remain cancellable; exiting ends the saved review.
- Suggested Guided Review with an Archive verdict and known zero Inbox count
  shows the clear-Inbox message without recommending Archive. Archive remains
  available through More actions and uses its existing fresh preview. Positive
  and unknown counts, other recommendations and standalone Triage stay intact.
- Desktop and phone widths must preserve navigation, focus, current/history
  distinction and all existing actions. Needs first review is a sibling smoke.
- No actual emails, policies, protection, billing, onboarding or provider access
  are changed. Synthetic state supplies slow reads, empty previews and failures.

## Result and verification

Both fixes implemented. Negative controls failed against the original behavior:
the returned sender checkboxes were unchecked, and the zero-Inbox card still
said Suggested: Archive. Both assertions pass with the fixes.

- Regression coverage: loading exit, failed-return exit, missing/expired storage,
  token/user/mailbox/scope mismatch, loaded-owner intentional selection clearing,
  zero/positive/unknown Inbox, Unsubscribe at zero and standalone Triage.
  Final focused suite: 302 tests across 11 files passed with one worker.
- Workspace typecheck, lint and formatting passed. Lint retains six existing
  unused-disable warnings outside this diff. Production build, all 49 route bundle
  budgets, two redirect checks and prerender checks passed. The first build hit a
  deliberately low 1 GB heap cap; the completed build used a 2 GB cap.
- Independent source/design-system review and defect-class sweep: no blockers.
- Built-in browser, isolated synthetic account, actual production build: desktop
  1280×720 and phones 320×760 / 390×844. Both desktop and 320px preserved two
  selections after native detail → loading → immediate exit. No horizontal overflow.
- Zero Inbox: no Archive suggestion at rest or with Why open; evidence remains;
  Archive available in More actions. Desktop and mobile zero previews disallow
  confirmation and lock review navigation. Cancel restores focus to Archive.
- Positive Inbox still suggests Archive and previews the fresh count. Needs first
  review navigation, expansion and 44px phone action targets remain intact.
  Three Archive previews cancelled; no confirmation, Keep, protection or policy
  action taken. Browser warning/error logs empty. Synthetic fixture counts restored.
- Production/provider execution is outside these local checks. No real email
  action is needed for release verification. Privacy-safe captures are outside the
  repository under the session's `senders-review-followups` visualization folder.

Adjacent existing opportunity, deferred under the requested Archive-only scope:
Suggested Later can remain emphasized at zero Inbox; native sender details already
suppress both zero-Inbox Archive and Later recommendations. No policy expansion
is included here.
