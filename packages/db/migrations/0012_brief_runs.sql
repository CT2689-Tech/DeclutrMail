-- 0012_brief_runs.sql
--
-- Brief runs (D61, D62, D63, D67, D69, D70).
--
-- One row per (mailbox, local-date). The Brief is a static 8am
-- snapshot of yesterday's email, frozen at generation per D69 — user
-- actions throughout the day mark rows as Done in the UI but never
-- mutate `brief_payload`.
--
-- Adds:
--
--   1. `brief_generated_by` enum — `'llm_haiku' | 'template'`.
--      Records which D62 path produced the narrative + section copy:
--        - `llm_haiku` — Haiku 4.5 call landed
--        - `template` — deterministic template fallback ran (LLM
--                       timed out, failed, or no API key)
--
--   2. `brief_runs` table — D61 schema verbatim:
--        - `workspace_id` (denormalized for cross-mailbox audit;
--          same pattern as `followup_tracker`)
--        - `mailbox_account_id`
--        - `run_date_local` (date, not timestamptz — the Brief is
--          identified by its local-date label, e.g. "the 2026-05-25
--          Brief", regardless of timezone)
--        - `generated_by` (the enum above)
--        - `brief_payload` (jsonb — the 3 D63 sections + narrative)
--        - `generated_at` (when the snapshot fired)
--        - `opened_at` (first in-app view; null until viewed)
--        - `email_sent_at` (D61 optional email channel; null when
--          not opted in or not yet delivered)
--
-- Indexing:
--
--   - UNIQUE `(mailbox_account_id, run_date_local)` — D69 invariant.
--     Worker upserts on this key; read service looks up "today's
--     brief" by `(mailbox, today_local)`.
--
--   - `(mailbox_account_id, run_date_local)` non-unique mirror — the
--     unique index serves the predicate; a dedicated composite
--     documents the "list past N briefs" access pattern (the DESC
--     ordering is the consumer's responsibility on read).
--
-- Privacy (D7, D228):
--   - `brief_payload` carries sender identity, subject, Gmail message
--     ids, and the D62 narrative copy. The narrative is composed from
--     sender + subject + Gmail `snippet` only — all allowlisted.
--   - NO body content, NO attachments, NO non-allowlisted headers.
--     The worker's prompt builder enforces this at write time; the
--     schema doesn't carry any field capable of storing forbidden
--     content.
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (matches the 0010
-- precedent): PGlite (migration round-trip driver) cannot run
-- `CONCURRENTLY` outside an implicit transaction, and the table is
-- brand new with zero rows in any environment.
--
-- NO DML — Atlas's `data_depend = error` rule. Rows are inserted by
-- the (future) `BriefSnapshotWorker`; the migration creates the empty
-- surface only.

CREATE TYPE "public"."brief_generated_by" AS ENUM('llm_haiku', 'template');
--> statement-breakpoint
CREATE TABLE "brief_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"run_date_local" date NOT NULL,
	"generated_by" "brief_generated_by" NOT NULL,
	"brief_payload" jsonb DEFAULT '{"reply":[],"fyi":[],"noise":[],"narrative":""}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_runs" ADD CONSTRAINT "brief_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "brief_runs" ADD CONSTRAINT "brief_runs_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "brief_runs_mailbox_date_uniq" ON "brief_runs" USING btree ("mailbox_account_id", "run_date_local");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "brief_runs_mailbox_date_desc_idx" ON "brief_runs" USING btree ("mailbox_account_id", "run_date_local");
