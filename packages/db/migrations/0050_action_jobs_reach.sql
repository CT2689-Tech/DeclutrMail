-- ADR-0028 — persist how far a Delete reaches (inbox-only vs inbox +
-- archived) on the action row, so the worker resolves exactly the set
-- the preview counted. Existing rows were all resolved "currently in
-- INBOX", which the default backfills truthfully.

CREATE TYPE "action_reach" AS ENUM ('inbox_only', 'all_mail');
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD COLUMN "reach" "action_reach" NOT NULL DEFAULT 'inbox_only';
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_reach_verb_check" CHECK ("reach" = 'inbox_only' OR "verb" = 'delete');
