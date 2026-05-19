CREATE TYPE "public"."mailbox_provider" AS ENUM('gmail');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."workspace_tier" AS ENUM('free', 'plus', 'pro', 'team', 'enterprise');--> statement-breakpoint
CREATE TABLE "mailbox_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"status" "mailbox_status" DEFAULT 'active' NOT NULL,
	"quiet_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dev_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" "workspace_tier" DEFAULT 'free' NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"founding_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD CONSTRAINT "mailbox_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_accounts" ADD CONSTRAINT "mailbox_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_accounts_provider_account_uniq" ON "mailbox_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uniq" ON "users" USING btree ("email");