## 2026-10-04 — Complete fixture checks before starting a gate review

**PR:** Pending API read-scheduling follow-up.
**Caught by:** architecture-guardian precondition and local typecheck.
**What happened:** The new isolated HTTP fixture was submitted for review while its checks were still running. Its copied setup retained two unused imports and supplied a nonexistent activity-log field. The gate correctly stopped before reviewing the diff. The runtime smoke alone did not expose the discarded field.
**Correct approach:** Remove the unused imports and invalid fixture field, then confirm successful typecheck and lint exits for the complete candidate before requesting the gate review.
**Rule:** Start structural review only after the final candidate's typecheck and lint have completed successfully.
**Enforcement update:** None; the existing gate precondition caught the issue.
