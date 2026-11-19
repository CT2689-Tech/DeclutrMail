### 2026-08-13 — Report refunded vs cancelled subscriptions

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-13.
**Why:** `subscriptions.cancel_source` (`provider` | `refund` | `chargeback`, `packages/db/src/schema/subscriptions.ts:63`) records why a plan ended, but no report reads it. Answering "how many refunded vs just cancelled?" still means opening a SQL client on production.
**How:**
1. Add a read-only report script, modelled on `scripts/launch-funnel-report.ts`, that prints subscription counts by `cancel_source` and `status`. List every enum value even when its count is zero, and never print emails.
2. Test it against real Postgres with one row for each value.
3. Document how the founder runs it against production.
**Verifies by:** The report prints a line each for `provider`, `refund`, `chargeback` and not-ended, zero counts included.
**Who:** Engineering (an agent can do it)
**Status:** Open
