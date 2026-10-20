## 2026-10-20 — Recovery must survive a failed first preview

**PR:** Follow-up to draft #1087; final PR linked from the cleanup consistency report.

**Caught by:** Independent flow review and request-level negative regression.

**What happened:** Existing Triage remembered inline previews displayed a failed count without Retry, while the modal could refetch. The first repair gated Retry on whether confirmation was blocked. Future-only Unsubscribe is allowed without a count, so a failed first fetch still hid recovery of its disabled cleanup choices. A group preview with a missing selected age bucket also blocked confirmation without offering the existing refetch.

**Correct approach:** Expose preview recovery independently of whether the selected action requires a count. Keep cleanup confirmation closed until the selected count is known, allow future-only Unsubscribe, preserve selections and never submit a mailbox action from Retry.

**Rule:** Check first-fetch failure, cached-refetch failure and missing selected data across both inline and modal previews; a disabled action and an unavailable preview are different states.

**Enforcement update:** Added list/focus request regressions, failed-first-inline-Unsubscribe regression against the actual unsubscribe endpoint, group missing-bucket regressions and interactive recovery stories.
