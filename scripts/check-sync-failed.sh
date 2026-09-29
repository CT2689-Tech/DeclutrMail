#!/usr/bin/env bash
# scripts/check-sync-failed.sh
#
# Detects mailboxes whose INITIAL sync reached the TERMINAL
# `readiness_status='failed'` state and has sat there, unretried, for
# longer than STUCK_FAILED_HOURS. Exit code 1 if any such row is found —
# the signal a watchdog (GH Actions cron) reads to fire an alert.
#
# Initial-sync only. `readiness_status` is the InitialSync UI's enum —
# `IncrementalSyncWorker.onTerminalFailure` (packages/workers/src/
# incremental-sync.worker.ts) deliberately never touches it (flipping it
# on an already-onboarded mailbox would mis-route the user back to
# /onboarding); it writes `last_incremental_error_at` /
# `last_incremental_error_code` instead, and the 5-min cron drift sweep
# retries from there — a different signal, a different recovery story,
# and a real gap this script does not cover (architecture-guardian
# review, 2026-09-02 fix).
#
# Why this is a SEPARATE check from check-sync-stuck.sh: that script's
# query explicitly excludes `current_stage='failed'` (`current_stage NOT
# IN ('ready', 'failed')`) — it only detects wedged/hung syncs, never
# terminal failures. A mailbox that reaches `failed` is invisible to it
# by design, and recovery from `failed` is entirely manual today (the
# frontend's "Try again" button, or the sync-failed email's retry link —
# `initial-sync-reconciler.ts` only re-enqueues `queued` and stale
# `syncing` rows, never `failed`). Incident 2026-09-02: two first-run
# signups tripped a Gmail RateLimitError, dead-lettered, and neither
# ever came back — nothing alerted because no check looks at `failed`.
#
# Default threshold: 2 hours. The in-app "Try again" copy tells the user
# a minute is usually enough, so a mailbox still `failed` after 2 hours
# means the user never saw (or never acted on) the recovery path — worth
# a founder look, not an automatic retry (retrying blind here would just
# replay whatever tripped it originally).
#
# Known vs new: rows acknowledged in scripts/known-stuck-mailboxes.tsv
# (matched on mailbox AND stuck-since instant) print as warnings; only an
# unacknowledged row fails the run — see scripts/filter-known-stuck.sh.
#
# Privacy (D7 / D228): reads ONLY `provider_sync_state`. Surfaces
# `mailbox_account_id`, `error_code`, `updated_at`, `stuck_seconds`.
# NEVER reads `mail_messages` / `senders` / `triage_decisions`.
#
# Auth: `SUPABASE_SESSION_DSN` env var — same secret + connection shape
# as check-sync-stuck.sh.

set -euo pipefail

STUCK_FAILED_HOURS="${STUCK_FAILED_HOURS:-2}"

if [ -z "${SUPABASE_SESSION_DSN:-}" ]; then
  echo "::error::SUPABASE_SESSION_DSN env not set" >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "::error::psql not on PATH" >&2
  exit 2
fi

QUERY=$(cat <<EOF
SELECT
  mailbox_account_id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stuck_since,
  error_code,
  EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS stuck_seconds
FROM provider_sync_state
WHERE readiness_status = 'failed'
  AND updated_at < NOW() - INTERVAL '${STUCK_FAILED_HOURS} hours'
ORDER BY updated_at ASC;
EOF
)

# Same CR/LF stripping + sslmode append as check-sync-stuck.sh — a
# `gh secret set` pipe can smuggle a newline into the DSN, which makes
# psql reject the URI outright.
DSN="$(printf '%s' "${SUPABASE_SESSION_DSN}" | tr -d '\r\n')"
case "$DSN" in
  *\?*) DSN="${DSN}&sslmode=require" ;;
  *)    DSN="${DSN}?sslmode=require" ;;
esac

# psql failure MUST surface as a distinct config/connection error (exit
# 2), never as a "no failed syncs" exit 0 — an unreachable DB is not
# evidence nothing is stuck (CLAUDE.md "a guard that cannot fail is not
# a guard").
PSQL_ERR="$(mktemp)"
set +e
OUT=$(psql "$DSN" \
  -At -F $'\t' --quiet \
  -c "$QUERY" 2>"$PSQL_ERR")
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  echo "::error::psql failed (exit $RC) — watchdog could NOT check; this is a config/connection problem, not a clean-bill-of-health signal" >&2
  sed 's/^/  psql: /' "$PSQL_ERR" >&2 || true
  rm -f "$PSQL_ERR"
  exit 2
fi
rm -f "$PSQL_ERR"

# Every run goes through the known-stuck filter, rows or not, so a broken
# scripts/known-stuck-mailboxes.tsv fails the run the day it lands rather
# than the day the next mailbox gets stuck. Red means a failed sync that
# nobody has acknowledged yet; acknowledged ones stay listed as warnings.
set +e
if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi | "$(dirname "$0")/filter-known-stuck.sh"
RC=$?
set -e

case "$RC" in
  0)
    if [ -z "$OUT" ]; then
      echo "OK — no unretried failed syncs found (threshold ${STUCK_FAILED_HOURS}h)."
    else
      echo "OK — no NEW unretried failed sync (threshold ${STUCK_FAILED_HOURS}h); every one above is acknowledged in scripts/known-stuck-mailboxes.tsv."
    fi
    exit 0
    ;;
  1)
    echo "::error::New unretried failed sync — ${STUCK_FAILED_HOURS}h threshold exceeded"
    echo "Details per row: error_code | stuck_seconds"
    exit 1
    ;;
  *) exit 2 ;;
esac
