#!/usr/bin/env bash
# scripts/classify-failed-syncs.sh
#
# Splits check-sync-failed.sh rows into "needs reconnect" and real
# failures. A needs-reconnect row is counted in the job summary and does
# not fail the run. Every other row still goes through
# scripts/filter-known-stuck.sh, so scripts/known-stuck-mailboxes.tsv
# keeps working.
#
# A row needs reconnect when its readiness is `needs_reconnect`, or when
# its error_code is one of INITIAL_SYNC_RECONNECT_ERROR_CODES. That list
# is read from packages/shared/src/contracts/initial-sync-recovery.ts.
# An empty or unreadable list is exit 2 — not "nothing to report".
#
# Input (stdin), tab-separated:
#   mailbox_account_id, stuck_since, error_code, stuck_seconds, readiness_status
# The readiness column is optional so a pre-status row still classifies
# on error_code. Non-reconnect rows are forwarded without it.
#
# Exit: filter-known-stuck.sh's code (0 none new, 1 new failure, 2 the
# acknowledgement list or this classification cannot be read).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODES_FILE="${RECONNECT_CODES_FILE:-$ROOT/packages/shared/src/contracts/initial-sync-recovery.ts}"
TAB="$(printf '\t')"

if [ ! -r "$CODES_FILE" ]; then
  echo "::error title=Reconnect classification unreadable::${CODES_FILE} is missing — the watchdog cannot tell a revoked Gmail grant from a real sync failure."
  exit 2
fi

# Names inside `export const INITIAL_SYNC_RECONNECT_ERROR_CODES = [ ... ]`.
# Stop at the closing bracket so a later array in the same file is not
# swallowed. Zero names means the extractor missed the list.
# Only array entries (`  'Name',`). A comment inside the array can quote
# a different string; that must not become a classification.
CODES="$(awk '
  /export const INITIAL_SYNC_RECONNECT_ERROR_CODES/ { grab = 1; next }
  grab && /^[[:space:]]*\]/ { exit }
  grab && /^[[:space:]]*'\''[^'\'']+'\''/ {
    line = $0
    if (match(line, /'\''[^'\'']+'\''/)) {
      print substr(line, RSTART + 1, RLENGTH - 2)
    }
  }
' "$CODES_FILE")"

if [ -z "$CODES" ]; then
  echo "::error title=Reconnect classification empty::${CODES_FILE} did not yield INITIAL_SYNC_RECONNECT_ERROR_CODES — the watchdog cannot tell a revoked Gmail grant from a real sync failure."
  exit 2
fi

is_reconnect_code() {
  local code="$1" known
  [ -z "$code" ] && return 1
  while IFS= read -r known; do
    [ "$code" = "$known" ] && return 0
  done <<EOF
$CODES
EOF
  return 1
}

reconnect=0
actionable="$(mktemp)"
trap 'rm -f "$actionable"' EXIT

# `read` with a tab IFS collapses an empty error_code (consecutive tabs
# are one delimiter), which would drop `needs_reconnect` off the row and
# page it as a new failure. Split on each tab so a blank code stays blank.
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  id="${line%%"$TAB"*}"
  rest="${line#*"$TAB"}"
  since="${rest%%"$TAB"*}"
  rest="${rest#*"$TAB"}"
  code="${rest%%"$TAB"*}"
  rest="${rest#*"$TAB"}"
  if [[ "$rest" == *"$TAB"* ]]; then
    seconds="${rest%%"$TAB"*}"
    readiness="${rest#*"$TAB"}"
  else
    seconds="$rest"
    readiness=""
  fi
  [ -z "$id" ] && continue
  if [ "$readiness" = "needs_reconnect" ] || is_reconnect_code "$code"; then
    reconnect=$((reconnect + 1))
  else
    printf '%s\t%s\t%s\t%s\n' "$id" "$since" "$code" "$seconds" >>"$actionable"
  fi
done

summary="Needs reconnect: ${reconnect}. These mailboxes are waiting on the user to reconnect Gmail; they are not a sync failure."
echo "$summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
fi
if [ "$reconnect" -gt 0 ]; then
  echo "::notice title=Needs reconnect::${reconnect} mailbox(es) waiting on a Gmail reconnect"
fi

set +e
if [ -s "$actionable" ]; then
  "$(dirname "$0")/filter-known-stuck.sh" <"$actionable"
else
  "$(dirname "$0")/filter-known-stuck.sh" </dev/null
fi
RC=$?
set -e
exit "$RC"
