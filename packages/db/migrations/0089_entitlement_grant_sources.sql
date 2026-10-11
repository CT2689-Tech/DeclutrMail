-- Additive. Backlog Pass grants share entitlement_grants with comps.
-- Existing rows become source='comp'. unique(email) stays until 0090.

ALTER TABLE "entitlement_grants" ADD COLUMN "source" text DEFAULT 'comp' NOT NULL;
--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD COLUMN "provider" text;
--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD COLUMN "provider_transaction_id" text;
--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_source_check" CHECK ("source" in ('comp', 'pass', 'promo'));
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_grants_provider_transaction_uniq" ON "entitlement_grants" ("provider_transaction_id");
--> statement-breakpoint
ALTER TABLE "pending_checkouts" ADD COLUMN "offer" text;
