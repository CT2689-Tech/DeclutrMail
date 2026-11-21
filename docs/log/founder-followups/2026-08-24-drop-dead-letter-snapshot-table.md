### 2026-08-24 — Drop the dead-letter snapshot table in production

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-24.
**Why:** On 2026-08-24, 781 dead-letter rows were copied to `dead_letter_jobs_snapshot_20260824` before being deleted. Our data inventory promises that `dead_letter_jobs` rows are removed when an inbox's data or the account is deleted (`packages/shared/src/contracts/gmail-data-inventory.ts:480-484`). No code knows this copy exists, so rows belonging to a deleted account outlive that promise.
**How:**
1. Supabase → production project → SQL Editor.
2. Run `select to_regclass('public.dead_letter_jobs_snapshot_20260824');`. If it returns null, the table is already gone; mark this entry Done.
3. Otherwise run `DROP TABLE dead_letter_jobs_snapshot_20260824;`
**Verifies by:** The query in step 2 returns null.
**Who:** Founder
**Status:** Open
