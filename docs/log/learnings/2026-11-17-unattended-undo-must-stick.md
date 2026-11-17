## 2026-11-17 — An unattended rule re-does what Undo just undid

**Context:** Letting Autopilot Archive rules run Active (founder decision 3A). The smoke archived 44 real inbox emails through an Active custom rule, then undid the run from Activity.

**Finding:**
- Every unit test passed, and Undo restored the mail correctly.
- The rule stayed Active, though. The next sweep re-matched the sender because its inbox count was above zero again, and archived the same 44 emails.
- An eight-minute watcher saw nothing happen. That proved nothing: the five-minute drift sync does not trigger Autopilot, so no sweep ran. Forcing a sweep reproduced the re-archive at once.
- The fix uses `activity_log.reverted_at`, which records that a run was undone and survives undo-journal pruning. An unattended run never re-moves mail that was already in the inbox when an undone run of the same rule happened.

**Rule (provisional):**
- Any background producer that repeats a user-reversible action must treat a user's undo as a standing "no" for that exact mail. Otherwise Undo works in tests and means nothing in use.
- Before trusting a quiet watcher, confirm the trigger it waits on actually fires. Starve-test the watcher.

**Distillation trigger:** promote to CLAUDE.md §2.6 if a second producer (Quiet release, Brief actions, Screener) shows the same re-do-after-undo shape.
