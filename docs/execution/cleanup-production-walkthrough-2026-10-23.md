# Cleanup production walkthrough — 2026-10-23

## Scope and evidence boundary

Walk through All senders, Guided Review and Needs first review in the existing
owner account using Codex’s built-in browser. Confirm the visible account before
testing. Deployed baseline: `d46cdf7425a791c6ec1672a0efae7da7d895392e`; the UI
matches the original cleanup release at `2b23dc08cc41273a8df2efcb712af45e893c1240`.
Newer files are operations/docs only.

User intent: find senders, understand an existing suggestion, inspect native sender
details, review a selected or filtered queue, inspect impact before deciding, and
return to the same work. Existing previews, Protected rules, action owners and
recovery remain authoritative.

No live action confirmation, Keep, Protect/Unprotect, Undo, unsubscribe submission,
Scan or account/plan change was invoked. Every opened action preview was canceled.
Live checks cover navigation, existing metadata, counts, previews and cancellation;
provider movement, action completion and restoration remain synthetic-test scope.
No real mailbox addresses, subject lines or production screenshots are committed.

## Reproduced findings and bounded repairs

1. **P2 — Native details lost a selected review.** Select two senders from a
   15-result filter, advance to the second, open full details, and use browser
   Back. The baseline reconstructs the full filtered queue at 1 of 15 instead of
   the selected queue at 2 of 2. Preserve explicit queue IDs/order/position and
   originating scope in a validated, expiring per-tab session bound to user and
   mailbox. The URL carries an opaque review token; unrelated entries do not
   restore an old selection. Re-read all current sender/action facts. Unavailable
   or mismatched sessions must offer recovery rather than widen their scope.
   Ended review entries retain their token for explicit recovery on browser Back;
   All/first-review destinations remove it in one history write.

2. **P2 — First-review previews remained armed across view changes.** Open an
   Archive preview, switch to All senders, then return. The same pending preview
   and enabled confirmation remain. Source confirms the preview observer did not
   disable/re-enable with view activity. Close only unconfirmed previews when the
   view deactivates, then require a fresh read when reopened. Retain every accepted
   action handle, reconciliation poll and recovery watcher.

3. **P2 — Keep copy overstated queue exclusion and retained obsolete language.**
   Native detail still said “Skipped in Triage” while the directory used “Skipped
   in suggested review.” The preserved daily queue can include an older kept
   sender again. Label the saved policy choice “Kept” and state that Keep leaves
   email where it is. Keep the Protected/automatic-cleanup distinction. Do not
   change the policy, suppression window, engine or dispatch behavior.

4. **Source-confirmed scope transition risk.** During a pending search/scope
   transition, scoped Start could capture rows from the prior query. Disable Start
   until the requested scope has resolved, including explicitly selected reviews.
   Verify the transition with an isolated regression rather than live mutations.

## Complexity recommendations, kept separate from the repairs

- **P2 — All senders first-fold density.** At 1280×720 and 320px phone width, even
  the collapsed Inbox Report plus stacked heading/tabs/review CTA, filters, Trash
  explanation and statistics pushes every sender row below the first viewport.
  Place the desktop CTA beside the title, tighten header spacing, make the closed
  report a quiet one-line entry, and move detailed Trash explanation to Delete
  context. Acceptance: useful sender rows visible at normal laptop height while
  retaining readable text and touch targets. No new destination or menu is needed.
  Layout changes are a separate design choice, not silently included in this fix.
- **P2 — Suggested action payoff.** A live suggested card showed a historical
  90-day count and Archive, but its current-Inbox preview had zero matches. Archive
  was correctly disabled. Source confirms the original daily queue deliberately
  includes empty-Inbox/kept/protected senders; consolidation preserved that engine.
  Expose current eligible impact alongside the suggestion or revisit eligibility
  separately. Do not change this policy under a return-navigation repair.
