-- 0045_demote_unqualified_auto_protections.sql
--
-- Restores the `protection_reason` enum values D245 (migration 0006,
-- edited in place) assumed every environment would have. An
-- already-migrated database (including production) applied the OLD
-- 0006 before that edit and never re-ran it — atlas tracks migrations
-- by version number, not content, so the edit silently never reached
-- it. The live symptom: `applyAutomaticProtection` (D245) writing
-- 'replied' / 'starred' / 'gmail_important' throws
-- "invalid input value for enum protection_reason", which rolls back
-- the entire enclosing sync transaction for any mailbox with a
-- qualifying sender.
--
-- `ADD VALUE` is forward-only-friendly and idempotent (`IF NOT
-- EXISTS`), matching the existing repo convention (migrations 0018,
-- 0024, 0028, 0031). Postgres forbids using a newly added enum value
-- in the SAME transaction that added it, so the demotion this
-- unblocks (previously bundled here) moved to migration 0046 — it
-- must commit as its own migration version, after this one.
--
-- No rollback recreates the type here: this repo's live database has
-- an uncertain historical label set (git shows the literal changed
-- three times: with 'vip', without 'vip', now without
-- 'engagement_based'), so guessing a "prior" set to recreate risks
-- silently dropping a still-valid label. See the .rollback file.

ALTER TYPE "public"."protection_reason" ADD VALUE IF NOT EXISTS 'replied';
--> statement-breakpoint
ALTER TYPE "public"."protection_reason" ADD VALUE IF NOT EXISTS 'starred';
--> statement-breakpoint
ALTER TYPE "public"."protection_reason" ADD VALUE IF NOT EXISTS 'gmail_important';
