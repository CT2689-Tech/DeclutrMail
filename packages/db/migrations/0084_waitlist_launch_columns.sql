-- Additive launch waitlist columns for Pro and provider capture.
-- `source` already exists and is not added again.
-- unique(email) stays. The composite unique below has no effect until
-- that index is dropped: a second row for the same address still
-- conflicts on waitlist_email_uniq. Dropping it is destructive and
-- needs Chintan's OK, so this migration does not drop it.

ALTER TABLE "waitlist" ADD COLUMN "tier" text;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "provider" text;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "would_pay" boolean;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "contact_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- waitlist_email_uniq already forbids a second row for the same email,
-- so this composite index cannot fail on duplicate email values.
-- atlas:nolint data_depend
CREATE UNIQUE INDEX "waitlist_email_tier_provider_uniq" ON "waitlist" USING btree ("email", (coalesce("tier", '')), (coalesce("provider", '')));
