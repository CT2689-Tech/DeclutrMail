-- Rollback for 0000_foundation_workspaces_users_mailboxes.sql
--
-- Per D152: forward migrations have a companion rollback file. Apply this
-- to fully revert 0000 on a fresh DB. Order is the reverse of forward:
-- drop triggers and trigger function first; drop dependent tables before
-- parent tables; drop enums; finally drop the citext extension.
--
-- NOT idempotent — assumes the schema matches the forward migration's end state.

DROP TRIGGER IF EXISTS "mailbox_accounts_set_updated_at" ON "mailbox_accounts";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_set_updated_at" ON "users";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "workspaces_set_updated_at" ON "workspaces";
--> statement-breakpoint
DROP FUNCTION IF EXISTS set_updated_at();
--> statement-breakpoint
ALTER TABLE "mailbox_accounts" DROP CONSTRAINT IF EXISTS "mailbox_accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mailbox_accounts" DROP CONSTRAINT IF EXISTS "mailbox_accounts_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_workspace_id_workspaces_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "mailbox_accounts_provider_account_uniq";
--> statement-breakpoint
DROP INDEX IF EXISTS "mailbox_accounts_workspace_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "mailbox_accounts_user_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "users_email_uniq";
--> statement-breakpoint
DROP INDEX IF EXISTS "users_workspace_id_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "mailbox_accounts";
--> statement-breakpoint
DROP TABLE IF EXISTS "users";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspaces";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mailbox_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mailbox_provider";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."workspace_tier";
--> statement-breakpoint
DROP EXTENSION IF EXISTS "citext";
