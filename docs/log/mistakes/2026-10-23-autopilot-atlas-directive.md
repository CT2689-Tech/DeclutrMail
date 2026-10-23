## 2026-10-23 — Separate Atlas file directives from SQL

**PR:** Autopilot sender-rule integration (`codex/autopilot-growing-library`).
**Caught by:** Independent migration rehearsal using Atlas against a new disposable PostgreSQL database.
**What happened:** Migration 0097 put SQL immediately after its leading comments. Atlas ignored the file-level transaction directive and rejected CREATE INDEX CONCURRENTLY inside its default transaction. Direct PostgreSQL application did not reveal this release-path failure.
**Correct approach:** Separate the leading Atlas directive/comment block from the first SQL statement with a blank line. Rehash and rehearse the actual pinned Atlas invocation, rollback, and reapply.
**Rule:** Migration validation must exercise the same runner used for release, including file directives.
**Enforcement update:** The existing migration CI and independent rehearsal are retained; no gate was bypassed.
