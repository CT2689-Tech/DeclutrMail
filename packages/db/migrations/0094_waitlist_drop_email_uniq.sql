-- DESTRUCTIVE. Chintan approved applying the comp-unique swap and the
-- waitlist unique drop on Oct 11 at 9:31 AM PT.
-- Drops waitlist_email_uniq. The composite unique on
-- (email, coalesce(tier,''), coalesce(provider,'')) stays, so one
-- address can hold a second launch kind.

DROP INDEX IF EXISTS "waitlist_email_uniq";
