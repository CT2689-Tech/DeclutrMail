-- 0003_sync_data_capture.sql
--
-- D7 allowlist extension + sender-level unsubscribe summary (D9) +
-- outbound-message tagging for the future Sent-sync / reply attribution
-- work. Schema additions only — additive and reversible.
--
-- Touches:
--   - `mail_messages` — gains `is_outbound`, `recipient_emails`,
--     `unsubscribe_url`, `unsubscribe_one_click`. All nullable or
--     defaulted so the migration is non-blocking on existing data.
--   - `senders` — gains `unsubscribe_method` (new enum) +
--     `unsubscribe_url`. Both nullable — `building_sender_index`
--     populates them.
--
-- The forward backfills `is_outbound` from `label_ids` for any rows
-- already stored — so a dev DB carrying pre-amendment SENT messages
-- self-corrects without a re-sync.

CREATE TYPE "public"."gmail_unsubscribe_method" AS ENUM('one_click', 'mailto', 'none');
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "is_outbound" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "recipient_emails" text[];
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "unsubscribe_url" text;
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "unsubscribe_one_click" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "unsubscribe_method" "gmail_unsubscribe_method";
--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "unsubscribe_url" text;
--> statement-breakpoint
UPDATE "mail_messages" SET "is_outbound" = true WHERE 'SENT' = ANY("label_ids");
