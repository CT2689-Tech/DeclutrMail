-- 0030_launch_schema_pack.sql
--
-- D150 consolidated launch schema pack — the one migration that
-- unblocks the Wave-1 launch features. Ships the schema legs of:
--
--   - D117/D118/D126: `billing_customers`, `subscriptions`,
--     `subscription_events` (Paddle + Razorpay, normalized) +
--     `users.billing_region`
--   - waitlist: pre-signup email capture for launch invites
--   - D232: `account_deletion_requests` (USER-scoped — the D232
--     formula is per-user across all mailboxes)
--   - D225: `cron_runs` (cronPolicy idempotency ledger) +
--     `dead_letter_jobs` (adminPolicy surface)
--   - D58/D104: `activity_log.rule_id` — autopilot rule attribution
--   - D78/D79: `sender_policies.snoozed_until / snoozed_at /
--     snoozed_reason` — sender-level snooze
--   - D113/D64: `users.onboarded_at`, `users.timezone`
--   - D71–D76: `screener_quarantine` — first-time-sender queue
--     (table name per D72 plan text)
--
-- Design notes (full rationale in the matching src/schema/*.ts docs):
--
--   - Billing is WORKSPACE-scoped: tier lives on `workspaces.tier`
--     (D17–D21); billing flips it, so customer + subscription rows
--     hang off the same tenant boundary. `users.billing_region`
--     stays per D117 (signup-time IP detection + Settings override).
--   - `subscription_events (provider, provider_event_id)` UNIQUE is
--     the webhook dedup/replay gate — same `INSERT … ON CONFLICT DO
--     NOTHING` pattern as `webhook_dedup` (D229 step 7's billing
--     sibling).
--   - `subscription_status` has NO 'trialing' value — D117 CODEX
--     PATCH 2026-05-18 (D121 no-trial mechanic).
--   - `account_deletion_requests` carries a CHECK that a
--     'waived-immediate' basis requires `waiver_confirmed = true`
--     (the D232 typed-waiver path), a partial UNIQUE enforcing at
--     most one in-flight request per user, and a partial index for
--     the deletion cron's due-scan.
--   - Every new index serving a hot path is documented inline in the
--     schema files: webhook dedup lookups, deletion due-scan,
--     waitlist email check, snooze wake-scan, screener pending queue.
--   - All new tables get `ENABLE ROW LEVEL SECURITY` to preserve the
--     0026 belt-and-suspenders posture (RLS on + zero policies for
--     every V2 table; the `postgres` runtime role bypasses RLS).
--
-- `CREATE INDEX` is deliberately NOT `CONCURRENTLY` (0010/0012
-- precedent): PGlite (migration round-trip driver) cannot run
-- `CONCURRENTLY` outside an implicit transaction, and every indexed
-- table is either brand new or small at migration time.
--
-- NO DML — Atlas's `data_depend = error` rule. All tables are created
-- empty; column adds are nullable (no backfill required).
--
-- Privacy (D7, D228): metadata only across the board — provider ids,
-- region, timestamps, sender keys, queue/job bookkeeping. No message
-- bodies, no attachments, no non-allowlisted headers. The storage
-- allowlist is unchanged.

CREATE TYPE "public"."billing_provider" AS ENUM('paddle', 'razorpay');
--> statement-breakpoint
CREATE TYPE "public"."billing_region" AS ENUM('international', 'india');
--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');
--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'paused');
--> statement-breakpoint
CREATE TYPE "public"."account_deletion_basis" AS ENUM('flat-grace', 'undo-window', 'waived-immediate');
--> statement-breakpoint
CREATE TYPE "public"."account_deletion_status" AS ENUM('pending', 'cancelled', 'executing', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('running', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_customer_id" text NOT NULL,
	"region" "billing_region" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "billing_customers_workspace_provider_uniq" ON "billing_customers" USING btree ("workspace_id", "provider");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "billing_customers_provider_customer_uniq" ON "billing_customers" USING btree ("provider", "provider_customer_id");
--> statement-breakpoint
ALTER TABLE "billing_customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"tier" "workspace_tier" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"provider_price_id" text NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pause_until" timestamp with time zone,
	"founding_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_subscription_uniq" ON "subscriptions" USING btree ("provider", "provider_subscription_id");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "subscriptions_workspace_id_idx" ON "subscriptions" USING btree ("workspace_id");
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_provider_event_uniq" ON "subscription_events" USING btree ("provider", "provider_event_id");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "subscription_events_pending_idx" ON "subscription_events" USING btree ("created_at") WHERE "subscription_events"."processed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" citext NOT NULL,
	"tier_interest" "workspace_tier",
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_uniq" ON "waitlist" USING btree ("email");
--> statement-breakpoint
ALTER TABLE "waitlist" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"basis" "account_deletion_basis" NOT NULL,
	"waiver_confirmed" boolean DEFAULT false NOT NULL,
	"status" "account_deletion_status" DEFAULT 'pending' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_requests_waiver_consistent" CHECK ("basis" <> 'waived-immediate' OR "waiver_confirmed" = true)
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "account_deletion_requests_due_scan_idx" ON "account_deletion_requests" USING btree ("effective_at") WHERE "account_deletion_requests"."status" = 'pending';
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_requests_user_active_uniq" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" IN ('pending', 'executing');
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_name" text NOT NULL,
	"run_key" text NOT NULL,
	"status" "cron_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "cron_runs_run_key_uniq" ON "cron_runs" USING btree ("run_key");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "cron_runs_worker_started_idx" ON "cron_runs" USING btree ("worker_name", "started_at" DESC);
--> statement-breakpoint
ALTER TABLE "cron_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "dead_letter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replayed_at" timestamp with time zone
);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "dead_letter_jobs_unreplayed_idx" ON "dead_letter_jobs" USING btree ("failed_at") WHERE "dead_letter_jobs"."replayed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "dead_letter_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "screener_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_account_id" uuid NOT NULL,
	"sender_key" text NOT NULL,
	"soft_quarantined" boolean DEFAULT true NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screener_quarantine" ADD CONSTRAINT "screener_quarantine_mailbox_account_id_mailbox_accounts_id_fk" FOREIGN KEY ("mailbox_account_id") REFERENCES "public"."mailbox_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "screener_quarantine_account_sender_uniq" ON "screener_quarantine" USING btree ("mailbox_account_id", "sender_key");
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "screener_quarantine_pending_idx" ON "screener_quarantine" USING btree ("mailbox_account_id", "created_at") WHERE "screener_quarantine"."decided_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "screener_quarantine" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "rule_id" uuid;
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "activity_log_rule_id_idx" ON "activity_log" USING btree ("rule_id") WHERE "activity_log"."rule_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snoozed_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snoozed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sender_policies" ADD COLUMN "snoozed_reason" text;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "sender_policies_snooze_wake_idx" ON "sender_policies" USING btree ("snoozed_until") WHERE "sender_policies"."snoozed_until" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billing_region" "billing_region";
