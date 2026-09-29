## 2026-09-27 — Triage, the Screener and the Brief re-armed rows whose job might be running

**PR:** #805 (https://github.com/CT2689-Tech/DeclutrMail/pull/805)
**Caught by:** flow-completeness-auditor (BLOCKING)
**What happened:** After a 5xx enqueue (the job may have started) or a lost status read, the toast said "check Activity before retrying" but the row went back to looking untouched, one click from a second real job for the same sender (a second Free unit, a second Undo line, a second Later schedule). Senders and Sender Detail already held such rows; Triage (row and domain batch), the Screener and the Brief did not. The tests only asserted that the queue was re-read, so they stayed green with the row armed.
**Correct approach:** Hold every row whose job may be running: Triage feeds them into `busyRowIds` (which also keeps domain batches off them), the Screener into its held-row check, the Brief keeps the senders from being checked again. The queue dropping the row once its job lands releases it.
**Rule:** When copy tells the user not to retry blindly, the UI must make the blind retry impossible, not merely discouraged — assert the second dispatch is refused, not just that a refresh was requested.
**Enforcement update:** tests on each surface assert the row is busy and a second decision does not reach the server, each negative-controlled. A server-derived lock is a follow-up task.
