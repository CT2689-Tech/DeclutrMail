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

  FOREACH grantor IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantor) THEN
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
END
$$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "webhook_dedup_mailbox_account_id_idx"
  ON "webhook_dedup" USING btree ("mailbox_account_id");
