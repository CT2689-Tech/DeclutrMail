#!/usr/bin/env bash
# scripts/filter-known-stuck.sh
#
# Splits the sync watchdog's stuck rows into KNOWN (acknowledged in
# scripts/known-stuck-mailboxes.tsv) and NEW, so the watchdog's red means
# "something new" instead of "the same two mailboxes as last week".
#
# Why: from 2026-09-03 the sync-stuck watchdog failed on every run for the
# same two first-scan failures. A third stuck mailbox would have changed
# nothing anyone looks at — the run was already red — which is CLAUDE.md
# §8's "a guard that cannot fail": a filter over a collection whose
# failure state is indistinguishable from its normal state.
#
# Input (stdin): tab-separated rows, `mailbox_account_id`, `stuck_since`
# (UTC, `YYYY-MM-DDTHH:MM:SS.ffffffZ`), then any detail columns.
# A row is KNOWN only when an entry matches BOTH the mailbox and its
# stuck-since instant: a known mailbox that is retried and fails again
# gets a new instant and pages again.
#
# Output: one GitHub annotation per row — `::warning::` for known, and
# `::error::` plus a paste-ready acknowledgement line for new.
#
# Exit: 0 no new rows · 1 at least one new row · 2 the list is missing
# or malformed. A list that cannot be read is not evidence that every
# row is known (or new), so it fails closed, naming the file and line.
#
# Portable to macOS /bin/bash 3.2 and BSD grep/awk.

set -euo pipefail

ACKS="${KNOWN_STUCK_FILE:-$(cd "$(dirname "$0")" && pwd)/known-stuck-mailboxes.tsv}"
TAB="$(printf '\t')"

if [ ! -r "$ACKS" ]; then
  echo "::error title=Known-stuck list unreadable::${ACKS} is missing or unreadable — the watchdog cannot tell known stuck mailboxes from new ones."
  exit 2
fi

UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
SINCE='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z'
DAY='[0-9]{4}-[0-9]{2}-[0-9]{2}'
ENTRY="^(#.*|[[:space:]]*|${UUID}${TAB}${SINCE}${TAB}${DAY}${TAB}[^${TAB}]+)$"
BAD="$(grep -nEv "$ENTRY" "$ACKS" | head -n1 || true)"
if [ -n "$BAD" ]; then
  echo "::error title=Known-stuck list malformed::${ACKS}:${BAD%%:*}: expected mailbox_account_id<TAB>stuck_since (YYYY-MM-DDTHH:MM:SS.ffffffZ)<TAB>acknowledged_on (YYYY-MM-DD)<TAB>note — the watchdog cannot tell known stuck mailboxes from new ones."
  exit 2
fi

today="$(date -u +%Y-%m-%d)"
new=0
while IFS="$TAB" read -r id since rest; do
  [ -z "$id" ] && continue
  detail="${rest//$TAB/ | }"
  ack="$(awk -F "$TAB" -v id="$id" -v since="$since" \
    '$1 == id && $2 == since { print "acknowledged " $3 ": " $4; exit }' "$ACKS")"
  if [ -n "$ack" ]; then
    echo "::warning title=Known stuck mailbox::${id} — stuck since ${since} — ${detail} — ${ack}"
  else
    new=1
    echo "::error title=New stuck mailbox::${id} — stuck since ${since} — ${detail}"
    echo "  To acknowledge it, add this tab-separated line to scripts/known-stuck-mailboxes.tsv:"
    echo "  ${id}${TAB}${since}${TAB}${today}${TAB}<what is known and who owns it>"
  fi
done

exit "$new"
