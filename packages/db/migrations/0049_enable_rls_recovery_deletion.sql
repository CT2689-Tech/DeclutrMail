-- Preserve the public-schema deny-by-default boundary for tables
-- introduced after the original RLS migration.

ALTER TABLE "action_recovery_previews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mailbox_data_deletion_requests" ENABLE ROW LEVEL SECURITY;
