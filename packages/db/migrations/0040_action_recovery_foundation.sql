-- 0040_action_recovery_foundation.sql
--
-- Outcome-aware Activity recovery. A failed Gmail mutation is never replayed
-- blindly: a durable read-only preview first verifies provider state, then a
-- user confirmation creates a NEW action_jobs attempt over the exact frozen
-- target set. Re-applying the full set is provider-idempotent and also repairs
-- the app-side Activity/Undo commit when Gmail already reflects the mutation.
--
-- Idempotency is enforced at three durable boundaries:
--   1. one recovery attempt number per attempt-0 root;
--   2. one direct recovery child per failed predecessor;
--   3. one active (verifying/ready) preview per root action.
--
-- Privacy (D7/D228): target_message_ids and remaining_message_ids contain
-- provider ids only. error_code is a controlled classification, never raw
-- provider text or email content. NO DML — Atlas data_depend remains clean.

CREATE TYPE "public"."action_recovery_preview_status" AS ENUM('verifying', 'ready', 'failed', 'consumed');
--> statement-breakpoint
CREATE TYPE "public"."action_recovery_outcome" AS ENUM('not_applied', 'partial', 'already_applied', 'no_change_needed', 'uncertain', 'reconnect_required', 'blocked');
--> statement-breakpoint

ALTER TABLE "action_jobs" ADD COLUMN "root_action_id" uuid;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD COLUMN "retry_of_action_id" uuid;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD COLUMN "recovery_attempt" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD COLUMN "selection_frozen_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_root_action_id_fk" FOREIGN KEY ("root_action_id") REFERENCES "public"."action_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_retry_of_action_id_fk" FOREIGN KEY ("retry_of_action_id") REFERENCES "public"."action_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_jobs" ADD CONSTRAINT "action_jobs_recovery_lineage_check" CHECK (("recovery_attempt" = 0 AND "root_action_id" IS NULL AND "retry_of_action_id" IS NULL AND "selection_frozen_at" IS NULL) OR ("recovery_attempt" > 0 AND "root_action_id" IS NOT NULL AND "retry_of_action_id" IS NOT NULL AND "selection_frozen_at" IS NOT NULL AND "root_action_id" <> "id" AND "retry_of_action_id" <> "id"));
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "action_jobs_root_recovery_attempt_uniq" ON "action_jobs" ("root_action_id", "recovery_attempt") WHERE "root_action_id" IS NOT NULL;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "action_jobs_retry_of_action_id_uniq" ON "action_jobs" ("retry_of_action_id") WHERE "retry_of_action_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "action_recovery_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"root_action_id" uuid NOT NULL,
	"current_action_id" uuid NOT NULL,
	"status" "action_recovery_preview_status" DEFAULT 'verifying' NOT NULL,
	"outcome" "action_recovery_outcome",
	"target_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"remaining_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"unavailable_count" integer DEFAULT 0 NOT NULL,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"recovery_action_id" uuid,
	"confirmation_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_recovery_previews_selection_counts_check" CHECK ("unavailable_count" >= 0 AND "verified_count" >= 0 AND "verified_count" <= cardinality("target_message_ids") AND cardinality("remaining_message_ids") <= "verified_count" AND "remaining_message_ids" <@ "target_message_ids" AND ("status" NOT IN ('ready', 'consumed') OR "verified_count" = cardinality("target_message_ids"))),
	CONSTRAINT "action_recovery_previews_outcome_shape_check" CHECK ("outcome" IS NULL OR ("outcome" = 'not_applied' AND cardinality("target_message_ids") > 0 AND cardinality("remaining_message_ids") = cardinality("target_message_ids")) OR ("outcome" = 'partial' AND cardinality("remaining_message_ids") > 0 AND cardinality("remaining_message_ids") < cardinality("target_message_ids")) OR ("outcome" IN ('already_applied', 'no_change_needed') AND cardinality("remaining_message_ids") = 0) OR "outcome" IN ('uncertain', 'reconnect_required', 'blocked')),
	CONSTRAINT "action_recovery_previews_status_state_check" CHECK (("status" = 'verifying' AND "outcome" IS NULL AND "error_code" IS NULL AND "verified_at" IS NULL AND "consumed_at" IS NULL AND "recovery_action_id" IS NULL AND "confirmation_fingerprint" IS NULL) OR ("status" = 'ready' AND "outcome" IS NOT NULL AND "outcome" IN ('not_applied', 'partial', 'already_applied') AND "error_code" IS NULL AND "verified_at" IS NOT NULL AND "consumed_at" IS NULL AND "recovery_action_id" IS NULL AND "confirmation_fingerprint" IS NULL) OR ("status" = 'failed' AND "consumed_at" IS NULL AND "recovery_action_id" IS NULL AND "confirmation_fingerprint" IS NULL AND (("outcome" IS NULL AND "error_code" IS NOT NULL) OR ("outcome" IS NOT NULL AND "outcome" IN ('uncertain', 'reconnect_required', 'blocked') AND "verified_at" IS NOT NULL))) OR ("status" = 'consumed' AND "outcome" IS NOT NULL AND "outcome" IN ('not_applied', 'partial', 'already_applied', 'no_change_needed') AND "error_code" IS NULL AND "verified_at" IS NOT NULL AND "consumed_at" IS NOT NULL AND (("outcome" IN ('not_applied', 'partial', 'already_applied') AND "recovery_action_id" IS NOT NULL AND "confirmation_fingerprint" IS NOT NULL) OR ("outcome" = 'no_change_needed' AND "recovery_action_id" IS NULL AND "confirmation_fingerprint" IS NULL)))),
	CONSTRAINT "action_recovery_previews_timestamp_order_check" CHECK ("expires_at" > "created_at" AND "updated_at" >= "created_at" AND ("verified_at" IS NULL OR "verified_at" >= "created_at") AND ("consumed_at" IS NULL OR "consumed_at" >= COALESCE("verified_at", "created_at"))),
	CONSTRAINT "action_recovery_previews_recovery_action_distinct_check" CHECK ("recovery_action_id" IS NULL OR ("recovery_action_id" <> "root_action_id" AND "recovery_action_id" <> "current_action_id"))
);
--> statement-breakpoint
ALTER TABLE "action_recovery_previews" ADD CONSTRAINT "action_recovery_previews_mailbox_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_recovery_previews" ADD CONSTRAINT "action_recovery_previews_root_action_fk" FOREIGN KEY ("root_action_id") REFERENCES "public"."action_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_recovery_previews" ADD CONSTRAINT "action_recovery_previews_current_action_fk" FOREIGN KEY ("current_action_id") REFERENCES "public"."action_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_recovery_previews" ADD CONSTRAINT "action_recovery_previews_recovery_action_fk" FOREIGN KEY ("recovery_action_id") REFERENCES "public"."action_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "action_recovery_previews_mailbox_status_created_idx" ON "action_recovery_previews" ("mailbox_account_id", "status", "created_at");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "action_recovery_previews_root_created_idx" ON "action_recovery_previews" ("root_action_id", "created_at");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "action_recovery_previews_current_action_idx" ON "action_recovery_previews" ("current_action_id");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "action_recovery_previews_active_root_uniq" ON "action_recovery_previews" ("root_action_id") WHERE "status" IN ('verifying', 'ready');
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "action_recovery_previews_active_expires_idx" ON "action_recovery_previews" ("expires_at") WHERE "status" IN ('verifying', 'ready');
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX "action_recovery_previews_recovery_action_uniq" ON "action_recovery_previews" ("recovery_action_id") WHERE "recovery_action_id" IS NOT NULL;
