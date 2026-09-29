### 2026-09-27 — Decide what approving a paused or turned-off rule's suggestion does
**Source:** PR #802. Defect-class sweep of the Autopilot pending count, verified in code.
**Why:** After "Pause all" or turning a rule off, the pause sheet says
"Pending suggestions stay", and they stay approvable. Approving one says
"Approved N", but nothing moves. `AutopilotActionWorker` skips approved
matches while their rule is off or paused (`skippedRuleInactive`), so they
wait as approved but not yet run. Resume is a direct PATCH with no preview,
and the rule card says resuming "never moves mail". The next action sweep
then runs every waiting approval, including irreversible Unsubscribe
requests, at a moment the user saw no preview (D226).
**How:** Reply with (a), (b) or (c).
- (a) *Recommended:* block approving while the rule is off or paused. Hide
  the Approve buttons on that rule's group, have the API refuse, and show
  approvals already waiting in the Resume / turn-on preview.
- (b) Keep approving, but have the preview say "Runs when you resume this
  rule", and list the waiting approvals in the Resume / turn-on preview.
- (c) Approving runs immediately, whatever the rule's state.
**Verifies by:** A test that approving a paused rule's suggestion does what
was chosen, and that resuming never runs an approval the user was not shown.
To size how much is waiting today, run a read-only query for approved,
not-yet-run Observe rows on off or paused rules.
**Status:** Open
