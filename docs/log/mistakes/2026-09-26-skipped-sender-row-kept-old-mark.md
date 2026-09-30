## 2026-09-26 — A skipped sender's row kept an older job's "Archive failed"

**PR:** pending (branch `fix/d245-protected-recheck-at-execution`)
**Caught by:** manual test — scratch-DB smoke (a batch failed, then the next batch skipped one sender as Protected)
**What happened:** The Senders terminal effects left a Protected-skipped sender "unmarked" by not writing a new mark. The row still held the previous batch's "Archive failed", so after the skip it claimed that outcome for the latest click. Sender Detail was immune only because it clears its mark at dispatch.
**Correct approach:** On a skip, clear the sender's existing mark (single and batch, active and parked).
**Rule:** "Leave it unmarked" means clear the mark, not skip the write — state that outlives one job must be reset by the next one.
**Enforcement update:** two Senders tests (batch and single twin), each negative-controlled; verified live on the scratch DB.
