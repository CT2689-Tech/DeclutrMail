-- atlas:txmode file
-- 0035_mailbox_provider_account_citext.sql
--
-- A Gmail account is one global provider identity regardless of casing.
-- The original text column made the UNIQUE(provider, provider_account_id)
-- index case-sensitive, so casing variants could be owned by different
-- workspaces. Canonicalize stored identities and promote the column to
-- citext while retaining the existing unique index used by Drizzle's
-- ON CONFLICT(provider, provider_account_id) connect path.
--
-- The table lock closes the write window between duplicate detection and
-- conversion. Existing case/whitespace-equivalent rows are ownership
-- ambiguity, not data we can safely reconcile: abort before changing any
-- row and require an explicit operator decision. No row is merged/deleted.

DO $$
BEGIN
  LOCK TABLE "mailbox_accounts" IN ACCESS EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM "mailbox_accounts"
    GROUP BY "provider", lower(btrim("provider_account_id"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = '0035 aborted: mailbox_accounts contains case/whitespace-equivalent provider identities.',
      DETAIL = 'No rows were changed because canonicalization would violate mailbox_accounts_provider_account_uniq.',
      HINT = 'Resolve duplicate ownership explicitly before retrying; this migration never merges or deletes mailbox rows.';
  END IF;
END
$$;--> statement-breakpoint

-- atlas:nolint data_depend
UPDATE "mailbox_accounts"
SET "provider_account_id" = lower(btrim("provider_account_id"))
WHERE "provider_account_id" IS DISTINCT FROM lower(btrim("provider_account_id"));
--> statement-breakpoint

ALTER TABLE "mailbox_accounts"
  ALTER COLUMN "provider_account_id" TYPE citext
  USING "provider_account_id"::citext;
