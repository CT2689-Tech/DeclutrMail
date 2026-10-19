-- Template for the LOCAL-ONLY launch-funnel runner, not a production query.
-- The helper validates and fills timestamps/UUIDs before execution.
-- Accounts outside the provisional internal filter are not verified customers.
-- Timing requires a positive, completed forward job and its matching manual
-- activity timestamp. Job creation is not completion; preview is not proved.
-- Days mean 24 elapsed hours, independent of session timezone/DST.
-- All windows are half-open. A rate includes only accounts observed through
-- the end of that window. No mature denominator means NULL, never 0%.
-- Archive/Delete email effects are gross completed work, not monthly quota.
-- Purchase telemetry is separate from authoritative billing reconciliation.

WITH params AS (
  SELECT '__COHORT_START__'::timestamptz AS cohort_start,
         '__COHORT_END__'::timestamptz AS cohort_end,
         '__OBSERVED_AT__'::timestamptz AS observed_at,
         ARRAY[]::uuid[] AS extra_user_ids
),
eligible AS (
  SELECT u.id, u.created_at
  FROM users u CROSS JOIN params p
  WHERE u.created_at >= p.cohort_start AND u.created_at < p.cohort_end
    AND NOT (
      u.email ILIKE 'admin@declutrmail.ai'
      OR u.email ILIKE 'chintan%'
      OR u.email ILIKE 'nayana%'
      OR u.id = ANY (p.extra_user_ids)
    )
),
observed_events AS (
  SELECT e.*
  FROM product_events e JOIN eligible u ON u.id = e.user_id CROSS JOIN params p
  WHERE e.occurred_at >= u.created_at AND e.occurred_at < p.observed_at
),
connected AS (
  SELECT user_id, min(occurred_at) AS occurred_at
  FROM observed_events WHERE event = 'gmail_connected' GROUP BY user_id
),
ready AS (
  SELECT DISTINCT ON (user_id) user_id, occurred_at, (props->>'duration_s')::numeric AS duration_s
  FROM observed_events WHERE event = 'first_sync_ready'
  ORDER BY user_id, occurred_at, id
),
failed AS (
  SELECT DISTINCT user_id FROM observed_events WHERE event = 'first_sync_failed_terminal'
),
cleanup AS (
  SELECT j.id, m.user_id, j.verb, j.affected_count, min(a.occurred_at) AS completed_at
  FROM action_jobs j
  JOIN mailbox_accounts m ON m.id = j.mailbox_account_id
  JOIN eligible u ON u.id = m.user_id
  CROSS JOIN params p
  LEFT JOIN activity_log a ON a.action_job_id = j.id
    AND a.mailbox_account_id = j.mailbox_account_id
    AND a.action::text = j.verb::text AND a.source = 'manual' AND a.affected_count > 0
    AND a.occurred_at >= j.created_at AND a.occurred_at < p.observed_at
  WHERE j.direction = 'forward' AND j.status = 'done' AND j.affected_count > 0
    AND j.verb IN ('archive', 'later', 'delete') AND j.created_at < p.observed_at
  GROUP BY j.id, m.user_id
),
per_account AS (
  SELECT u.id, u.created_at, g.occurred_at AS connected_at, r.occurred_at AS ready_at,
    EXISTS (SELECT 1 FROM cleanup c WHERE c.user_id = u.id
      AND c.completed_at >= u.created_at AND c.completed_at < u.created_at + interval '24 hours') AS cleanup_24h,
    EXISTS (SELECT 1 FROM cleanup c WHERE c.user_id = u.id
      AND c.completed_at >= u.created_at + interval '168 hours'
      AND c.completed_at < u.created_at + interval '192 hours') AS cleanup_d7,
    EXISTS (SELECT 1 FROM cleanup c WHERE c.user_id = u.id
      AND c.completed_at >= g.occurred_at
      AND c.completed_at < g.occurred_at + interval '24 hours') AS connected_cleanup_24h,
    (SELECT coalesce(sum(c.affected_count), 0) FROM cleanup c WHERE c.user_id = u.id
      AND c.verb IN ('archive', 'delete') AND c.completed_at >= u.created_at
      AND c.completed_at < u.created_at + interval '168 hours') AS archive_delete_emails_7d
  FROM eligible u LEFT JOIN connected g ON g.user_id = u.id LEFT JOIN ready r ON r.user_id = u.id
),
counts AS (
  SELECT count(*) AS eligible_accounts,
    count(*) FILTER (WHERE created_at + interval '2 hours' <= p.observed_at) AS sync_2h_eligible_accounts,
    count(*) FILTER (WHERE created_at + interval '2 hours' <= p.observed_at
      AND ready_at < created_at + interval '2 hours') AS first_sync_ready_2h_event_accounts,
    count(*) FILTER (WHERE created_at + interval '24 hours' <= p.observed_at) AS cleanup_24h_eligible_accounts,
    count(*) FILTER (WHERE created_at + interval '24 hours' <= p.observed_at AND cleanup_24h) AS first_completed_cleanup_24h_accounts,
    count(*) FILTER (WHERE created_at + interval '192 hours' <= p.observed_at) AS d7_eligible_accounts,
    count(*) FILTER (WHERE created_at + interval '192 hours' <= p.observed_at AND cleanup_d7) AS d7_completed_cleanup_accounts,
    count(connected_at) AS connection_event_accounts,
    count(*) FILTER (WHERE connected_at + interval '24 hours' <= p.observed_at) AS connection_24h_eligible_accounts,
    count(*) FILTER (WHERE connected_at + interval '24 hours' <= p.observed_at AND connected_cleanup_24h) AS connection_to_completed_cleanup_24h_accounts,
    count(*) FILTER (WHERE created_at + interval '168 hours' <= p.observed_at) AS complete_7d_eligible_accounts,
    coalesce(sum(archive_delete_emails_7d) FILTER (WHERE created_at + interval '168 hours' <= p.observed_at), 0) AS archive_delete_emails_completed_7d
  FROM per_account CROSS JOIN params p
),
sync_outcomes AS (
  SELECT (SELECT count(*) FROM ready) AS ready_accounts,
    (SELECT count(*) FROM ready) +
    (SELECT count(*) FROM failed f WHERE NOT EXISTS (SELECT 1 FROM ready r WHERE r.user_id = f.user_id)) AS recorded_accounts
)
SELECT p.cohort_start, p.cohort_end, p.observed_at, c.*,
  c.first_sync_ready_2h_event_accounts::numeric / nullif(c.sync_2h_eligible_accounts, 0) AS first_sync_ready_2h_event_rate,
  c.first_completed_cleanup_24h_accounts::numeric / nullif(c.cleanup_24h_eligible_accounts, 0) AS first_completed_cleanup_24h_rate,
  c.d7_completed_cleanup_accounts::numeric / nullif(c.d7_eligible_accounts, 0) AS d7_completed_cleanup_rate,
  c.connection_to_completed_cleanup_24h_accounts::numeric / nullif(c.connection_24h_eligible_accounts, 0) AS connection_to_completed_cleanup_24h_rate,
  s.recorded_accounts AS recorded_sync_outcome_accounts,
  s.ready_accounts::numeric / nullif(s.recorded_accounts, 0) AS recorded_sync_success_rate,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_s) FROM ready) AS recorded_first_sync_p50_s,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_s) FROM ready) AS recorded_first_sync_p90_s,
  (SELECT count(*) FROM cleanup WHERE completed_at IS NULL) AS cleanup_jobs_without_observed_manual_completion,
  (SELECT count(DISTINCT user_id) FROM observed_events WHERE event = 'checkout_created') AS checkout_event_accounts,
  (SELECT count(DISTINCT user_id) FROM observed_events WHERE event = 'purchase_confirmed') AS purchase_event_accounts,
  (SELECT count(*) FROM observed_events WHERE event = 'free_cap_hit') AS free_cap_hit_events,
  (SELECT count(*) FROM observed_events WHERE event = 'purchase_confirmed' AND props->>'plan' = 'pass') AS pass_purchase_events,
  (SELECT count(*) FROM observed_events WHERE event = 'purchase_confirmed' AND props->>'plan' = 'plus') AS plus_purchase_events,
  (SELECT count(*) FROM product_events e WHERE e.user_id IS NULL AND e.event = 'purchase_confirmed'
    AND e.occurred_at >= p.cohort_start AND e.occurred_at < p.observed_at) AS unattributed_purchase_events_in_observation_range,
  NULL::int AS verified_external_paying_customers
FROM counts c CROSS JOIN params p CROSS JOIN sync_outcomes s;
