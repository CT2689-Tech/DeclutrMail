### 2026-06-05 — Check whether the five PGlite hook-timeout flakes still happen

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-05.
**Why:** In June, five API specs (Brief, Actions sender selector, Autopilot rules, Followups awaiting, Gmail webhook) failed now and then with `Hook timed out in 30000ms`. A flaky test trains people to re-run red CI. `hookTimeout` is still 30 s, and tests now run on weighted shards, so the flakes may be gone.
**How:**
1. Verify first: run those five spec files three times with `pnpm --filter @declutrmail/api exec vitest run <files>`.
2. If none times out, close this as Skipped with the run results.
3. If any does, find the slow setup step, or raise `hookTimeout` to 60_000 in `apps/api/vitest.config.ts`.
**Verifies by:** Three runs in a row pass with no hook timeout.
**Who:** Engineering (an agent can do it)
**Status:** Open
