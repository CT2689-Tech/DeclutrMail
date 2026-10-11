-- Launch funnel aggregates. Paste into psql against a LOCAL database only.
-- The TypeScript runner refuses any non-local DSN.
--
-- Internal accounts are excluded here: admin@declutrmail.ai, chintan%, nayana%,
-- plus extra user ids supplied by the runner. The SELECT list is counts and
-- buckets. It does not return email addresses.
--
-- Free-allowance proximity sums affected_count on forward, non-failed
-- cleanup action_jobs in the first 7 days. That is not the in-app meter,
-- which counts distinct senders. free_cap_hit is the meter signal.
-- D7 is an action in the window [signup + 7 days, signup + 8 days).
-- free_allowance must match TIER_MANIFEST.free.cleanupActionsPerMonth.

WITH params AS (
  SELECT 50::int AS free_allowance, ARRAY[]::uuid[] AS extra_user_ids
),
eligible AS (
  SELECT u.id, u.created_at, u.workspace_id
  FROM users u
  CROSS JOIN params p
  WHERE NOT (
    u.email ILIKE 'admin@declutrmail.ai'
    OR u.email ILIKE 'chintan%'
    OR u.email ILIKE 'nayana%'
    OR u.id = ANY (p.extra_user_ids)
  )
),
cleanup AS (
  SELECT m.user_id, j.created_at, j.affected_count
  FROM action_jobs j
  JOIN mailbox_accounts m ON m.id = j.mailbox_account_id
  WHERE j.direction = 'forward'
    AND j.status <> 'failed'
    AND j.verb IN ('archive', 'later', 'delete', 'unsubscribe')
),
ready AS (
  SELECT e.user_id, min(e.occurred_at) AS occurred_at,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'duration_s')::numeric) AS p50,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY (e.props->>'duration_s')::numeric) AS p90
  FROM product_events e
  JOIN eligible u ON u.id = e.user_id
  WHERE e.event = 'first_sync_ready'
  GROUP BY e.user_id
),
failed AS (
  SELECT DISTINCT e.user_id
  FROM product_events e
  JOIN eligible u ON u.id = e.user_id
  WHERE e.event = 'first_sync_failed_terminal'
)
SELECT
  (SELECT count(*) FROM eligible) AS signups,
  (SELECT count(DISTINCT e.user_id) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'gmail_connected') AS connected,
  (SELECT count(*) FROM ready r JOIN eligible u ON u.id = r.user_id WHERE r.occurred_at <= u.created_at + interval '2 hours') AS first_sync_ready_2h,
  (SELECT count(DISTINCT c.user_id) FROM cleanup c JOIN eligible u ON u.id = c.user_id WHERE c.created_at <= u.created_at + interval '24 hours') AS first_action_24h,
  (SELECT count(DISTINCT c.user_id) FROM cleanup c JOIN eligible u ON u.id = c.user_id WHERE c.created_at >= u.created_at + interval '7 days' AND c.created_at < u.created_at + interval '8 days') AS d7_action,
  (SELECT count(DISTINCT e.user_id) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'checkout_created') AS checkout_created,
  (SELECT count(DISTINCT e.user_id) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'purchase_confirmed') AS paid,
  (SELECT CASE WHEN (SELECT count(*) FROM ready) + (SELECT count(*) FROM failed f WHERE NOT EXISTS (SELECT 1 FROM ready r WHERE r.user_id = f.user_id)) = 0 THEN NULL
    ELSE (SELECT count(*) FROM ready)::numeric
      / ((SELECT count(*) FROM ready) + (SELECT count(*) FROM failed f WHERE NOT EXISTS (SELECT 1 FROM ready r WHERE r.user_id = f.user_id)))
  END) AS first_sync_success_rate,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'duration_s')::numeric) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'first_sync_ready') AS first_sync_p50_s,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY (e.props->>'duration_s')::numeric) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'first_sync_ready') AS first_sync_p90_s,
  (SELECT count(DISTINCT u.id) FROM eligible u
    JOIN product_events g ON g.user_id = u.id AND g.event = 'gmail_connected'
    JOIN cleanup c ON c.user_id = u.id
    WHERE c.created_at <= g.occurred_at + interval '24 hours') AS connected_to_action_24h,
  (SELECT count(*) FROM eligible u
    JOIN workspaces w ON w.id = u.workspace_id AND w.tier = 'free'
    WHERE (
      SELECT COALESCE(sum(c.affected_count), 0) FROM cleanup c
      WHERE c.user_id = u.id AND c.created_at < u.created_at + interval '7 days'
    ) >= (SELECT free_allowance FROM params) * 0.8) AS free_near_allowance_7d,
  (SELECT count(*) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'free_cap_hit') AS free_cap_hit,
  (SELECT count(*) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'purchase_confirmed' AND e.props->>'plan' ILIKE 'pass%') AS pass_purchases,
  (SELECT count(*) FROM product_events e JOIN eligible u ON u.id = e.user_id WHERE e.event = 'purchase_confirmed' AND e.props->>'plan' ILIKE 'plus%') AS plus_purchases,
  (SELECT count(DISTINCT s.id) FROM subscriptions s JOIN eligible u ON u.workspace_id = s.workspace_id WHERE s.cancel_source = 'refund') AS refunds;
