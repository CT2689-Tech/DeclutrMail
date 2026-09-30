## 2026-09-25 — Brief read a batch's undo state from its first sender's job

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** reading the Brief's undo query while adding execution-time skips
**What happened:** The Noise archive derived "Undo available" and "archive was undone" from `GET /api/actions/<batchId>`, the anchor job, which is only the first sender's. When that sender had nothing to move (and now, when it is skipped as Protected) the anchor holds no token: the receipt never offered Undo, and an Undo from the pill left "Archived ✓" on rows whose mail was back. The pill's per-sender Undo was never visible to it either.
**Correct approach:** The batch status reports the batch's own `undoExpiresAt`, `undoRevertedAt` (everything back) and `revertedSenderIds`; the Brief reads a batch as a batch and clears each sender's ✓ on its own.
**Rule:** A decision's state is read from the decision, never from whichever member happens to share its id.
**Enforcement update:** API spec for the three fields; Brief tests where the anchor contradicts the batch, negative-controlled.
