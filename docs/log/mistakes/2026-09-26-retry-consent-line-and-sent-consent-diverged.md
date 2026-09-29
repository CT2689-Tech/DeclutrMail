## 2026-09-26 — The retry's consent line and the consent it sent came from two conditions

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** flow-completeness-auditor [BLOCKING]
**What happened:** The recovery dialog drew its Protected line and "Delete anyway" button only when mail was still to change (`senderProtected && remainingCount > 0`), while the Activity cell sent `senderProtected: true` whenever the review said Protected. An already-applied review therefore sent consent the reader never saw, and the retry re-applies its whole set, moving anything back in the Inbox since the check. The half-fix (send only what was shown) loops: the API 409s, "Check Gmail again" returns the same review, the line stays hidden. A test pinned the hidden line.
**Correct approach:** One value (`ready && senderProtected`) draws the line, words the button and is what `onConfirm` hands back to be sent.
**Rule:** The consent a request carries is the value the consent UI rendered, passed through, never recomputed by the caller.
**Enforcement update:** activity-screen test for the already-applied review, negative-controlled.
