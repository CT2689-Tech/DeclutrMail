# Empty-Inbox Later suggestion

Owner/integration owner: this Codex session, `codex/senders-later-suggestion`.
Base: `7444149`. No open-PR dependencies. Owns Guided focus-card presentation,
regression coverage and its Storybook variant; no shared action contracts change.

## Flow contract

Suggested Guided Review with known zero Inbox and a Later verdict shows the
clear-Inbox message without suggesting Later in Why. Current confidence policy
already prevents Later emphasis at rest; that policy is unchanged.
Later remains available in More actions and through L, using the existing fresh
preview, return-time controls, confirmation and Undo. Positive and unknown Inbox
counts retain their existing Why assessment. Archive, Unsubscribe, standalone Triage and native
sender details retain their behavior. Current counts stay distinct from history.

Verification uses synthetic loading/count/preview state and the production layout
on desktop and phone widths. Real email changes, Keep, protection, policy actions,
billing and onboarding are excluded. All opened previews are cancelled.

## Results

- Negative control: the new zero-Inbox test failed on the expanded Suggested:
  Later label against the original source. It passes with the fix.
- 336 focused tests across 12 files pass, including positive/unknown Later,
  standalone Triage, Archive and the existing action/navigation suites.
- Workspace typecheck, lint and formatting pass. Six existing unused-disable lint
  warnings are outside this diff. Production build, 49 route bundle budgets, two
  redirects and prerender checks pass. Read-only merge-queue policy audit passes.
- Independent source/design-system review and defect-class sweep: no blockers.
  The change matches native sender details' existing zero-Inbox Later handling.
- Built-in browser against the actual local production build, isolated synthetic
  account: desktop 1280×720, phones 320×760 and 390×844. At zero, Why retains
  evidence without Suggested: Later. Later stays in More actions; its L shortcut
  opens the same preview. Return-time control remains available, confirmation is
  disabled at zero, navigation locks while previewing, Cancel/Escape recover.
- Positive Inbox retains its Why assessment and previews the fresh count of two.
  Previous/Next, All senders and Needs first review navigation remain intact.
  Phone Later target is 44px. No horizontal overflow or browser warning/errors.
- Four Later previews cancelled (including Escape); zero confirmations. Synthetic
  fixture labels and verdict restored. Test tab, server and containers stopped.
  Captures remain outside the repository in the session's visualization folder.
- No real email, protection or policy action taken; provider execution and Undo
  mutation are intentionally excluded. Their existing handlers are unchanged.

Merge is separately authorized by the user's request. No further product changes
are needed for this bounded finding.
