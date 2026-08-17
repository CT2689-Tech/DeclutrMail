-- Retry cached misses after broadening the official-site quality gate.
-- Resolver version 5 accepts useful 32px favicons, mildly rectangular
-- application marks, and sanitized SVG icons while retaining the byte,
-- pixel, content, and network safety ceilings.

ALTER TABLE "domain_icons"
  ALTER COLUMN "resolver_version" SET DEFAULT 5;
--> statement-breakpoint
UPDATE "domain_icons"
SET "resolver_version" = 4
WHERE "status" = 'none';
