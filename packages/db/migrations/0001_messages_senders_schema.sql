CREATE TYPE "public"."activity_action" AS ENUM('keep', 'archive', 'unsubscribe', 'later');--> statement-breakpoint
CREATE TYPE "public"."activity_source" AS ENUM('triage', 'manual', 'autopilot', 'screener');--> statement-breakpoint
CREATE TYPE "public"."sync_readiness" AS ENUM('queued', 'syncing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_stage" AS ENUM('queued', 'fetching_metadata', 'building_sender_index', 'computing_recommendations', 'finalizing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sender_policy_type" AS ENUM('keep', 'archive', 'unsubscribe', 'later');--> statement-breakpoint
CREATE TYPE "public"."gmail_category" AS ENUM('primary', 'promotions', 'social', 'updates', 'forums');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "activity_source" NOT NULL,
	"action" "activity_action" NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text NOT NULL,
	"sender_key" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"internal_date" timestamp with time zone NOT NULL,
	"label_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_unread" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"readiness_status" "sync_readiness" DEFAULT 'queued' NOT NULL,
	"current_stage" "sync_stage" DEFAULT 'queued' NOT NULL,
	"progress_pct" smallint DEFAULT 0 NOT NULL,
	"last_history_id" bigint,
	"error_code" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"policy_type" "sender_policy_type" DEFAULT 'keep' NOT NULL,
	"is_vip" boolean DEFAULT false NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_timeseries" (
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"year_month" date NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"read_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_timeseries_mailbox_account_id_sender_key_year_month_pk" PRIMARY KEY("mailbox_account_id","sender_key","year_month")
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" "citext" NOT NULL,
	"domain" text NOT NULL,
	"gmail_category" "gmail_category" NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_state" ADD CONSTRAINT "provider_sync_state_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_policies" ADD CONSTRAINT "sender_policies_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_timeseries" ADD CONSTRAINT "sender_timeseries_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_account_sender_occurred_idx" ON "activity_log" USING btree ("mailbox_account_id","sender_key","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_provider_message_uniq" ON "mail_messages" USING btree ("mailbox_account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "mail_messages_account_sender_date_idx" ON "mail_messages" USING btree ("mailbox_account_id","sender_key","internal_date");--> statement-breakpoint
CREATE INDEX "mail_messages_account_date_idx" ON "mail_messages" USING btree ("mailbox_account_id","internal_date");--> statement-breakpoint
CREATE INDEX "mail_messages_account_sender_unread_idx" ON "mail_messages" USING btree ("mailbox_account_id","sender_key") WHERE "mail_messages"."is_unread" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_state_mailbox_account_uniq" ON "provider_sync_state" USING btree ("mailbox_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_policies_account_sender_key_uniq" ON "sender_policies" USING btree ("mailbox_account_id","sender_key");--> statement-breakpoint
CREATE UNIQUE INDEX "senders_account_sender_key_uniq" ON "senders" USING btree ("mailbox_account_id","sender_key");--> statement-breakpoint
CREATE INDEX "senders_account_category_idx" ON "senders" USING btree ("mailbox_account_id","gmail_category");--> statement-breakpoint
CREATE TRIGGER mail_messages_set_updated_at BEFORE UPDATE ON "mail_messages" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER senders_set_updated_at BEFORE UPDATE ON "senders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER sender_policies_set_updated_at BEFORE UPDATE ON "sender_policies" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER provider_sync_state_set_updated_at BEFORE UPDATE ON "provider_sync_state" FOR EACH ROW EXECUTE FUNCTION set_updated_at();