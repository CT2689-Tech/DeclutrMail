-- 0009_followup_tracker.sql
--
-- Followup tracker (D84, D85, D87, D88).
--
-- One row per user-sent thread that has not yet been replied to. The
-- Followups feature surfaces these on the Pro `/followups` screen so
-- the user can chase up high-value outbound correspondence.
-- Direction-of-interest is OUTBOUND — `recipient_email` is who the
-- user is waiting on; `sent_at` is the user's own send time.
--
-- Adds:
--
--   1. `followup_status` enum — closed string union for the three
--      lifecycle states per D87:
--        'awaiting'  — no reply yet; appears in the list
--        'replied'   — the recipient responded; row hidden, kept for audit
--        'dismissed' — user clicked "Mark resolved" per D88; same as
--                       replied for display but distinct provenance
--                       (the `activity_log` row records the source).
--
--   2. `followup_tracker` table — the D87 schema verbatim. `workspace_id`
--      is denormalized from `mailbox_accounts.workspace_id` for future
--      cross-mailbox audit queries without a join. CASCADE on workspace
--      and mailbox deletion so removal is clean.
--
-- Privacy (D7, D228):
--   - `subject` is allowlisted by D7.
--   - `recipient_email` + `recipient_display_name` are metadata (To
--      header on the D7 amended allowlist post-2026-05-22 / ADR-0004).
--   - `provider_thread_id` is Gmail's identifier; metadata only.
--   - NO body content, NO snippet, NO attachments. This migration adds
--     no columns capable of carrying message content.
--
-- Indexing:
--
--   - UNIQUE `(mailbox_account_id, provider_thread_id)` — per D87, the
--     dedup key for `FollowupCheckWorker`'s upsert. One row per thread
--     per mailbox.
--
--   - Partial `(mailbox_account_id, sent_at) WHERE status = 'awaiting'`
--     — covers the hot read path on the Followups screen
--     (`WHERE mailbox_account_id = $1 AND status = 'awaiting' ORDER BY
--     sent_at DESC`). Partial keeps the index footprint bounded by the
--     active awaiting-backlog rather than the full historical record.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (matches the 0008
-- precedent): PGlite (migration round-trip driver) cannot run
-- `CONCURRENTLY` outside an implicit transaction, and the table is
-- brand new with zero rows in any environment. LEARNINGS 2026-05-21
-- applies once a table is populated — not here.
--
-- NO DML — Atlas's `data_depend = error` rule. Rows are inserted by
-- `FollowupCheckWorker` once the worker lands; the migration just
-- creates the empty surface.

CREATE TYPE "public"."followup_status" AS ENUM('awaiting', 'replied', 'dismissed');
--> statement-breakpoint
CREATE TABLE "followup_tracker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"provider_thread_id" text NOT NULL,
	"recipient_email" citext NOT NULL,
	"recipient_display_name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"last_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "followup_status" DEFAULT 'awaiting' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followup_tracker" ADD CONSTRAINT "followup_tracker_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "followup_tracker" ADD CONSTRAINT "followup_tracker_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "followup_tracker_mailbox_thread_uniq" ON "followup_tracker" USING btree ("mailbox_account_id", "provider_thread_id");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "followup_tracker_awaiting_idx" ON "followup_tracker" USING btree ("mailbox_account_id", "sent_at") WHERE "status" = 'awaiting';
