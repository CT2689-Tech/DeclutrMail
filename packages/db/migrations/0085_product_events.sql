-- 0085_product_events.sql
--
-- Append-only product funnel (D159). Signup, connect, first sync, cap,
-- checkout, purchase, and email-click counts. Not PostHog: the server
-- has no analytics-consent signal, so these rows stay in Postgres.
--
-- Retention is 13 months, enforced by OpsRetentionWorker (not by this
-- file). user_id is ON DELETE SET NULL so account deletion keeps the
-- de-identified count.
--
-- Privacy (D7, D228): props is a closed key set. Each value is a scalar
-- on a closed list or a short pattern. Nested objects, arrays, and free
-- text are rejected. No email addresses, subjects, snippets, or tokens.

CREATE TYPE "product_event_name" AS ENUM (
  'signup_completed',
  'signin_provider',
  'gmail_connected',
  'first_sync_ready',
  'first_sync_failed_terminal',
  'free_cap_hit',
  'checkout_created',
  'purchase_confirmed',
  'email_link_clicked'
);
--> statement-breakpoint
CREATE TABLE "product_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "event" "product_event_name" NOT NULL,
  "props" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "product_events_props_chk" CHECK (
    jsonb_typeof("props") = 'object'
    AND ("props" - ARRAY['kind', 'plan', 'requested_bucket', 'duration_s', 'emails', 'template', 'mode', 'error_class', 'provider', 'mailbox_id']::text[]) = '{}'::jsonb
    AND strpos("props"::text, '@') = 0
    AND ("props"->'kind' IS NULL OR (jsonb_typeof("props"->'kind') = 'string' AND "props"->>'kind' IN ('gmail', 'workspace')))
    AND ("props"->'plan' IS NULL OR (jsonb_typeof("props"->'plan') = 'string' AND "props"->>'plan' ~ '^[A-Za-z0-9._+-]{1,64}$'))
    AND ("props"->'requested_bucket' IS NULL OR (jsonb_typeof("props"->'requested_bucket') = 'string' AND "props"->>'requested_bucket' IN ('1', '2-10', '11-100', '101-1000', '1001+')))
    AND ("props"->'duration_s' IS NULL OR (jsonb_typeof("props"->'duration_s') = 'number' AND ("props"->>'duration_s')::numeric IN (0, 30, 60, 120, 300, 600, 1800, 3600, 7200)))
    AND ("props"->'emails' IS NULL OR (jsonb_typeof("props"->'emails') = 'number' AND ("props"->>'emails')::numeric IN (0, 100, 1000, 10000, 50000, 100000)))
    AND ("props"->'template' IS NULL OR (jsonb_typeof("props"->'template') = 'string' AND "props"->>'template' IN ('sync_complete', 'sync_reminder_24h', 'lapse', 'weekly', 'weekly_detail', 'sync_failed', 'gmail_reconnect', 'deletion_scheduled')))
    AND ("props"->'mode' IS NULL OR (jsonb_typeof("props"->'mode') = 'string' AND "props"->>'mode' IN ('login', 'connect', 'reconnect')))
    AND ("props"->'error_class' IS NULL OR (jsonb_typeof("props"->'error_class') = 'string' AND "props"->>'error_class' ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'))
    AND ("props"->'provider' IS NULL OR (jsonb_typeof("props"->'provider') = 'string' AND "props"->>'provider' = 'google'))
    AND ("props"->'mailbox_id' IS NULL OR (jsonb_typeof("props"->'mailbox_id') = 'string' AND "props"->>'mailbox_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))
  )
);
--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "product_events_occurred_at_idx" ON "product_events" USING btree ("occurred_at" DESC);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "product_events_event_occurred_idx" ON "product_events" USING btree ("event", "occurred_at" DESC);
--> statement-breakpoint
-- atlas:nolint concurrent_index
CREATE INDEX "product_events_user_id_idx" ON "product_events" USING btree ("user_id");
--> statement-breakpoint
-- Deny-by-default, same as every other public table. The API connects as owner.
ALTER TABLE "product_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN "signup_attribution_utm_source" text,
  ADD COLUMN "signup_attribution_utm_medium" text,
  ADD COLUMN "signup_attribution_utm_campaign" text,
  ADD COLUMN "signup_attribution_landing_path" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_signup_attribution_utm_source_chk"
    CHECK ("signup_attribution_utm_source" IS NULL OR (
      char_length("signup_attribution_utm_source") BETWEEN 1 AND 64
      AND strpos("signup_attribution_utm_source", '@') = 0
      AND strpos("signup_attribution_utm_source", '?') = 0
      AND strpos("signup_attribution_utm_source", '#') = 0
      AND strpos("signup_attribution_utm_source", ' ') = 0
      AND strpos("signup_attribution_utm_source", '/') = 0
    )),
  ADD CONSTRAINT "users_signup_attribution_utm_medium_chk"
    CHECK ("signup_attribution_utm_medium" IS NULL OR (
      char_length("signup_attribution_utm_medium") BETWEEN 1 AND 64
      AND strpos("signup_attribution_utm_medium", '@') = 0
      AND strpos("signup_attribution_utm_medium", '?') = 0
      AND strpos("signup_attribution_utm_medium", '#') = 0
      AND strpos("signup_attribution_utm_medium", ' ') = 0
      AND strpos("signup_attribution_utm_medium", '/') = 0
    )),
  ADD CONSTRAINT "users_signup_attribution_utm_campaign_chk"
    CHECK ("signup_attribution_utm_campaign" IS NULL OR (
      char_length("signup_attribution_utm_campaign") BETWEEN 1 AND 64
      AND strpos("signup_attribution_utm_campaign", '@') = 0
      AND strpos("signup_attribution_utm_campaign", '?') = 0
      AND strpos("signup_attribution_utm_campaign", '#') = 0
      AND strpos("signup_attribution_utm_campaign", ' ') = 0
      AND strpos("signup_attribution_utm_campaign", '/') = 0
    )),
  ADD CONSTRAINT "users_signup_attribution_landing_path_chk"
    CHECK ("signup_attribution_landing_path" IS NULL OR (
      char_length("signup_attribution_landing_path") BETWEEN 1 AND 200
      AND "signup_attribution_landing_path" LIKE '/%'
      AND strpos("signup_attribution_landing_path", '@') = 0
      AND strpos("signup_attribution_landing_path", '?') = 0
      AND strpos("signup_attribution_landing_path", '#') = 0
      AND strpos("signup_attribution_landing_path", ' ') = 0
    ));
