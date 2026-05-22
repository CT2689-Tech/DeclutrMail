ALTER TABLE "mailbox_accounts" ADD COLUMN "encrypted_refresh_token" "bytea";--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD COLUMN "dek_encrypted" "bytea";--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD COLUMN "key_version" integer;--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD COLUMN "connected_at" timestamp with time zone;