- **P3 — Optional clarity.** “Finish review” can imply all decisions are complete
  when it only exits; “Done for now” is a possible label. First-review “Later”
  chips could be labeled as suggestions. Screen-reader current-sender announcements
  in selected review merit a dedicated assistive-technology check; this was a
  source observation, not a completed screen-reader test.

## Production walkthrough results

- All senders: list and native pane/full page loaded; ordinary browser Back
  restored search and pane. Search/autocomplete, grouped results, zero results,
  disabled empty-scope review and Clear search & filters behaved correctly.
- Native Archive preview: current matching count, Inbox-only/Any-age scope and
  30-day recovery copy; initial focus on Cancel, Tab moved to Email age, and Cancel
  restored focus to Archive without dispatch.
- Guided Review: selected queue navigation, Next/Previous and last-card Finish;
  filtered reload retained its scope, and Finish returned to the same filtered
  directory. Keyboard help opened, blocked the Archive shortcut behind it and
  closed with Escape. Native-detail return regression is recorded above.
- Needs first review: pending total and loaded-window distinction, explanation
  that mail still arrives, expandable native rows and cancellable inline preview.
  Retained-preview regression is recorded above; the pending queue was not decided.
- Phone 320px: no horizontal overflow in all three views; Next visible and 44px
  high. Zero-match Archive preview stayed within the viewport and disabled its
  final action. Temporary viewport override was reset afterward.
- No new production browser warnings or errors during the walkthrough.

## Verification and handoff

Integration owner: Codex root, isolated `codex/cleanup-walkthrough-fixes` branch.
Guided implementer owns session persistence/return links and their regressions;
first-review implementer owns inactive-preview cleanup; root owns shared copy and
this record. A separate read-only reviewer checks the integrated contracts.
No API, worker, database, recommendation engine, billing, OAuth scope, provider or
Undo-window change is part of these repairs.

Independent review approved action ownership, per-tab privacy/account isolation
and native design preservation. Schema and webhook reviews are not applicable.
First-review negative control reproduced the old retained preview; its repaired
10-file suite passed 132 tests. The same two isolated navigation fixtures failed
against the baseline (1 of 15 instead of 2 of 2; enabled Start during the scope
transition) and passed against the repair. New session/navigation regressions
also cover invalid/expired tokens, native-link render boundaries, no-filter
loading/error recovery, owner hydration, selection clearing and storage denial.

Complete Shared passed 942 tests, Config 38 and Events 76. The full Web run passed
4,957 tests with one billing timing failure; that unchanged billing suite passed
all 164 tests on rerun. A new scope-transition test initially waited past the
gap it intended to test and assumed a selection already cleared by the existing
owner; it now freezes the actual host/debounce gap. This test setup correction
did not require a runtime change. An initial typecheck raced Next's regeneration
of `.next/types`; the sequential full-workspace rerun passed. Full lint has no
errors and retains existing warnings.

Final affected Cleanup/Senders/first-review/suggested-review suites passed 1,665
tests across 103 files, with three existing skips. The final optimized build,
full workspace typecheck, formatting, all 50 route bundle caps and 32 public
prerendered routes passed. No cap or baseline was raised.

Built-in browser checks against the production build with isolated synthetic
fixtures confirmed selected 2-of-2 restoration after browser Back, native Back
and reload, ended-session recovery, accurate Kept copy, and first-review draft
removal on leave without any submission. A browser-observed Finish URL sequencing
issue was corrected in the shared destination helper. Logout cleanup imports a
tiny storage helper so the navigation code does not inflate Settings' bundle;
all existing route caps passed without a rebaseline or cap increase.
The final browser build settled Finish at `/senders`, preserved ended-review
recovery on Back, and removed the token from first-review destinations. The
320px first-review view had no horizontal overflow. No real Gmail action was
submitted during either walkthrough.

Final frozen-source checks, exact ready commit, required CI and release state
belong on the PR and in the task result. Local or baseline observations alone
are not a production release verdict.
