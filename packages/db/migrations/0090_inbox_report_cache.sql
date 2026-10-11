-- Cached Inbox Report aggregates. Counts and sender ids only.
-- Purged with mailbox indexed data; the mailbox FK also cascades.

CREATE TABLE "inbox_report_cache" (
  "mailbox_account_id" uuid PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "source_sync_run_id" uuid,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_report_cache" ADD CONSTRAINT "inbox_report_cache_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_report_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "mail_messages_account_sender_inbound_size_idx" ON "mail_messages" USING btree ("mailbox_account_id","sender_key","size_bytes") WHERE "is_outbound" = false;
