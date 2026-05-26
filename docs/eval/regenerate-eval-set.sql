-- Regenerate docs/eval/sender-classification-eval-set.csv from the
-- current local DB. Run from repo root:
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d declutrmail -P pager=off \
--     -f docs/eval/regenerate-eval-set.sql \
--     > docs/eval/sender-classification-eval-set.csv
--
-- Outputs 165-ish rows (100 top-volume + ~15 important + 50 random-tail).
-- Schema = the SenderSignals fields the cascade in
-- packages/workers/src/score-cascade.ts needs, plus three empty label
-- columns (desired_action, desired_reason, notes) for manual labeling.

COPY (
  WITH msg_agg AS (
    SELECT
      s.id, s.display_name, s.domain, s.gmail_category,
      s.first_seen_at, s.last_seen_at,
      COUNT(m.*) AS total_messages,
      COUNT(*) FILTER (WHERE m.is_outbound) AS replies_sent,
      COUNT(*) FILTER (WHERE NOT m.is_unread AND NOT m.is_outbound) AS read_all_time,
      COUNT(*) FILTER (WHERE NOT m.is_outbound AND m.internal_date >= NOW() - INTERVAL '90 days') AS msgs_90d,
      COUNT(*) FILTER (WHERE NOT m.is_unread AND NOT m.is_outbound AND m.internal_date >= NOW() - INTERVAL '90 days') AS read_90d,
      COUNT(*) FILTER (WHERE NOT m.is_outbound AND m.internal_date >= NOW() - INTERVAL '30 days') AS msgs_30d,
      COUNT(*) FILTER (WHERE NOT m.is_outbound AND m.internal_date >= NOW() - INTERVAL '90 days' AND m.internal_date < NOW() - INTERVAL '30 days') AS msgs_30_90d,
      COUNT(*) FILTER (WHERE NOT m.is_outbound AND 'STARRED' = ANY(m.label_ids) AND m.internal_date >= NOW() - INTERVAL '1 year') AS starred_year,
      COUNT(*) FILTER (WHERE NOT m.is_outbound AND 'IMPORTANT' = ANY(m.label_ids)) AS important_count,
      BOOL_OR(m.unsubscribe_url IS NOT NULL OR m.unsubscribe_one_click) AS has_unsub
    FROM senders s
    LEFT JOIN mail_messages m
      ON m.mailbox_account_id = s.mailbox_account_id AND m.sender_key = s.sender_key
    GROUP BY s.id, s.display_name, s.domain, s.gmail_category, s.first_seen_at, s.last_seen_at
  ),
  features AS (
    SELECT
      id, display_name, domain, gmail_category::text,
      total_messages, replies_sent, starred_year, important_count,
      msgs_90d, msgs_30d, has_unsub,
      EXTRACT(DAY FROM NOW() - first_seen_at)::int AS first_seen_days,
      (EXTRACT(YEAR FROM AGE(NOW(), first_seen_at)) * 12 + EXTRACT(MONTH FROM AGE(NOW(), first_seen_at)))::int AS first_seen_months,
      EXTRACT(DAY FROM NOW() - last_seen_at)::int AS last_seen_days,
      ROUND(msgs_90d::numeric / 3, 1) AS monthly_volume,
      CASE WHEN msgs_30_90d > 0 THEN ROUND(msgs_30d::numeric / (msgs_30_90d::numeric / 2), 2) ELSE 1.0 END AS spike_ratio,
      CASE WHEN msgs_90d > 0 THEN ROUND(read_90d::numeric / msgs_90d, 3) ELSE 0 END AS read_rate_90d,
      CASE WHEN total_messages > 0 THEN ROUND(read_all_time::numeric / total_messages, 3) ELSE 0 END AS read_rate_all
    FROM msg_agg
  ),
  ranked AS (
    SELECT id, 'top_volume'::text AS sample_band, ROW_NUMBER() OVER (ORDER BY total_messages DESC) AS rn
    FROM features WHERE total_messages > 0
  ),
  top100 AS (SELECT id, sample_band FROM ranked WHERE rn <= 100),
  important_signals AS (
    SELECT f.id, 'important'::text AS sample_band
    FROM features f
    WHERE (f.replies_sent > 0 OR f.starred_year > 0 OR f.important_count > 0)
      AND f.id NOT IN (SELECT id FROM top100)
    ORDER BY RANDOM() LIMIT 20
  ),
  random_tail AS (
    SELECT f.id, 'random_tail'::text AS sample_band
    FROM features f
    WHERE f.id NOT IN (SELECT id FROM top100)
      AND f.id NOT IN (SELECT id FROM important_signals)
    ORDER BY RANDOM() LIMIT 50
  ),
  eval_set AS (
    SELECT * FROM top100
    UNION ALL SELECT * FROM important_signals
    UNION ALL SELECT * FROM random_tail
  )
  SELECT
    e.sample_band,
    f.display_name,
    f.domain,
    f.gmail_category,
    f.total_messages,
    f.monthly_volume,
    f.msgs_90d,
    f.msgs_30d,
    f.read_rate_90d,
    f.read_rate_all,
    f.replies_sent,
    f.starred_year,
    f.important_count,
    f.has_unsub,
    f.spike_ratio,
    f.first_seen_months,
    f.first_seen_days,
    f.last_seen_days,
    ''::text AS desired_action,
    ''::text AS desired_reason,
    ''::text AS notes
  FROM eval_set e
  JOIN features f ON f.id = e.id
  ORDER BY
    CASE e.sample_band WHEN 'top_volume' THEN 1 WHEN 'important' THEN 2 ELSE 3 END,
    f.total_messages DESC
) TO STDOUT WITH CSV HEADER;
