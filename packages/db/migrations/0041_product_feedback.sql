-- 0041_product_feedback.sql
--
-- D246 first-party feedback for concrete Activity, Brief, and Followup rows.
-- The closed surface/rating vocabularies and typed target foreign keys keep the
-- data useful for product diagnosis without accepting prose, sender addresses,
-- subjects, or message content. Exactly one target must match the selected
-- surface, and each surface accepts only its documented ratings.
--
-- Three user+target partial unique indexes make a repeated submission
-- idempotent without preventing another user in a future shared workspace from
-- rating the same target. RLS is enabled with no policies, preserving the
-- app-server-only access model established by migration 0026.

CREATE TYPE "public"."product_feedback_surface" AS ENUM('activity', 'brief', 'followups');
--> statement-breakpoint
CREATE TYPE "public"."product_feedback_rating" AS ENUM('expected', 'surprising', 'useful', 'not_useful', 'wrong_reason', 'not_followup');
--> statement-breakpoint
CREATE TABLE "product_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"surface" "product_feedback_surface" NOT NULL,
	"rating" "product_feedback_rating" NOT NULL,
	"activity_log_id" uuid,
	"brief_run_id" uuid,
	"followup_tracker_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_feedback_surface_target_rating_check" CHECK (("surface" = 'activity' AND "activity_log_id" IS NOT NULL AND "brief_run_id" IS NULL AND "followup_tracker_id" IS NULL AND "rating" IN ('expected', 'surprising')) OR ("surface" = 'brief' AND "activity_log_id" IS NULL AND "brief_run_id" IS NOT NULL AND "followup_tracker_id" IS NULL AND "rating" IN ('useful', 'not_useful', 'wrong_reason')) OR ("surface" = 'followups' AND "activity_log_id" IS NULL AND "brief_run_id" IS NULL AND "followup_tracker_id" IS NOT NULL AND "rating" IN ('useful', 'not_followup')))
);
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_activity_log_id_activity_log_id_fk" FOREIGN KEY ("activity_log_id") REFERENCES "public"."activity_log"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_brief_run_id_brief_runs_id_fk" FOREIGN KEY ("brief_run_id") REFERENCES "public"."brief_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_followup_tracker_id_followup_tracker_id_fk" FOREIGN KEY ("followup_tracker_id") REFERENCES "public"."followup_tracker"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER "product_feedback_set_updated_at" BEFORE UPDATE ON "product_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "product_feedback_user_activity_uniq" ON "product_feedback" USING btree ("user_id", "activity_log_id") WHERE "surface" = 'activity';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "product_feedback_user_brief_uniq" ON "product_feedback" USING btree ("user_id", "brief_run_id") WHERE "surface" = 'brief';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "product_feedback_user_followup_uniq" ON "product_feedback" USING btree ("user_id", "followup_tracker_id") WHERE "surface" = 'followups';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "product_feedback_mailbox_surface_created_idx" ON "product_feedback" USING btree ("mailbox_account_id", "surface", "created_at");
--> statement-breakpoint
ALTER TABLE "product_feedback" ENABLE ROW LEVEL SECURITY;
