### 2026-08-16 — Check production for undos that failed in the 12–16 Aug outage

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-16.
**Why:** From the #509 deploy (2026-08-12) until the #538 fix, every label action in production failed before it touched Gmail. A failed forward action changed nothing and stays failed by design (D233). A failed undo is different: the original action ran, so that mail may still be archived, snoozed or deleted after the user asked for it back. Undo windows are at most 30 days (`pricing.config.ts`), so only a manual fix is left.
**How:**
1. Supabase SQL editor, production, read-only: `SELECT id, verb, direction, requested_count, created_at FROM action_jobs WHERE status = 'failed' AND error_code = 'PostgresError' AND affected_count = 0 AND undo_token IS NULL AND created_at >= '2026-08-12' AND created_at < '2026-08-18' ORDER BY direction, created_at;`
2. Leave `forward` rows alone.
3. For each `reverse` row, decide by hand whether to restore that mail in Gmail. Never batch-retry.
**Verifies by:** every `reverse` row has a written decision here, or the query returns none.
**Who:** Founder
**Status:** Open
