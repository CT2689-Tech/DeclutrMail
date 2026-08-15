-- Brand icon cache (ADR-0034).
--
-- ONE row per brand-root domain, for the whole product. A logo is a
-- property of a domain, not of anyone's relationship to it, so every
-- user who receives mail from a brand shares one row and one outbound
-- fetch, ever. Distinct sender domains follow a hard power law, so
-- this table grows sublinearly with the userbase.
--
-- NO USER LINKAGE, DELIBERATELY. There is no `user_id` and no
-- `mailbox_account_id` here, and adding one is not a schema
-- convenience -- it converts a brand-asset cache into a queryable
-- index of who receives mail from whom, which is precisely the
-- artifact D7/D228 says DeclutrMail does not hold. The table is
-- populated BY domains we happened to see, but records nothing about
-- who saw them.
--
-- NEGATIVE CACHING IS THE POINT. `status='none'` is a stored answer:
-- "we looked, this domain publishes no mark". Absence of a row means
-- "never looked" and is the only state that enqueues a fetch. Without
-- the distinction, every render of a logo-less sender re-enqueues
-- work forever -- the failure mode that turns this pattern into a
-- self-inflicted DDoS. Rows go stale on their status' TTL (90d for
-- `ok` so rebrands land, 30d for `none` so newly-published BIMI
-- records land).
--
-- Phase 1 stores BIMI SVG verbatim after sanitization: vector, a few
-- KB, renders at every avatar size with no raster pipeline and no
-- image-processing dependency. `bytea` rather than `text` so a Phase 2
-- vendor raster lands in the same column without a type migration.
--
-- Privacy (D7, D228): public brand artwork and its bookkeeping. No
-- Gmail data, no message metadata, no identifiers of any kind.

CREATE TYPE "domain_icon_status" AS ENUM (
  'ok',
  'none'
);
--> statement-breakpoint
CREATE TYPE "domain_icon_source" AS ENUM (
  'bimi',
  'vendor'
);
--> statement-breakpoint
CREATE TABLE "domain_icons" (
  -- Brand root, lowercased: `chase.com`, never `mail1.chase.com`.
  -- Bounded at the DNS maximum name length so a pathological sender
  -- cannot inflate the primary-key index.
  "domain" varchar(253) PRIMARY KEY NOT NULL,
  "status" "domain_icon_status" NOT NULL,
  -- NULL iff status='none' -- see the CHECK below.
  "image" bytea,
  "mime" varchar(64),
  "source" "domain_icon_source",
  -- sha256(image), hex. Strong-ETag input; also lets a refresh skip
  -- the write when a brand re-published byte-identical art.
  "content_hash" varchar(64),
  "byte_size" integer,
  "fetched_at" timestamptz DEFAULT now() NOT NULL,

  -- The four payload columns travel together or not at all. Without
  -- this, a partial write could leave status='ok' with a NULL image,
  -- which the endpoint would serve as a 200 with an empty body -- a
  -- broken <img> on every surface rendering that sender, and the
  -- monogram floor bypassed precisely where it is needed.
  CONSTRAINT "domain_icons_image_matches_status_chk" CHECK (
    ("status" = 'ok'
       AND "image" IS NOT NULL
       AND "mime" IS NOT NULL
       AND "source" IS NOT NULL
       AND "content_hash" IS NOT NULL
       AND "byte_size" IS NOT NULL)
    OR
    ("status" = 'none'
       AND "image" IS NULL
       AND "mime" IS NULL
       AND "source" IS NULL
       AND "content_hash" IS NULL
       AND "byte_size" IS NULL)
  )
);
--> statement-breakpoint
-- No secondary index, deliberately. Refresh is demand-driven (the read
-- path re-queues a stale row it just served), so there is no staleness
-- sweep and every query here is a primary-key lookup by domain. An
-- index on (status, fetched_at) would be write amplification with no
-- reader. Add one with the sweep, if a sweep ever earns its place.
--> statement-breakpoint
-- Every public table keeps the deny-by-default boundary (0049). No
-- policy is granted: the API and workers connect as the table owner.
-- The contents are public brand artwork, but the boundary is uniform
-- across the schema and this table is no place to introduce an
-- exception.
ALTER TABLE "domain_icons" ENABLE ROW LEVEL SECURITY;
