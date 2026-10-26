-- Additive: existing pending checkouts retain their unresolved legacy status.
CREATE TABLE billing_checkout_attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'paddle',
  tier text NOT NULL,
  cycle text NOT NULL,
  offer text,
  provider_price_id text NOT NULL,
  currency_code text NOT NULL,
  provider_transaction_id text,
  provider_subscription_id text,
  state text NOT NULL DEFAULT 'creating',
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  stopped_at timestamptz,
  CONSTRAINT billing_checkout_attempts_state_check CHECK (state IN ('creating','open','payment_in_progress','stopping','paid','fulfilled','stopped','unknown')),
  CONSTRAINT billing_checkout_attempts_purchase_check CHECK (provider = 'paddle' AND tier IN ('plus','pro') AND cycle IN ('monthly','annual') AND (offer IS NULL OR offer = 'pass_onetime') AND currency_code IN ('USD','INR'))
);
--> statement-breakpoint
-- Server-only billing metadata: no browser/public policies.
ALTER TABLE billing_checkout_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX billing_checkout_attempts_workspace_idx ON billing_checkout_attempts(workspace_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_checkout_attempts_transaction_key ON billing_checkout_attempts(provider, provider_transaction_id);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_checkout_attempts_one_unresolved ON billing_checkout_attempts(workspace_id) WHERE state IN ('creating','open','payment_in_progress','stopping','unknown');

--> statement-breakpoint
CREATE INDEX billing_checkout_attempts_recovery_idx ON billing_checkout_attempts(updated_at) WHERE state IN ('creating','open','payment_in_progress','stopping','paid','unknown');

--> statement-breakpoint
CREATE INDEX billing_checkout_attempts_subscription_idx ON billing_checkout_attempts(provider, provider_subscription_id);
