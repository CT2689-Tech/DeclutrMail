## 2026-09-26 — An absent wire field defaulted to null made the web blind during deploy skew

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** self-review against the deploy order (web ships before the API)
**What happened:** The Brief read a batch's new `undoRevertedAt` / `revertedSenderIds` with `?? null` / `?? []`. From an API that predates them, "field absent" became "not reverted", so a web deploy ahead of the API would have left "Archived ✓" on rows whose mail an Undo had already put back.
**Correct approach:** Treat the field's absence as "this API cannot say" and fall back to the old read (the anchor job).
**Rule:** Never default a missing wire field to the value that means "no"; branch on its absence (Tier 1b: unknown is not no).
**Enforcement update:** Brief test with a legacy batch body, negative-controlled.
