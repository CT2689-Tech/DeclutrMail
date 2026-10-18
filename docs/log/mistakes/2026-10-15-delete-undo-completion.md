# Undo completion must describe the entire restored scope

**Observed:** Whole-decision Undo returned only its first reverse job, and replaying an already-restored primary token skipped unfinished siblings. A single early success/read could leave other restored emails absent from the current view. Existing UI tests omitted current counts or only checked that a result label disappeared.

**Repair:** Return the frozen reverse set and read it together with mailbox ownership checks. Report success only after every reverse job and reversal journal commits. Preserve action-only Activity Undo. A whole-decision request waits for forward label jobs to finish so tokenless unfinished work cannot be silently omitted.

**Independent review catches:** Retried jobs reuse IDs, so cached terminal status must be reset before mutation-success observers enable polling. Failed/unknown report Undo must retain a visible retry and explanation. Handles and callbacks must stay scoped to their originating mailbox.

**Enforcement:** Full Delete → zero-current removal → Undo tests assert original Inbox/archived counts, sender reappearance, accepted unsubscribe preservation and eligible controls without reload. Delayed-sibling, partial failure, journal confirmation, queue-free completed replay, bounded batch reads, production-stale-time retry and mailbox-boundary regressions cover the repaired seams. Negative controls restore primary-only replay and cached progress, then fail the new assertions; a `finally` block restores both source files.

**CI catch:** The new running/unknown Undo throw codes initially lacked shared `ERROR_CODES` entries. Direct controller tests missed exception-filter flattening; the existing full-CI throw-site scanners caught it. Register every new domain code and include the scanner/filter suites when changing error paths. Existing scanner/filter tests and shared registry/glossary tests pass after registration; no test baseline was weakened.
