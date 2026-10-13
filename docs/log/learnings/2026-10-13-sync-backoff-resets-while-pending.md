## 2026-10-13 — Sync poll backoff resets while the retry is in flight

**Context:** `useSyncStatus` exponential backoff keyed off TanStack `errorUpdateCount`.

**Finding:** A failed status read has no cached `data`. The next fetch sets `status` back to `pending` and clears `error` until it settles (`fetchState` in `@tanstack/query-core`). Treating "not an error" as success deleted the backoff step, so every poll stayed at 10s.

**Rule (provisional):** While `status === 'pending'` after a failure, keep the current step. Reset only on `success`.

**Distillation trigger:** promote to CLAUDE.md §8 if pattern recurs ≥3 times
