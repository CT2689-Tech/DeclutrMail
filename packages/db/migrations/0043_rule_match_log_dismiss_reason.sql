-- 0043_rule_match_log_dismiss_reason.sql
--
-- D246 — weekly review must distinguish a suggestion the user dismissed
-- from a match skipped because the sender became Protected before execution.
-- Keep the vocabulary closed so aggregate review counts cannot drift.

CREATE TYPE "public"."autopilot_match_dismiss_reason" AS ENUM('user', 'protected');
--> statement-breakpoint
ALTER TABLE "rule_match_log" ADD COLUMN "dismiss_reason" "autopilot_match_dismiss_reason";
--> statement-breakpoint
UPDATE "rule_match_log"
SET "dismiss_reason" = 'user'
WHERE "resolution" = 'dismissed';
--> statement-breakpoint
ALTER TABLE "rule_match_log"
ADD CONSTRAINT "rule_match_log_dismiss_reason_check"
CHECK (("resolution" = 'dismissed') = ("dismiss_reason" IS NOT NULL));
