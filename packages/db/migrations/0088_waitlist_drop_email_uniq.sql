-- DESTRUCTIVE. Needs Chintan's OK before this is applied anywhere persistent.
-- Drops waitlist_email_uniq. The composite unique on
-- (email, coalesce(tier,''), coalesce(provider,'')) stays, so one
-- address can hold a second launch kind.

DROP INDEX IF EXISTS "waitlist_email_uniq";
