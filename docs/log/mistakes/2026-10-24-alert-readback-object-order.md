## 2026-10-24 — Provider JSON order is not policy drift

**PR:** Delete Undo recovery and Autopilot launch checks.
**Caught by:** independent monitoring review.
**What happened:** The initial alert verifier compared nested provider objects
with insertion-order-sensitive JSON serialization. Equivalent reordered readback
could fail verification and cause unnecessary policy updates.
**Correct approach:** Canonicalize object keys recursively, preserve array order,
and require a reordered-provider regression to verify with zero writes.
**Rule:** Compare reviewed provider configuration semantically before claiming drift.
**Enforcement update:** New reordered-provider test; no shared routing changes.
