#!/usr/bin/env bash
# scripts/check-sync-stuck.sh
#
# Detects mailbox syncs that are queued/syncing/connecting but haven't
# made progress in > STUCK_MINUTES minutes. Exit code 1 if any stuck
# row is found — that's the signal a watchdog (GH Actions cron, Cloud
# Run Job, etc.) reads to fire an alert.
#
# Default stuck threshold: 10 minutes (raised from 5 on 2026-09-02: a
# `perMailboxPolicy` retry can now legitimately wait up to
# `rateLimitMaxDelayMs` = 5 min mid-backoff on a RateLimitError with
# `updated_at` frozen the whole time — see rate-limit-backoff.ts — so 5
# min was tight enough to page this watchdog for a mailbox correctly
# backing off, not actually stuck).
#
# Known vs new: rows acknowledged in scripts/known-stuck-mailboxes.tsv
# print as warnings; only an unacknowledged row fails the run — see
# scripts/filter-known-stuck.sh.
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

STUCK_MINUTES="${STUCK_MINUTES:-10}"

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
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stuck_since,
  current_stage,
  progress_pct,
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

# Every run goes through the known-stuck filter, rows or not, so a broken
# scripts/known-stuck-mailboxes.tsv fails the run the day it lands. Red
# means a stuck sync nobody has acknowledged yet; acknowledged ones stay
# listed as warnings.
set +e
if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi | "$(dirname "$0")/filter-known-stuck.sh"
RC=$?
set -e

case "$RC" in
  0)
    if [ -z "$OUT" ]; then
      echo "OK — no stuck syncs found (threshold ${STUCK_MINUTES} min)."
    else
      echo "OK — no NEW stuck sync (threshold ${STUCK_MINUTES} min); every one above is acknowledged in scripts/known-stuck-mailboxes.tsv."
    fi
    exit 0
    ;;
  1)
    echo "::error::New stuck sync — ${STUCK_MINUTES} min threshold exceeded"
    echo "Details per row: current_stage | progress_pct | stuck_seconds"
    exit 1
    ;;
  *) exit 2 ;;
esac
