## 2026-09-26 — A failure write after an ambiguous queue add overwrote a later state

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** architecture-guardian [BLOCKING]
**What happened:** When `queue.add` threw, `enqueueJob` set the job `failed / ENQUEUE_FAILED` by id alone. An add can throw after it landed (a timed-out reply), so the worker may already have started or finished the job: the write could turn a Protected skip into a retryable failure, or overwrite `executing`. The worker reads `failed + ENQUEUE_FAILED` as "never reached Gmail", so a retry after that overwrite would skip the Protected re-check after Gmail may have moved the mail. The Unsubscribe and Autopilot sibling writes had the same shape (one also wrote `unsub_status='failed'` and an `unsubscribe_failed` row about a request that may have been delivered).
**Correct approach:** Guard every such write with `status = 'queued'`, and write its side effects only when that update matched a row.
**Rule:** A write that records the failure of an external call must be conditioned on the state it assumes the call left; an ambiguous failure never overwrites progress.
**Enforcement update:** API and Autopilot specs where the add throws after the row moved, negative-controlled.
