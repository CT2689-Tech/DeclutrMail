-- Per-run sync history (F002, 2026-08-06).
--
-- `provider_sync_state` holds one row per mailbox and is overwritten by
-- every run, so "what is this mailbox doing now?" is answerable and
-- nothing else is: not how long the last sync took, not which stage was
-- slow, not how many messages Gmail refused, not whether sync is
-- getting slower for an account. The 2026-08-06 incident needed a prod
-- DB query to diagnose precisely because that history does not exist.
--
-- First-party rather than PostHog on purpose. Analytics consent (D147)
-- is per-browser localStorage that no worker can read, and we publish
-- that PostHog runs only after a user accepts it — so a server-side
-- emitter cannot exist without contradicting a published page. A row
-- insert is also exactly-once and durable where a fire-and-forget event
-- is neither, and it loses hardest exactly when a sync failed.
--
-- One row per FINISHED run, written at the terminal disposition. No
-- 'running' status: a start-then-update row needs a run identity that
-- survives BullMQ retries, and every candidate mis-keys a retry or
-- strands an orphan the next run adopts. The success insert rides
-- markReady's transaction, so the row commits iff the sync did.
--
-- Metric columns are NULLABLE by design. NULL = not measured (a failed
-- run returns no partial counts); 0 = measured zero. Writing 0 on
-- failure would assert a mailbox synced nothing, which is usually
-- false.
--
-- Privacy (D7): counts, timings and a worker error class name only.
CREATE TYPE "sync_run_status" AS ENUM (
  'succeeded',
  'failed',
  'skipped_deletion_pending',
  'skipped_already_ready'
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mailbox_account_id" uuid NOT NULL REFERENCES "mailbox_accounts"("id") ON DELETE CASCADE,
  "status" "sync_run_status" NOT NULL,
  "attempts" smallint DEFAULT 1 NOT NULL,
  "finished_at" timestamptz DEFAULT now() NOT NULL,
  "duration_ms" integer,
  "messages_synced" integer,
  "unreadable" integer,
  "senders_indexed" integer,
  "gmail_api_calls" integer,
  "stage_timings" jsonb,
  "error_code" text
);
--> statement-breakpoint
-- "Last N runs for this mailbox" — every read this table exists for.
CREATE INDEX "sync_runs_mailbox_finished_idx"
  ON "sync_runs" ("mailbox_account_id", "finished_at" DESC);
--> statement-breakpoint
-- Every public table keeps the deny-by-default boundary (0049). No
-- policy is granted: the API and workers connect as the table owner,
-- and nothing else should read this at all.
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
