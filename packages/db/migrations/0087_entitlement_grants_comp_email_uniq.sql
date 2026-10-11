-- DESTRUCTIVE. Needs Chintan's OK before this is applied anywhere persistent.
-- Replaces entitlement_grants_email_uniq with a partial unique index on
-- comp rows so a Backlog Pass can share an email with a comp, and a
-- repeat Pass purchase can insert another row. No columns are dropped.
-- Refuses to run if two comp rows already share an email.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "entitlement_grants"
    WHERE "source" = 'comp'
    GROUP BY "email"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate comp emails; refusing entitlement_grants index swap';
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "entitlement_grants_email_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_comp_email_uniq"
  ON "entitlement_grants" ("email")
  WHERE "source" = 'comp';
