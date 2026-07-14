CREATE TYPE "public"."mailbox_data_deletion_status" AS ENUM('pending', 'executing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "mailbox_data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"status" "mailbox_data_deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "mailbox_data_deletion_requests" ADD CONSTRAINT "mailbox_data_deletion_requests_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_data_deletion_requests_mailbox_active_uniq" ON "mailbox_data_deletion_requests" USING btree ("mailbox_account_id") WHERE "mailbox_data_deletion_requests"."status" IN ('pending', 'executing', 'failed');--> statement-breakpoint
CREATE INDEX "mailbox_data_deletion_requests_status_updated_idx" ON "mailbox_data_deletion_requests" USING btree ("status","updated_at");
