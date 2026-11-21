### 2026-07-08 — Build Quiet "Release now" and Screener bulk decide, if still wanted

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-07-08.
**Why:** Both were started in #298 and taken out unfinished rather than shipped as stubs. Today a user whose Quiet window is holding Autopilot actions can only wait for the window to end, and the Screener decides one sender at a time.
**How:**
1. Verify first that both are still in scope (D96 is ⬜ in `IMPLEMENTATION-LOG.md`).
2. Release now: `POST /api/mailboxes/:id/quiet-hours/release` ends the current window, then enqueues the autopilot-action sweep after the transaction commits; add a Postgres-backed spec and a button on the Quiet card.
3. Bulk decide: one endpoint and contract for several senders (or every sender from one domain), behind the D226 preview, with Protected senders left out.
**Verifies by:** a release is followed by a `worker.succeeded` autopilot-action log line; one bulk decide acts on every chosen sender after a single preview.
**Who:** Engineering (an agent can do it)
**Status:** Open
