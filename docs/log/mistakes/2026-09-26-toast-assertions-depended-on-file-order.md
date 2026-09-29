## 2026-09-26 — Toast assertions passed or failed by test file order

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** full-file runs after adding tests
**What happened:** The shared toast store outlives a test, so `getByText(<toast>)` found a toast an earlier test left and threw "multiple elements", and `queryByText(...) === null` failed on an earlier test's toast. Tests that passed alone failed in the full file, and an existing test broke only because new tests now ran before it.
**Correct approach:** Count before and after (`queryAllByText(...).length` then `before + 1`), as `senders-screen.test.tsx` already did for Keep.
**Rule:** Assert on a toast by the change in its count, never by presence or absence.
**Enforcement update:** the three parked Brief tests and the Senders refusal tests.
