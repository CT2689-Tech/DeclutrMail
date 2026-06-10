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

# Stuck = any NON-TERMINAL `current_stage` (terminal = ready | failed)
# whose `updated_at` is older than the threshold with `progress_pct
# < 100`. NOT IN keeps the check correct if in-flight stages are added
# to the enum later — the original allowlist hardcoded stage names
# ('connecting', 'syncing') that never existed in `sync_stage`, so
# Postgres rejected the query and the watchdog failed on every run
# since birth (2026-06-10 incident review; see MISTAKES.md).
QUERY=$(cat <<EOF
SELECT
  mailbox_account_id,
  current_stage,
  progress_pct,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS stuck_seconds
FROM provider_sync_state
WHERE current_stage NOT IN ('ready', 'failed')
  AND progress_pct < 100
  AND updated_at < NOW() - INTERVAL '${STUCK_MINUTES} minutes'
ORDER BY updated_at ASC;
EOF
)

# Strip stray CR/LF a `gh secret set` pipe can smuggle into the DSN
# (an embedded newline makes psql reject the URI with exit 1), and
# append sslmode without double-`?` if the DSN already has params.
DSN="$(printf '%s' "${SUPABASE_SESSION_DSN}" | tr -d '\r\n')"
case "$DSN" in
  *\?*) DSN="${DSN}&sslmode=require" ;;
  *)    DSN="${DSN}?sslmode=require" ;;
esac

# psql failure MUST surface as a distinct config/connection error (exit
# 2), never as a "stuck rows" exit 1 — and never silently via `set -e`
# killing the assignment. Stderr stays separate from row output.
PSQL_ERR="$(mktemp)"
set +e
OUT=$(psql "$DSN" \
  -At -F $'\t' --quiet \
  -c "$QUERY" 2>"$PSQL_ERR")
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  echo "::error::psql failed (exit $RC) — watchdog could NOT check; this is a config/connection problem, not a stuck-sync signal" >&2
  sed 's/^/  psql: /' "$PSQL_ERR" >&2 || true
  rm -f "$PSQL_ERR"
  exit 2
fi
rm -f "$PSQL_ERR"

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
