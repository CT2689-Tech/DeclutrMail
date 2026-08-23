-- atlas:txmode none
-- 0071_fk_cascade_indexes.sql
--
-- Index every foreign key that a DELETE has to walk. Purely additive:
-- no columns, no data, no drops, no Gmail fields, no query change
-- (D7, D228 unaffected).
--
-- The directive on line 1 is load-bearing and must stay line 1: CREATE
-- INDEX CONCURRENTLY cannot run inside a transaction block, and Atlas
-- only reads directives from the leading comment block. Migrations 0065
-- and 0069 document three ways this fails, including naming the
-- directive in PROSE below this block. Do not write it again.
--
-- ## WHY, MEASURED ON PRODUCTION 2026-08-23
--
-- Postgres does not index a foreign key for you. When a parent row is
-- deleted, every child table with an unindexed FK gets a SEQUENTIAL
-- SCAN, once per deleted parent, to find rows to cascade or null out.
-- Ten FKs in `public` had no covering index:
--
--   rule_match_log.intent_token        -> undo_journal.token   SET NULL
--   followup_tracker.workspace_id      -> workspaces           CASCADE
--   brief_runs.workspace_id            -> workspaces           CASCADE
--   product_feedback.workspace_id      -> workspaces           CASCADE
--   product_feedback.activity_log_id   -> activity_log         CASCADE
--   product_feedback.brief_run_id      -> brief_runs           CASCADE
--   product_feedback.followup_tracker_id -> followup_tracker   CASCADE
--   security_events.workspace_id       -> workspaces           SET NULL
--   security_events.user_id            -> users                SET NULL
--   security_events.reviewed_by_user_id -> users               SET NULL
--
-- Two paths walk these, and both matter:
--
--   1. The UNDO-EXPIRY CRON, which deletes from `undo_journal` on every
--      tick (D35, D58, D232). Each deleted token seq-scans
--      `rule_match_log` -- 1,520 kB of heap holding 0 live rows after
--      6,573 inserts and 6,573 deletes, so the scan is nearly all dead
--      tuples. This one is not hypothetical future load; it runs today.
--
--   2. ACCOUNT DELETION (D205, D216, D232), which deletes a workspace
--      and its users. `security_events` is insert-only and unbounded by
--      design -- 1,623 rows / 392 kB already -- and is scanned THREE
--      times per deleted user/workspace, once per unindexed FK. A
--      deletion has a legal clock on it; it is the wrong place to
--      discover an O(rows x deletions) scan.
--
-- No deletion has run on prod yet (`workspaces.n_tup_del = 0`), which
-- is exactly why this is cheap to fix now and expensive to fix later.
--
-- ## WHY NOTHING IS DROPPED
--
-- Supabase's linter flags 13 "unused" indexes on this database. It is
-- reading a scan counter on a PRELAUNCH database, where almost nothing
-- has run yet, so "never scanned" mostly means "never exercised".
--
-- Twelve of the eighteen zero-scan indexes in `public` ARE FK cascade
-- indexes -- the very thing this migration adds elsewhere. Dropping
-- them would de-index the delete paths. Of the remaining six:
--
--   * `account_deletion_requests_due_scan_idx` -- zero because nobody
--     has requested deletion. It serves the D232 cron.
--   * `subscription_events_pending_idx` -- zero because no payment has
--     been processed. It serves the first real payer.
--   * `undo_journal_account_action_created_idx` -- the table holds ONE
--     row, so the planner would seq-scan it whatever indexes exist. The
--     counter measures the row count, not the index.
--   * `outbox_events_topic_created_idx` -- 104 kB, superseded for the
--     dispatcher by the partial pending index, but still the by-topic
--     path for dead-letter inspection.
--   * the two `security_events` read indexes -- an insert-only audit
--     table; they cost nothing on UPDATE because there are none.
--
-- None of them costs enough to be worth the risk of being wrong about
-- what has simply not run yet. This migration is purely additive.
--
-- ## ROLLBACK
--
-- Fully reversible; see the .rollback file. Every statement is an index
-- build, so a revert changes plan shape only, never a row.

CREATE INDEX CONCURRENTLY "rule_match_log_intent_token_idx"
  ON "rule_match_log" ("intent_token");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "followup_tracker_workspace_id_idx"
  ON "followup_tracker" ("workspace_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "brief_runs_workspace_id_idx"
  ON "brief_runs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "product_feedback_workspace_id_idx"
  ON "product_feedback" ("workspace_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "product_feedback_activity_log_id_idx"
  ON "product_feedback" ("activity_log_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "product_feedback_brief_run_id_idx"
  ON "product_feedback" ("brief_run_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "product_feedback_followup_tracker_id_idx"
  ON "product_feedback" ("followup_tracker_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "security_events_workspace_id_idx"
  ON "security_events" ("workspace_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "security_events_user_id_idx"
  ON "security_events" ("user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "security_events_reviewed_by_user_id_idx"
  ON "security_events" ("reviewed_by_user_id");
