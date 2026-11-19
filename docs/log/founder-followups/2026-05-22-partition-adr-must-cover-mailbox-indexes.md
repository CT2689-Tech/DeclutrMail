### 2026-05-22 — Cover the mailbox index family in the partitioning ADR

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-05-22.
**Why:** `mail_messages` stays unpartitioned until a D235 trigger fires (25M rows, 2M rows in one mailbox, or p95 sender-detail latency over 150 ms for 7 days). Its unique and composite indexes all lead with `mailbox_account_id`, which already points the choice toward hash partitioning on that column. A different key would mean re-justifying or rebuilding those indexes.
**How:**
1. Nothing to do until a D235 trigger fires.
2. When one fires, the partitioning ADR's "alternatives considered" section addresses the `(mailbox_account_id, …)` indexes in `packages/db/src/schema/mail-messages.ts`, including the provider-message unique index used for push dedup.
**Verifies by:** The partitioning ADR names that index family and explains the key chosen.
**Who:** Engineering (an agent can do it)
**Status:** Open
