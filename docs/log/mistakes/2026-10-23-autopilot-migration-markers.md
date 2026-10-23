## 2026-10-23 — Separate migration statements for the test runner

**PR:** Autopilot sender-rule integration (`codex/autopilot-growing-library`).
**Caught by:** Local database tests.
**What happened:** The first sender-rule migration omitted statement-breakpoint markers. PostgreSQL accepted the SQL, but the PGlite prepared-query migration runner rejected multiple statements before tests could run.
**Correct approach:** Follow existing migration statement boundaries and run the database suite before distributing a schema dependency.
**Rule:** Separate every migration statement with the repository's statement-breakpoint marker.
**Enforcement update:** None; the existing database tests caught the error before release.
