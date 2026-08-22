-- 0069_autovacuum_hot_table_tuning.sql
--
-- Tighten autovacuum on the four tables the product reads and rewrites
-- constantly. Storage parameters only: no columns, no data, no Gmail
-- fields (D7, D228 unaffected).
--
-- WHY: MEASURED, 2026-08-22, against declutrmail-prod.
--
-- Postgres' default vacuum trigger is `50 + 0.2 * n_live_tup` dead
-- tuples. On these tables that threshold is never reached in normal
-- operation, so autovacuum effectively stops running:
--
--   table              live      dead   default trigger   last autovacuum
--   mail_messages   185,812     5,351            37,212   2026-08-07 (15d)
--   senders          11,422     1,902             2,334   2026-08-21
--   triage_decisions 11,551     2,263             2,360   2026-08-20
--
-- `senders` and `triage_decisions` sit just BELOW their trigger, which
-- is the worst place to be: the churn keeps the dead count high enough
-- to matter and low enough never to fire.
--
-- The cost is not bloat, it is the VISIBILITY MAP. A page that is not
-- marked all-visible cannot be answered from an index alone, so every
-- "Index Only Scan" silently degrades into an index scan plus a random
-- heap fetch per row. Measured all-visible ratios before this change:
-- mail_messages 74.4%, senders 80.5%, triage_decisions 40.4%.
--
-- What that cost in practice, same query, same 50 rows, same plan,
-- production data, ONLY a manual `VACUUM (ANALYZE)` in between:
--
--   select count(*) from mail_messages
--     before:  36,776 heap fetches, 37,684 buffers, 5,300 ms
--     after:        0 heap fetches,  1,011 buffers,   459 ms
--
--   the /api/senders list query (unchanged code)
--     before:  42,666 buffers, 7,526 ms
--     after:   40,745 buffers,   953 ms      <- 7.9x, zero code change
--
-- Buffer COUNT barely moved; the per-buffer cost fell from 176 us to
-- 23 us. That gap is the heap fetches, and it is what a fresh
-- visibility map buys.
--
-- CHOSEN VALUES. 0.05 vacuum + insert scale factors, 0.02 analyze.
--
-- 0.05 rather than the tighter 0.02 deliberately: `mail_messages`
-- grows by bulk INSERT during a mailbox sync, and
-- `autovacuum_vacuum_insert_scale_factor` fires on inserts too. At
-- 0.02 a full 185k-message sync would queue ~50 vacuums of a 137 MB
-- table on a small instance; at 0.05 it queues ~18. The analyze factor
-- is tighter (0.02) because refreshing planner statistics is cheap and
-- stale stats on these tables pick bad join orders.
--
-- `sender_timeseries` is included on the same evidence as `senders`:
-- pg_stat_statements shows its aggregate rebuild UPDATEs at 9,306
-- calls (mean 573 ms) plus 332 calls (mean 2,503 ms), i.e. the same
-- rewrite-the-whole-table churn pattern.
--
-- NOT A FIX FOR THE CHURN ITSELF. This makes the cleanup keep up with
-- the rewrites; it does not reduce them. The worker-side aggregate
-- rebuild is tracked separately.
--
-- LOCKING: `ALTER TABLE ... SET (...)` on storage parameters takes
-- SHARE UPDATE EXCLUSIVE. It does not block SELECT, INSERT, UPDATE or
-- DELETE, so this is safe to apply to a live database and needs no
-- non-transactional file directive.
--
-- THAT SENTENCE NAMES NO DIRECTIVE ON PURPOSE. Atlas scans this leading
-- comment block for its own directives and does not care that a line is
-- prose. An earlier draft of this file explained the point by quoting
-- the directive inside backticks; Atlas matched it anyway and took the
-- REST OF THE LINE as the value, closing backtick and full stop
-- included:
--
--   Error: unknown txmode "none`." found in file directive
--   "0069_autovacuum_hot_table_tuning.sql"
--
-- Migration 0065 hit the same class twice on 2026-08-20. Note where it
-- is caught: `migrate lint` reads content only and passed clean, so the
-- apply-to-throwaway-database step in `.github/workflows/migration-lint.yml`
-- is the only thing standing between this typo and a blocked migration
-- queue. If you reword the paragraph above, do not spell the directive.

ALTER TABLE "mail_messages" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
--> statement-breakpoint
ALTER TABLE "senders" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
--> statement-breakpoint
ALTER TABLE "triage_decisions" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
--> statement-breakpoint
ALTER TABLE "sender_timeseries" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
