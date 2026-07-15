ALTER TABLE "sender_policies" ADD COLUMN "snooze_wake_last_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snooze_wake_last_failed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snooze_wake_failure_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snooze_wake_failure_kind" text;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD CONSTRAINT "sender_policies_snooze_wake_failure_count_check" CHECK ("snooze_wake_failure_count" >= 0);
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD CONSTRAINT "sender_policies_snooze_wake_failure_kind_check" CHECK ("snooze_wake_failure_kind" IS NULL OR "snooze_wake_failure_kind" IN ('temporary', 'reauthorize', 'needs_attention'));
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD CONSTRAINT "sender_policies_snooze_wake_failure_state_check" CHECK (("snooze_wake_failure_count" = 0 AND "snooze_wake_last_failed_at" IS NULL AND "snooze_wake_failure_kind" IS NULL) OR ("snooze_wake_failure_count" > 0 AND "snooze_wake_last_attempt_at" IS NOT NULL AND "snooze_wake_last_failed_at" IS NOT NULL AND "snooze_wake_failure_kind" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD CONSTRAINT "sender_policies_snooze_wake_cleared_state_check" CHECK ("snoozed_until" IS NOT NULL OR ("snooze_wake_last_attempt_at" IS NULL AND "snooze_wake_last_failed_at" IS NULL AND "snooze_wake_failure_count" = 0 AND "snooze_wake_failure_kind" IS NULL));
