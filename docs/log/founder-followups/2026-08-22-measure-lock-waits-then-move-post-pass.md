### 2026-08-22 — Measure mailbox-lock waits, then move the post-pass out of the lock

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-22.
**Why:** A user's Delete waits behind incremental sync for the same mailbox. Gmail reads already run outside the lock (#625), but the wrote-to attribution and auto-protect post-pass still runs inside it. The lock pool is now 3 connections, capped by the session pooler's 15 clients (`worker.ts`), so waits may be worse than in August. Founder decision 2026-08-26: do the narrowing after launch.
**How:**
1. After launch, read seven days of `mailbox_lock.pool_wait` lines and the `pg_advisory_lock` mean in `pg_stat_statements`.
2. If waits are rare and short, close this as Skipped with the numbers.
3. Otherwise move the post-pass after the lock in `incremental-sync.worker.ts`, with an adversarial review (CLAUDE.md §8.2), and smoke two rapid Gmail pushes on one dev mailbox.
**Verifies by:** The `pg_advisory_lock` mean falls to under a second at similar call volume.
**Who:** Engineering (an agent can do it)
**Status:** Open
