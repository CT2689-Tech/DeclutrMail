#!/usr/bin/env bash
# scripts/sync-history.sh
#
# Prints recent `sync_runs` rows — the per-run history of
# InitialSyncWorker (F002). This is the "how did that sync go?" reader:
# how long it took, which stage was slow, how many messages Gmail
# refused, how many attempts it burned, and why it failed.
#
# `scripts/check-sync-stuck.sh` is the complementary tool and answers a
# different question: it watches `provider_sync_state` for syncs that
# are stuck RIGHT NOW. This one is history, and only finished runs
# appear — a sync that never reached a terminal disposition has no row
# here by design (see packages/db/src/schema/sync-runs.ts).
#
# Usage:
#   ./scripts/sync-history.sh                    last 20 runs, all mailboxes
#   ./scripts/sync-history.sh 50                 last 50 runs
#   ./scripts/sync-history.sh 50 <mailbox-uuid>  last 50 for one mailbox
#
# Privacy (D7 / D228): reads ONLY `sync_runs`. Every column is a count,
# a duration, a status or a worker error class name. It surfaces
# `mailbox_account_id` and never joins to an email address — the same
# posture check-sync-stuck.sh keeps.
#
# Auth: `SUPABASE_SESSION_DSN` (the secret the Atlas migration workflow
# uses). `psql` reads it via libpq.

set -euo pipefail

LIMIT="${1:-20}"
MAILBOX="${2:-}"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "error: limit must be a number, got '${LIMIT}'" >&2
  exit 2
fi
if [ -n "$MAILBOX" ] && ! [[ "$MAILBOX" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "error: mailbox must be a UUID, got '${MAILBOX}'" >&2
  exit 2
fi

if [ -z "${SUPABASE_SESSION_DSN:-}" ]; then
  echo "error: SUPABASE_SESSION_DSN env not set" >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not on PATH" >&2
  exit 2
fi

# NULL is rendered as 'n/a' rather than 0 on purpose: a failed run
# reports UNKNOWN counts, and printing 0 would claim the mailbox synced
# nothing when it may have synced 60k messages before throwing.
FILTER=""
if [ -n "$MAILBOX" ]; then
  FILTER="WHERE mailbox_account_id = '${MAILBOX}'"
fi

QUERY=$(cat <<EOF
SELECT
  finished_at,
  mailbox_account_id,
  status,
  attempts,
  COALESCE(messages_synced::text, 'n/a')               AS messages_synced,
  COALESCE(senders_indexed::text, 'n/a')               AS senders_indexed,
  COALESCE(unreadable::text, 'n/a')                    AS unreadable,
  COALESCE(final_attempt_duration_ms::text, 'n/a')     AS last_try_ms,
  COALESCE(final_attempt_gmail_api_calls::text, 'n/a') AS last_try_api_calls,
  COALESCE(final_attempt_stage_timings::text, 'n/a')   AS last_try_stages,
  COALESCE(error_code, '')                             AS error_code
FROM sync_runs
${FILTER}
ORDER BY finished_at DESC
LIMIT ${LIMIT};
EOF
)

# Strip stray CR/LF a `gh secret set` pipe can smuggle into the DSN, then
# default to TLS. An explicit sslmode in the DSN WINS — libpq takes the
# last occurrence, so blindly appending would silently override a
# caller who asked for `sslmode=disable` (which is how this runs against
# a local Postgres that has no TLS at all).
DSN="$(printf '%s' "${SUPABASE_SESSION_DSN}" | tr -d '\r\n')"
case "$DSN" in
  *sslmode=*) ;;
  *\?*) DSN="${DSN}&sslmode=require" ;;
  *)    DSN="${DSN}?sslmode=require" ;;
esac

# A connection failure must never read as "no runs found". Distinct
# exit 2, stderr kept separate from rows.
PSQL_ERR="$(mktemp)"
set +e
OUT=$(psql "$DSN" --quiet -P expanded=auto -c "$QUERY" 2>"$PSQL_ERR")
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  echo "error: psql failed (exit $RC) — this is a config/connection problem, not an empty history" >&2
  sed 's/^/  psql: /' "$PSQL_ERR" >&2 || true
  rm -f "$PSQL_ERR"
  exit 2
fi
rm -f "$PSQL_ERR"

printf "%s\n" "$OUT"
echo ""
echo "n/a = not measured (a failed run returns no counts), not zero."
echo "messages_synced / senders_indexed are CUMULATIVE — the mailbox when the run ended."
echo "last_try_* cover the final attempt ONLY. A resume re-fetches nothing, so on any"
echo "row with attempts > 1 they are cheaper and faster than the run really was."
echo "For whether an account is struggling, read attempts — not the timings."
echo "In-flight and stuck syncs are NOT here — use ./scripts/check-sync-stuck.sh."
