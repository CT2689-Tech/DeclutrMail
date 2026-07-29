-- Launch-audit B7 — at most ONE live subscription per workspace.
--
-- Before this index the only guard was a non-transactional
-- SELECT-then-throw at checkout creation (`SUBSCRIPTION_EXISTS`,
-- billing.service.ts). Two checkouts completing for one workspace —
-- the cross-device case, where the browser-local pending-checkout lock
-- cannot see the other device — each mint a DISTINCT provider
-- subscription id, so both rows insert cleanly past the existing
-- (provider, provider_subscription_id) unique. From there the damage
-- is silent: `recomputeWorkspaceTier` grants the max rank, the billing
-- screen renders whichever row it picks, and cancel targets only
-- `ORDER BY updated_at DESC LIMIT 1` — so the second subscription keeps
-- charging with no surface that mentions it.
--
-- 'canceled' and 'incomplete' are deliberately EXCLUDED from the
-- predicate: a workspace that cancels and later resubscribes must keep
-- its history, and only the states that actually grant entitlement or
-- bill money are constrained.
--
-- This index will FAIL to build if a workspace already holds two live
-- rows. That is intended — a duplicate is a live double-billing
-- situation and picking which one survives is a billing decision, not
-- something a migration may take silently. Pre-flight:
--
--   SELECT workspace_id, count(*) FROM subscriptions
--   WHERE status IN ('active','past_due','paused')
--   GROUP BY 1 HAVING count(*) > 1;

CREATE UNIQUE INDEX "subscriptions_one_live_per_workspace_uniq"
  ON "subscriptions" ("workspace_id")
  WHERE "status" IN ('active', 'past_due', 'paused');
