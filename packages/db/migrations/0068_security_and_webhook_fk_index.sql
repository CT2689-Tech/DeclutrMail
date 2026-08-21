-- atlas:txmode none
-- 0068_security_and_webhook_fk_index.sql
--
-- Three mechanical production-hardening items that do not change
-- product behaviour. Bundled because they are independent, each is a
-- one-statement class of change, and splitting them would burn a
-- second Atlas apply window for no isolation benefit.
--
-- 1. Pin `dm_normalize_email` search_path.
--    Migration 0033 pinned `set_updated_at` and `outbox_notify_inserted`.
--    `dm_normalize_email` (0063) shipped later and missed the same
--    `function_search_path_mutable` advisory. Same fix, same reason:
--    store `search_path = pg_catalog, public` on the function so a
--    caller cannot shadow an unqualified name. The body only uses
--    `pg_catalog` string functions today; the pin future-proofs it.
--
-- 2. REVOKE table rights from `anon` and `authenticated`.
--    Supabase's default privileges GRANT ALL on every public table to
--    those roles. DeclutrMail's API connects as `postgres`; Data API
--    is off (ADR-0022). RLS is enabled with zero policies, so those
--    grants are currently a no-op under the PostgREST roles — but they
--    are still GRANT ALL, which is the wrong default if Data API is
--    ever toggled on. Defense in depth: revoke existing table grants
--    and stop default privileges from re-granting on CREATE TABLE.
--    Do NOT add SELECT policies. Deny-all-via-no-policy is the
--    intentional posture (0026, 0049).
--
--    Roles are referenced only if they exist so PGlite (no Supabase
--    roles) and a local Postgres without them still apply cleanly.
--
-- 3. Index `webhook_dedup (mailbox_account_id)`.
--    PK is `message_id` only. `mailbox_account_id` is an FK to
--    `mailbox_accounts` with ON DELETE CASCADE and no supporting
--    index, so deleting a mailbox seq-scans webhook_dedup. The table
--    is small today; the index is still the right shape for the FK.
--
-- CONCURRENTLY because webhook_dedup is live (dogfood). A leftover
-- INVALID index from a failed concurrent build must fail loudly on
-- retry, so there is no IF NOT EXISTS. Recovery is the rollback
-- (DROP INDEX) then re-apply.
--
-- The leading file directive is required: CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block. See 0065 for the two
-- placement rules — both are load-bearing.
--
-- Privacy (D7, D228): no new columns, no Gmail fields, no row mutation.
-- REVOKE is privilege metadata. The function ALTER is proconfig only.

ALTER FUNCTION public.dm_normalize_email(raw text) SET search_path = pg_catalog, public;
--> statement-breakpoint
DO $$
DECLARE
  r text;
  grantor text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;

  -- MEMBERSHIP, NOT EXISTENCE. `ALTER DEFAULT PRIVILEGES FOR ROLE x`
  -- requires the executing role to be a MEMBER of x, not merely for x to
  -- exist. Guarding on existence is why the first version of this file
  -- could not apply to production: checked 2026-08-21 against
  -- declutrmail-prod, `current_user` is `postgres` and
  -- `pg_has_role('postgres','supabase_admin','USAGE')` is FALSE while
  -- `supabase_admin` EXISTS -- so the guard passed and the statement
  -- raised `permission denied to change default privileges` (42501).
  --
  -- THAT FAILURE IS NOT RECOVERABLE IN PLACE. This file is
  -- `-- atlas:txmode none`, so there is no transaction to roll back:
  -- the ALTER FUNCTION and both REVOKEs would already have committed,
  -- the CREATE INDEX below would never run, and Atlas would record 0068
  -- as failed -- blocking every later migration behind it.
  --
  -- A SKIP IS ANNOUNCED, NEVER SILENT. If we cannot set a grantor's
  -- default privileges, that grantor's future grants are NOT hardened;
  -- saying so in the migration output is the difference between a known
  -- gap and an invisible one.
  FOREACH grantor IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantor) THEN
      CONTINUE;
    END IF;
    IF NOT pg_has_role(current_user, grantor, 'USAGE') THEN
      RAISE NOTICE
        '0068: skipping ALTER DEFAULT PRIVILEGES FOR ROLE % -- % is not a member of it. Future tables created by % are NOT hardened against anon/authenticated.',
        grantor, current_user, grantor;
      CONTINUE;
    END IF;
    IF TRUE THEN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
            grantor,
            r
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
            grantor,
            r
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- DID THE REVOKE ACTUALLY REVOKE? `REVOKE` only removes privileges the
  -- EXECUTING role granted. If the grants originated elsewhere (on
  -- Supabase they come from `supabase_admin`'s default privileges), the
  -- statement emits `WARNING: no privileges could be revoked` and
  -- changes nothing -- and a WARNING is not an error, so `atlas migrate
  -- apply` and its status check both report success on a no-op. A
  -- security hardening that cannot fail is not a hardening.
  --
  -- This turns that silent no-op into a loud one. It checks the state we
  -- claim to have produced, not the statement we ran.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE grantee = r AND table_schema = 'public'
      ) THEN
        RAISE EXCEPTION
          '0068: % still holds table privileges in schema public after REVOKE -- the grants were made by another role, so this REVOKE was a no-op. Re-run as the granting role.',
          r;
      END IF;
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "webhook_dedup_mailbox_account_id_idx"
  ON "webhook_dedup" USING btree ("mailbox_account_id");
