-- 0015_action_jobs.sql
--
-- D226 — async destructive-action pipeline (verb = archive).
--
-- Adds:
--   1. `action_verb` enum — the label-modify verbs the pipeline can
--      apply ('archive' now; extend per verb).
--   2. `action_direction` enum — 'forward' (apply) vs 'reverse' (undo);
--      undo is modeled as its own action_jobs row so it reuses the
--      status lifecycle.
--   3. `action_job_status` enum — queued | executing | done | failed
--      (the FE polls this).
--   4. `action_jobs` table — one row per action. `resolved_message_ids`
--      is the DURABLE execution set (persisted before the Gmail mutation
--      so a post-mutation retry reuses it). `idempotency_key` is the
--      client `Idempotency-Key` (UNIQUE). `undo_token` FKs the issued
--      (forward) / reverted (reverse) journal token.
--
-- Privacy (D7, D228):
--   - `selector` jsonb + `resolved_message_ids[]` carry ONLY Gmail
--     identifiers (message ids, the sha256 sender_key) — never body,
--     snippet, subject, or any header. No new headers, snippets, MIME.
--
-- Indexing notes:
--   - `action_jobs_idempotency_key_uniq` — the durable idempotency
--     backstop (the BullMQ jobId is the first layer).
--   - `(mailbox_account_id, status, created_at)` — poll-by-mailbox + ops.
--   - `(undo_token)` — symmetric with `activity_log_undo_token_idx`.
--   - The hot INBOX-filter resolve query
--     (`WHERE mailbox_account_id = ? AND sender_key = ? AND
--      'INBOX' = ANY(label_ids)`) is served by the EXISTING
--     `mail_messages_account_sender_date_idx` prefix — no new index here.
--   - `selector` jsonb is intentionally unindexed (we never query by its
--     contents; the worker re-resolves from `mail_messages`).
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY`, matching the 0007
-- precedent: PGlite (the migration round-trip test driver) cannot run
-- CONCURRENTLY outside an implicit transaction, and `action_jobs` is
-- brand new (zero rows in any environment). The `atlas:nolint
-- concurrent_index` directives tell Atlas migration lint this is
-- deliberate. NO DML — Atlas `data_depend = error`.

CREATE TYPE "public"."action_direction" AS ENUM('forward', 'reverse');--> statement-breakpoint
CREATE TYPE "public"."action_job_status" AS ENUM('queued', 'executing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."action_verb" AS ENUM('archive');--> statement-breakpoint
CREATE TABLE "action_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"verb" "action_verb" NOT NULL,
	"direction" "action_direction" DEFAULT 'forward' NOT NULL,
	"selector" jsonb NOT NULL,
	"resolved_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"status" "action_job_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"undo_token" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_undo_token_undo_journal_token_fk" FOREIGN KEY ("undo_token") REFERENCES "public"."undo_journal"("token") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "action_jobs_idempotency_key_uniq" ON "action_jobs" USING btree ("idempotency_key");--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "action_jobs_account_status_created_idx" ON "action_jobs" USING btree ("mailbox_account_id","status","created_at");--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "action_jobs_undo_token_idx" ON "action_jobs" USING btree ("undo_token");
