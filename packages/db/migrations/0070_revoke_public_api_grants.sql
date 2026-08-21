-- Revoke the Supabase public-API grants from `anon` and `authenticated`.
--
-- Supabase's bootstrap hands both public-API roles full DML on `public`,
-- on the assumption that the Data API is how you reach the database.
-- DeclutrMail does not: the API and the workers connect as `postgres`
-- through Supavisor. At the time of writing each role held 252 table
-- grants in `public` and neither had ever been used by app code.
--
-- WHAT ACTUALLY STOPS A READ TODAY, and will keep stopping it after this
-- migration: row-level security. All 36 tables in `public` have it
-- enabled with zero policies, which denies everything to any role that
-- does not bypass it. That is the D7 deny-all posture and it is correct.
-- This migration is the SECOND gate, not the first. Its value is the
-- case where the first one slips — a future table that ships with RLS
-- relaxed, or the Data API being switched on — where today's grants
-- would already be sitting live underneath.
--
-- NOT HYPOTHETICAL THAT THE SERVICE IS UP: PostgREST is running on this
-- project (`authenticator`, 2 idle backends, application_name
-- `postgrest`). It is idle because nothing calls it, not because it is
-- off. After this it can still authenticate and still read nothing.
--
-- `postgres` is untouched and bypasses RLS, so the app path is
-- unchanged. Default privileges are revoked too, or the next migration's
-- CREATE TABLE would hand back what this one took away.
--
-- THE GUARD IS LOAD-BEARING, not defensive padding. `anon` and
-- `authenticated` are Supabase roles; they do not exist on a vanilla
-- Postgres. The local dev database and the D183 testcontainers suite
-- both run vanilla, where an unguarded `REVOKE … FROM anon` aborts with
-- `role "anon" does not exist` and takes the whole migration with it.
-- Skipping per-role rather than per-file means a half-provisioned
-- database still gets whatever it can take.
--
-- SCHEMA `USAGE` IS DELIBERATELY LEFT ALONE. With no table, sequence or
-- function grants, USAGE on the schema conveys nothing readable, and
-- revoking it reaches past what was asked for into Supabase's own
-- dashboard introspection.
--
-- LIMIT WORTH KNOWING: `ALTER DEFAULT PRIVILEGES` without `FOR ROLE`
-- binds to the role running it. Migrations run as `postgres` via
-- `SUPABASE_SESSION_DSN`, which is also the role that creates tables, so
-- this covers the path that matters. An object created by
-- `supabase_admin` would still pick up Supabase's own defaults.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN
      RAISE NOTICE 'role % absent — skipping (not a Supabase database)', target;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', target);
  END LOOP;
END $$;
