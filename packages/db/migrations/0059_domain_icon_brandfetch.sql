-- Add Brandfetch as an explicit cache provenance tier. Keeping it
-- separate from official-site rasters lets the application enforce
-- Brandfetch's shorter 30-day cache horizon.
--
-- atlas:nolint incompatible — the enum change is additive; existing
-- readers and rows continue to use the prior values.

ALTER TYPE "public"."domain_icon_source" ADD VALUE IF NOT EXISTS 'brandfetch';
--> statement-breakpoint
ALTER TABLE "domain_icons"
  ALTER COLUMN "resolver_version" SET DEFAULT 4;
--> statement-breakpoint
UPDATE "domain_icons"
SET "resolver_version" = 3
WHERE "status" = 'none' AND "resolver_version" >= 3;
