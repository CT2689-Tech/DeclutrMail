### 2026-05-22 — Audit the indexes on mail_messages before launch

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-05-22.
**Why:** `mail_messages` is the busiest table during sync, and it now carries 11 secondary indexes plus the primary key (`packages/db/src/schema/mail-messages.ts:163-255`), up from 5 when this was first flagged. Every stored message writes to all of them, and nothing shows which ones production queries actually use. Partitioning (D235) will fix this layout in place, so the review should happen first.
**How:**
1. Ask the founder to run this read-only query on production and share the output: `select indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) from pg_stat_user_indexes where relname = 'mail_messages' order by idx_scan;`
2. For each rarely used index, find the query it serves (see its schema comment) and run `EXPLAIN ANALYZE` without it on a local database with realistic volume.
3. Write a short note giving each index a keep or drop reason. Ship any drop as a new migration, which the founder approves (production migration).
**Verifies by:** The note lists every index with its scans, size and decision, and any drop has shipped as a new migration.
**Who:** Engineering (an agent can do it)
**Status:** Open
