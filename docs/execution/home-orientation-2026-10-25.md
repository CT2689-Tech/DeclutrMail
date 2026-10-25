# Home orientation

Owner: this Codex chat. Branch `codex/home-orientation-20261025`, base `f265efbcc`. Own Home screen/view/styles/arrivals, bounded read composition and affected tests/copy. Existing sync, Activity, Screener and Later APIs are the only dependencies. No overlap with open billing/mobile/ops PRs. No provider, billing, schema, retention or collection change.

Intent: first visit → first cleanup; return → what changed and what needs attention; running work → progress owner; no suggestions → honest neutral state. One main action. Existing fresh preview → confirmation → shared queued/running/terminal/Undo remains unchanged. Verify synthetic local data; production read-only after release.

Design: keep #ffffff/#2b2730/#6f568a light and #302a32/#f4edf1/#d1b8d6 dark. Existing display type carries the recommendation; sans-serif carries short context. Keep 920px composition and current sender preview. Add quiet text rows rather than a dashboard grid.

```text
Home / account
Gmail status · last completed scan
Since your last visit: new scanned mail · new senders
[ One prioritized action + relevant preview ]
Confirmed impact · all time                    Activity
> Details
```

Brief review: this restores orientation without repeated explanations. Status uses the existing sync read, changes use the existing frozen visit window, and impact uses actual archive/delete affected counts excluding undone rows. Pending and unknown never become success or zero. The shared tray remains the only lifecycle announcer.

Priority: connection/scan recovery → accepted running/uncertain cleanup → pending first review → Later returns needing attention → report cleanup → neutral sender review. New sender review takes precedence over Later attention; both are safe navigation. Scheduled future Later timers never imply urgent work. Missing reads retain a neutral action, never a blanket caught-up claim.

State/verification: first/return, null visit counts, ready with newer incremental failure, reconnect while ready, queued/syncing, running/uncertain/terminal-grace cleanup, optional read failure, future/due Later, summary error, preview cancel, Undo, active account switching, keyboard and 375px layout. Existing preview/quota/protection/mutation regressions retained; no live mutations, purchases or OAuth grants. Larger Brief/followup/automation dashboards are out of scope.

Implemented: visible scan status, compact visit changes and all-time confirmed impact; one primary action selected by current recovery/work/review context; no unrelated sender identities on an attention action. Breakdowns and report context remain in closed Details. Independent review found account-scope and reconnect consistency gaps; both were fixed with regressions and re-reviewed without remaining source blockers.

Verification: 150 Home tests pass across 24 files, including shared action/Undo integration, hydration, account switching, pending reads and nullable context. Old-layout and unscoped-query negative controls fail the new regressions; restored positive checks pass. Workspace typecheck, lint (six existing warnings), Storybook and production build pass. E2E coverage adds pending first-review navigation and visible visit changes with Details closed. Independent source review passes, including an independent 17-test totals/hydration run; no visual review is claimed. Confirmed totals now use explicit mailbox headers and matching server/client mailbox-qualified cache keys; the unqualified key remains the invalidation prefix. A held-second-mailbox regression fails the old key, and existing completion/Keep/Undo refresh and hydration tests cover the scoped key.

Browser verification is blocked: Codex's built-in browser is unavailable while the Mac is locked. An unlock request is pending. The isolated synthetic DB/API/web stack was prepared without a worker or provider credentials; no cleanup, unsubscribe, real mail mutation, purchase or OAuth grant was performed. Keep this PR in draft until the required browser walkthrough, screenshots and independent visual review are complete. Merge/deployment remain authorized after those gates and CI pass.
