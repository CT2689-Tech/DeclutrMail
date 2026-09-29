## 2026-09-26 — A retry skipped the execution-time Protected re-check without consent

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** flow-completeness-auditor [BLOCKING] and architecture-guardian [QUESTION], on the first cut of the fix above
**What happened:** The worker exempted every recovery attempt (`recoveryAttempt > 0`) from the new re-check, reasoning that the user had reviewed it. But the review could show the sender as not Protected, and the confirmed job then waits on the same lock where incremental sync auto-protects. A retry could still archive or trash a now-Protected sender's mail with no "…anyway" from anyone.
**Correct approach:** The retry carries consent only when the review showed the sender as Protected and it still is. Otherwise the worker re-checks, and a Protected sender stops the retry as `failed / RECOVERY_SENDER_PROTECTED` (founder decision 2026-09-26: failed, not skipped, so it stays reviewable). Confirm refuses 409 when the set is Protected and the review said otherwise.
**Rule:** An exemption from a safety check is a consent the user gave on screen, carried in the job, never a property of the job's kind.
**Enforcement update:** worker specs (stopped, stopped at send, consented runs) and a contract spec from a real Confirm to the real worker, each negative-controlled.
