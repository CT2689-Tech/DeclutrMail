-- 0003_sync_data_capture.sql
--
-- D7 allowlist extension + sender-level unsubscribe summary (D9) +
-- outbound-message tagging for the future Sent-sync / reply attribution
-- work. Schema additions only — purely additive and reversible.
--
-- Touches:
--   - `mail_messages` — gains `is_outbound`, `recipient_emails`,
--     `unsubscribe_url`, `unsubscribe_one_click`. All nullable or
--     defaulted so the migration is non-blocking on existing data.
--   - `senders` — gains `unsubscribe_method` (new enum) +
--     `unsubscribe_url`. Both nullable — `building_sender_index`
--     populates them.
--
-- NO DML in this migration (Atlas's `data_depend = error` rule). Any
-- dev-DB rows written by pre-amendment syncs keep their default
-- `is_outbound = false`. To clean those up, `dev-api.sh --reset` is
-- the supported path; the next sync writes correct flags. Prod has no
-- pre-amendment data (no deploy yet — ADR-0002).

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
