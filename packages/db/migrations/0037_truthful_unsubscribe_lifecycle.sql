-- 0037_truthful_unsubscribe_lifecycle.sql
--
-- D245 — represent what DeclutrMail can actually prove throughout an
-- unsubscribe attempt. A 2xx RFC 8058 response means that the remote
-- endpoint accepted the request; it does not prove that the sender has
-- stopped mailing. A mailto link similarly requires explicit user
-- progress, and a missing channel is unavailable rather than silently
-- NULL. Failed and unconfirmed terminal outcomes receive distinct
-- Activity rows so the audit feed can surface them honestly.
--
-- The old unsub_status values remain valid during the rolling deploy.
-- Read boundaries normalize pending/done/ambiguous; all new producers
-- write the canonical values added here.

ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'requested';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'endpoint_accepted';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'unconfirmed';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'action_required';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'draft_opened';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'user_marked_sent';
--> statement-breakpoint
ALTER TYPE "public"."unsub_status" ADD VALUE IF NOT EXISTS 'unavailable';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_endpoint_accepted';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_failed';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_unconfirmed';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_action_required';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_draft_opened';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_user_marked_sent';
--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'unsubscribe_unavailable';
