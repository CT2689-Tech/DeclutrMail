-- D120: durable paid-plan downgrades. Paddle applies an item swap
-- immediately even when billing is deferred, so the application keeps
-- the prior entitlement until scheduled_change_at.

ALTER TABLE "subscriptions"
  ADD COLUMN "scheduled_tier" "workspace_tier",
  ADD COLUMN "scheduled_billing_cycle" "billing_cycle",
  ADD COLUMN "scheduled_provider_price_id" text,
  ADD COLUMN "scheduled_change_at" timestamp with time zone,
  ADD COLUMN "scheduled_change_state" text,
  ADD COLUMN "scheduled_change_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_scheduled_change_state_check"
  CHECK ("scheduled_change_state" IS NULL OR "scheduled_change_state" IN ('pending_provider', 'scheduled', 'restoring_current'));
--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_scheduled_change_complete_check"
  CHECK (
    ("scheduled_change_state" IS NULL
      AND "scheduled_tier" IS NULL
      AND "scheduled_billing_cycle" IS NULL
      AND "scheduled_provider_price_id" IS NULL
      AND "scheduled_change_at" IS NULL
      AND "scheduled_change_requested_at" IS NULL)
    OR
    ("scheduled_change_state" IS NOT NULL
      AND "scheduled_tier" IS NOT NULL
      AND "scheduled_billing_cycle" IS NOT NULL
      AND "scheduled_provider_price_id" IS NOT NULL
      AND "scheduled_change_at" IS NOT NULL
      AND "scheduled_change_requested_at" IS NOT NULL)
  );
