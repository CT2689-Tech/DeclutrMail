## 2026-10-25 — Home attention needs its own mailbox scope

**PR:** Home orientation follow-up, reviewed before publication.
**Caught by:** Independent source review.
**What happened:** The first implementation promoted shared Screener/Later cache counts to primary attention after a mailbox switch, although invalidation retains old data while refetching. It also split the handling of a cached reconnect marker between the status line and primary action, and suppressed recovery while an empty scan was queued.
**Correct approach:** Explicit mailbox headers and mailbox-qualified optional attention queries; consistent last-known reconnect handling; preserve recovery actions while scan progress is shown.
**Rule:** When cached context becomes a primary recommendation, recheck its account scope and unknown/error semantics at that new level of importance.
**Enforcement update:** Held-second-mailbox, cached-reconnect/error, queued-recovery and stalled-read Undo regressions added.
