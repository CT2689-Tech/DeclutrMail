### 2026-05-22 — Evict a deleted mailbox's Gmail limiter from the worker cache

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-05-22.
**Why:** `apps/api/src/worker.ts:574` keeps one Gmail quota limiter per mailbox in a `Map` for the life of the worker process and never removes an entry. Account deletion now runs (`packages/workers/src/deletion.worker.ts`), but the `mailbox.deleted` event meant to drive eviction (`packages/events/src/topics.ts:132`) is never emitted or consumed. Low impact: each entry is bounded, the quota budget itself lives in Redis, and every deploy restarts the worker.
**How:**
1. Pick the smaller fix: drop entries idle longer than the quota window (this also covers disconnected mailboxes), or emit `mailbox.deleted` from the deletion worker through the outbox and evict on it.
2. If the event stays unused after step 1, delete the topic and its schema (D245: no contracts kept for later).
3. Add a test that deletes or idles a mailbox and checks its entry is gone.
**Verifies by:** the test in step 3 goes red with the fix reverted and green with it.
**Who:** Engineering (an agent can do it)
**Status:** Open
