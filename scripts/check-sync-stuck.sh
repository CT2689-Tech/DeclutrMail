#!/usr/bin/env bash
# scripts/check-sync-stuck.sh
#
# Detects mailbox syncs that are queued/syncing/connecting but haven't
# made progress in > STUCK_MINUTES minutes. Exit code 1 if any stuck
# row is found — that's the signal a watchdog (GH Actions cron, Cloud
# Run Job, etc.) reads to fire an alert.
#
# Default stuck threshold: 5 minutes (D224's documented worker tick is
# every ~30 s; a sync that hasn't ticked in 5 min is structurally
# stuck, not slow).
#
# Privacy (D7 / D228): reads ONLY `provider_sync_state` rows. Surfaces
# `mailbox_account_id`, `current_stage`, `progress_pct`, `updated_at`
# in the alert. NEVER reads `mail_messages` / `senders` rows.
#
# Auth: `SUPABASE_SESSION_DSN` env var (same secret the Atlas migration
# workflow uses). `psql` reads it via libpq. The session pooler (port
# 5432) is required for advisory locks — Atlas uses it too, so the
# same DSN works.

set -euo pipefail

STUCK_MINUTES="${STUCK_MINUTES:-5}"

if [ -z "${SUPABASE_SESSION_DSN:-}" ]; then
  echo "::error::SUPABASE_SESSION_DSN env not set" >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "::error::psql not on PATH" >&2
  exit 2
fi

# Stuck = `current_stage` in {queued, connecting, syncing} AND
# `updated_at` is older than the threshold AND `progress_pct < 100`.
# `ready` and `failed` are terminal states; they should never trip the
# check. `disconnected` rows are surfaced separately via the FE
# reconnect gate; intentionally excluded here.
QUERY=$(cat <<EOF
SELECT
  mailbox_account_id,
  current_stage,
  progress_pct,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS stuck_seconds
FROM provider_sync_state
WHERE current_stage IN ('queued', 'connecting', 'syncing')
  AND progress_pct < 100
  AND updated_at < NOW() - INTERVAL '${STUCK_MINUTES} minutes'
ORDER BY updated_at ASC;
EOF
)

OUT=$(psql "${SUPABASE_SESSION_DSN}?sslmode=require" \
  -At -F $'\t' --quiet \
  -c "$QUERY" 2>&1)

if [ -z "$OUT" ]; then
  echo "OK — no stuck syncs found (threshold ${STUCK_MINUTES} min)."
  exit 0
fi

# Emit a structured log line that Cloud Logging can pick up if this
# script also runs as a Cloud Run Job. The leading `::error::` token
# also surfaces as a red annotation in GH Actions runs.
echo "::error::Stuck sync detected — ${STUCK_MINUTES} min threshold exceeded"
echo ""
echo "Stuck rows:"
printf "%s\n" "$OUT"
echo ""
echo "Each row: mailbox_account_id | current_stage | progress_pct | updated_at | stuck_seconds"

exit 1
