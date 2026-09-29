## 2026-09-26 — A guard meant to stop the scan bar climbing under "Waiting to start." froze it there
**PR:** TBD (feat/d109-sync-gate-progress-count)
**Caught by:** architecture-guardian, round 2
**What happened:** To keep a reconnect's reset row from showing a climbing bar, `updateProgress` gained `WHERE current_stage = 'fetching_metadata'`. But a sign-in or connect mid-scan resets the row to `queued` (clearing its cursor) and starts no new attempt — `ensureInitialSyncJob` is a no-op for an active job — so nothing ever took the row back until the read ended. The gate sat on "Waiting to start." at 0%, with no count, for the rest of a read that can take hours; a read past 2h would also raise a false `sync_stalled`. A test pinned the frozen state as intended.
**Correct approach:** The running read takes a `queued` row back at its next count — stage, readiness and its snapshot cursor (COALESCE) — and leaves any other state (ready, failed) alone.
**Rule:** Before guarding a write on a state another writer can reset, name who takes the state over after the reset; if nobody does, the guard strands it — take it back instead.
**Enforcement update:** worker tests (negative-controlled): the take-back with its cursor, and a failed row left failed.
