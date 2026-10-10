ALTER TABLE "provider_sync_state" ADD COLUMN "initial_recovery_attempts" smallint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "provider_sync_state" ADD COLUMN "initial_retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "provider_sync_state" ADD COLUMN "initial_attempt_id" uuid;
