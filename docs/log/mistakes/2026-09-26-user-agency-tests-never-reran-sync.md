## 2026-09-26 — Three user-agency tests re-ran the initial sync without resetting it, so the re-run never happened
**PR:** #786 (https://github.com/CT2689-Tech/DeclutrMail/pull/786)
**Caught by:** manual audit while updating initial-sync tests for #786
**What happened:** `user-agency-wins` (×2) and `idempotent — second run preserves automatic provenance` call `processJob` twice. After run 1 the mailbox is `ready`, and the 2026-07-10 duplicate guard returns `alreadyReady` on run 2 without touching anything, so "the manual Unprotect survives a re-run" was asserted against a run that did nothing. Verified: with the auto-protect upsert's `protection_reason IS NULL` guard deleted (and, separately, with `user_defined` added to the demote list) the original tests stayed green. The file's own `resetToQueued` helper documents the trap.
**Correct approach:** Reset the gate off `ready` before any intended re-run, as `SyncService.markQueued` does in production.
**Rule:** A test that runs a job twice must make the second run do work (or assert that it did) — a no-op second run passes every "still true after a re-run" assertion.
**Enforcement update:** the three tests now call `resetToQueued`; each goes red with its guard removed. The other two-run tests in the file already reset, or test the no-op on purpose.
