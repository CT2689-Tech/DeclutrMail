-- Verified cross-domain identities for the global brand-artwork cache.
--
-- Mailing infrastructure frequently uses a sibling domain that hosts no
-- website (`temuemail.com`, `facebookmail.com`). Resolving artwork against
-- that literal domain guarantees a monogram even when the organization has
-- excellent artwork on its canonical website. These public, reviewed aliases
-- let every user reuse one canonical cache row before the worker reaches the
-- paid Brandfetch tier.
--
-- NO USER LINKAGE. Like domain_icons, this is a global cache of public domain
-- relationships. It must never gain a user, workspace, mailbox, sender, or
-- message foreign key.

CREATE TYPE "brand_domain_alias_source" AS ENUM (
  'official_documentation',
  'manual_review',
  'observed_redirect'
);
--> statement-breakpoint
CREATE TABLE "brand_domain_aliases" (
  "alias_domain" varchar(253) PRIMARY KEY NOT NULL,
  "canonical_domain" varchar(253) NOT NULL,
  "source" "brand_domain_alias_source" NOT NULL,
  "confidence" integer NOT NULL,
  "evidence_url" varchar(2048),
  "verified_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brand_domain_aliases_confidence_range_chk"
    CHECK ("confidence" BETWEEN 0 AND 100),
  CONSTRAINT "brand_domain_aliases_not_self_referential_chk"
    CHECK ("alias_domain" <> "canonical_domain")
);
--> statement-breakpoint
ALTER TABLE "brand_domain_aliases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "brand_domain_aliases"
  ("alias_domain", "canonical_domain", "source", "confidence", "evidence_url")
VALUES
  ('temuemail.com', 'temu.com', 'official_documentation', 100,
   'https://www.temu.com/dz/support/c3/support-f-208-s-2039.html'),
  ('temuofficial.com', 'temu.com', 'official_documentation', 100,
   'https://www.temu.com/dz/support/c3/support-f-208-s-2039.html'),
  ('temumail.com', 'temu.com', 'official_documentation', 100,
   'https://www.temu.com/dz/support/c3/support-f-208-s-2039.html'),
  ('temufavor.com', 'temu.com', 'official_documentation', 100,
   'https://www.temu.com/dz/support/c3/support-f-208-s-2039.html'),
  ('facebookmail.com', 'facebook.com', 'official_documentation', 100,
   'https://www.facebook.com/help/check-email'),
  ('redditmail.com', 'reddit.com', 'official_documentation', 100,
   'https://support.reddithelp.com/hc/en-us/articles/360045734831-How-do-I-know-if-a-message-from-Reddit-is-official'),
  ('redditforcommunity.com', 'reddit.com', 'official_documentation', 100,
   'https://support.reddithelp.com/hc/en-us/articles/360045734831-How-do-I-know-if-a-message-from-Reddit-is-official'),
  ('aexp.com', 'americanexpress.com', 'official_documentation', 100,
   'https://www.americanexpress.com/en-gb/security/scams-phishing-online-safety/index.html'),
  ('aexpfeedback.com', 'americanexpress.com', 'official_documentation', 100,
   'https://www.americanexpress.com/en-gb/security/scams-phishing-online-safety/index.html');
--> statement-breakpoint
-- Existing misses were produced before organizational-domain and alias
-- canonicalization existed. Version 6 makes them provisional immediately.
ALTER TABLE "domain_icons"
  ALTER COLUMN "resolver_version" SET DEFAULT 6;
