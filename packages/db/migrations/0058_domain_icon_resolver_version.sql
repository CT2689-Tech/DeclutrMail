-- Invalidate negative brand-icon rows produced before the official-
-- website resolver existed, without discarding already-resolved marks.
--
-- Resolver version 3 is the BIMI -> official website cascade. Existing
-- misses become version 2 so the read path re-queues them immediately;
-- existing hits remain useful and are marked current. New rows default
-- to the current version, while the worker also writes it explicitly.

ALTER TABLE "domain_icons"
  ADD COLUMN "resolver_version" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
UPDATE "domain_icons"
SET "resolver_version" = 2
WHERE "status" = 'none';
