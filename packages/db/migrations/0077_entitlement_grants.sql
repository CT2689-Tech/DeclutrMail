-- Entitlement grants — complimentary tier granted by DeclutrMail.
--
-- The mechanism behind `pnpm grant-tier <email> <tier>`: comp a friend,
-- an advisor, or a beta cohort onto Plus or Pro without a payment.
--
-- WHY A TABLE AND NOT A TIER WRITE. `UPDATE workspaces SET tier='pro'`
-- appears to work and then silently un-works. Both recompute paths
-- (`BillingWebhookService.recomputeWorkspaceTier` and the worker's
-- reconciliation sweep) derive `workspaces.tier` from the
-- `subscriptions` table and COALESCE to 'free'. Today the sweep's
-- `WHERE EXISTS` spares a workspace with no subscription rows at all,
-- which is why a hand-set tier appears durable — but the moment the
-- comped person opens a checkout, a row exists, the recompute sees no
-- granting subscription, and they drop to Free with no event to notice
-- it by. This table is the durable record those recomputes consult.
--
-- Both recompute paths resolve `workspaces.tier` as the MAX RANK of
-- (granting subscriptions, live grant). A grant is a FLOOR, never a
-- replacement, so the two compose the right way round: a comped Pro who
-- later buys Plus stays Pro, and a comp that expires drops them to the
-- Plus they pay for rather than to Free.
--
-- Keyed on EMAIL, not workspace id, so a grant can be written before
-- the person has ever signed up — signup consults it when it bootstraps
-- the workspace. `citext` matches `users.email`, so casing can never
-- split one identity across two grants.
--
-- LIVE means `revoked_at IS NULL AND (expires_at IS NULL OR expires_at
-- > now())`. Expired and revoked rows are KEPT: the trail of who was
-- comped, why, and when it ended is the reason this is a table rather
-- than an env var.
--
-- `reason` and `granted_by` are NOT NULL on purpose. A comp with no
-- stated reason is indistinguishable, six months on, from a tier
-- someone set by mistake.
--
-- Privacy (D7, D228): one email address and a tier. No Gmail field is
-- added and nothing here reads message content.
CREATE TABLE "entitlement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" citext NOT NULL,
	"tier" "workspace_tier" NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One grant per identity. Re-granting an email UPDATES this row rather
-- than stacking a second: two live grants for one person would make
-- "which comp are they on" unanswerable, and the max-rank resolve would
-- quietly pick the higher one without anyone having decided that.
-- atlas:nolint concurrent_index
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_grants_email_uniq" ON "entitlement_grants" USING btree ("email");
--> statement-breakpoint
-- The sweep's expiry scan: find grants that stopped granting since the
-- last pass so their workspace gets recomputed down. Partial on the
-- rows that can still expire — permanent comps (`expires_at IS NULL`)
-- never appear in it.
-- atlas:nolint concurrent_index
CREATE INDEX IF NOT EXISTS "entitlement_grants_expiry_scan_idx" ON "entitlement_grants" USING btree ("expires_at") WHERE "entitlement_grants"."expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER "entitlement_grants_set_updated_at" BEFORE UPDATE ON "entitlement_grants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
ALTER TABLE "entitlement_grants" ENABLE ROW LEVEL SECURITY;
