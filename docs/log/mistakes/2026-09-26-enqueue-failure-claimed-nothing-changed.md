## 2026-09-26 — Enqueue failures said "nothing changed" when the job could still run

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** flow-completeness-auditor (pre-existing, on the surfaces this branch touched), then a class sweep
**What happened:** A 503 `ENQUEUE_FAILED` means the queue did not confirm the add, and a bulk answers it when any one add fails while the rest run. Every web enqueue handler said the opposite: "Couldn't start … — nothing changed", "Couldn't archive X", and for a bulk Unsubscribe "try again", which would send a second request that can never be recalled. The same held for no response and a gateway 5xx.
**Correct approach:** `enqueueMayHaveStarted(err)` is false only for an answer the API wrote that proves nothing started. Otherwise the copy is "Couldn't confirm {action} — check Activity before retrying", and `getActionFailureCopy`'s enqueue phase fails closed when it is not given the error.
**Rule:** "Nothing changed" is a claim; make it only on a response that proves it, and default to unconfirmed.
**Enforcement update:** unit tests for the predicate and copy; Senders, Triage and Sender Detail tests for `ENQUEUE_FAILED`, negative-controlled.
