-- 0044_activity_outcome_provenance.sql
--
-- D246 — Activity review evidence needs durable execution and reversal facts.
-- Undo journals expire and zero-message actions issue no token, so neither
-- recovery nor reversal classification may depend on that token alone.

ALTER TABLE "activity_log" ADD COLUMN "action_job_id" uuid;
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "reverted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "activity_log" AS activity
SET "reverted_at" = undo."reverted_at"
FROM "undo_journal" AS undo
WHERE activity."undo_token" = undo."token"
  AND undo."reverted_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "activity_log"
ADD CONSTRAINT "activity_log_action_job_id_action_jobs_id_fk"
FOREIGN KEY ("action_job_id") REFERENCES "public"."action_jobs"("id")
ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "activity_log_action_job_idx" ON "activity_log" USING btree ("action_job_id");
