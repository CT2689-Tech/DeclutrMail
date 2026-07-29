-- Billing reconciliation foundation (founder decisions 1+2, 2026-07-28).
-- Six followups shared one root cause: no server-side record of
-- in-flight or provider-side billing truth. This migration is the
-- schema half; the reconciler worker + webhook changes ride the same
-- PR.

-- 1. Cancellation provenance (2026-07-20 refund/chargeback decision).
--    Webhook writes could not tell local intent from provider truth:
--    a chargeback revoke was silently re-granted by the next
--    subscription.updated, and a refund flag silently cleared.
--    `cancel_source` records WHY entitlement is ending; the webhook
--    handler refuses to let a provider payload clobber a local
--    'refund'/'chargeback' verdict.
CREATE TYPE "cancel_source" AS ENUM ('provider', 'refund', 'chargeback');
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_source" "cancel_source";
--> statement-breakpoint

-- 2. Entitlement deadline (14-day dunning decision). `past_due` granted
--    its tier with NO time bound — and Razorpay's terminal `halted`
--    mapped into it, so a halted subscription granted Pro forever.
--    Genuine retry states now carry an explicit deadline
--    (current_period_end + 14d, written by the webhook handler);
--    terminal provider states drop entitlement immediately. NULL means
--    "no deadline applies" (an `active` subscription).
ALTER TABLE "subscriptions" ADD COLUMN "entitlement_ends_at" timestamptz;
--> statement-breakpoint

-- 3. Monotonic arrival order (2026-07-20 schema followup). The
--    staleness guard ordered same-provider-timestamp events by
--    `created_at`, which is transaction-scoped `now()` — two rows in
--    quick succession tie, and `gen_random_uuid()` cannot break the
--    tie. `arrival_seq` is a total order on arrival; ties disappear
--    and the guard's ambiguous-order branch is deleted.
ALTER TABLE "subscription_events" ADD COLUMN "arrival_seq" bigint GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_events_arrival_seq_uniq" ON "subscription_events" ("arrival_seq");
--> statement-breakpoint

-- 4. Cross-device pending checkout (B7 half two / 2026-07-20 BE-field
--    followup). Between provider checkout.completed and the webhook
--    grant there is no subscriptions row, so nothing server-side could
--    tell a second device a payment is in flight. One row per
--    workspace, refreshed on re-open, cleared by the webhook grant or
--    expiry sweep. Metadata only — no payment details (D7 posture).
CREATE TABLE "pending_checkouts" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "provider" "billing_provider" NOT NULL,
  "tier" "workspace_tier" NOT NULL,
  "billing_cycle" "billing_cycle" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_checkouts_expires_idx" ON "pending_checkouts" ("expires_at");
--> statement-breakpoint
-- Deny-anon RLS posture (0026/0049 precedent): every public table has
-- RLS enabled; the service role connects as table owner and bypasses.
ALTER TABLE "pending_checkouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 5. One live billing subscription per workspace (audit B7). The
--    predicate deliberately EXCLUDES 'paused': the strict variant
--    forbids a state that already exists (two paused rows on the
--    founder workspace) and the A6 read test seeds active+paused by
--    design. The failure mode that made exclusion "strictly worse than
--    no index" — a provider-initiated resume rejected forever, charge
--    recorded nowhere — is handled loudly instead: `arrival_seq`
--    ordering + the reconciler flag the rejected write for manual
--    resolution (see billing-reconciliation.worker.ts), and #417's
--    resume guard closes the user-initiated path.
CREATE UNIQUE INDEX "subscriptions_one_live_per_workspace"
  ON "subscriptions" ("workspace_id")
  WHERE "status" IN ('active', 'past_due');
