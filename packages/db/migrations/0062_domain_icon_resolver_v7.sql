-- Brandfetch was bound to the production worker (see the deploy
-- workflow). The tier had never run there: the worker builds its deps
-- as `...(brandfetchApiKey ? { brandfetch } : {})` and the key was
-- absent, so every v6 verdict in production was reached by BIMI and
-- website scraping alone. Version 7 makes those misses provisional
-- immediately, exactly as version 6 did for the misses that predated
-- organizational-domain canonicalization.
--
-- DEFAULT ONLY, NO BACKFILL. Existing rows must KEEP their old version:
-- that is precisely what marks them stale, and `isStale` gates the
-- version rule on `status = 'none'`, so marks we already hold are
-- untouched and no quota is spent re-learning them. Stamping existing
-- rows to 7 would freeze the very verdicts this retires.
ALTER TABLE "domain_icons"
  ALTER COLUMN "resolver_version" SET DEFAULT 7;
