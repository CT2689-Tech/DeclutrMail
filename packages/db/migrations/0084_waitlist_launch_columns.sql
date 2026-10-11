-- Additive launch waitlist columns for Pro and provider capture.
-- `source` already exists and is not added again.
-- unique(email) stays. A second row for the same address would require
-- dropping that index, which is a destructive constraint change.

ALTER TABLE "waitlist" ADD COLUMN "tier" text;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "provider" text;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "would_pay" boolean;
--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "contact_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_tier_provider_uniq" ON "waitlist" USING btree ("email", (coalesce("tier", '')), (coalesce("provider", '')));
