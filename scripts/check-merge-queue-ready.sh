#!/usr/bin/env bash
#
# Is every REQUIRED status check wired to fire in a merge queue?
#
# WHY THIS EXISTS. A merge queue blocks each entry until every required
# check reports. A workflow that does not listen for `merge_group` never
# reports at all — so the entry does not fail, it HANGS, with an empty
# checks tab and nothing to read. The failure mode is silence, which is
# why it needs a guard rather than a memory.
#
# It is also a ratchet: adding a required check later, or a workflow that
# owns one, can re-break the queue months after anyone remembers this.
#
# Two answers this cannot give, and says so instead of guessing:
# checks owned OUTSIDE this repo (CodeQL default setup, Vercel) have no
# workflow file to inspect. They are listed for a human to confirm.
#
# Usage:  ./scripts/check-merge-queue-ready.sh [owner/repo]
# Exit 1 when a repo-owned required check would hang the queue.

set -euo pipefail

REPO="${1:-CT2689-Tech/DeclutrMail}"
WORKFLOWS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.github/workflows"

# Job names in a workflow whose `on:` block contains `merge_group`.
# The `on:` block runs from the `on:` line to the next zero-indented key,
# so a `merge_group:` anywhere else in the file cannot be mistaken for a
# trigger.
queue_ready_jobs() {
  for f in "$WORKFLOWS"/*.yml; do
    awk '
      /^on:/            { in_on = 1; next }
      in_on && /^[^ #]/ { in_on = 0 }
      in_on && /^[ \t]+merge_group:/ { found = 1 }
      END               { exit !found }
    ' "$f" || continue
    grep -oE '^    name: .*' "$f" | sed 's/^    name: //'
  done
}

# Every job name defined anywhere, so a check with no workflow at all can
# be reported as EXTERNAL rather than as a hang.
all_jobs() {
  grep -hoE '^    name: .*' "$WORKFLOWS"/*.yml | sed 's/^    name: //'
}

required="$(gh api "repos/$REPO/branches/main/protection" \
  --jq '.required_status_checks.contexts[]' 2>/dev/null || true)"

if [ -z "$required" ]; then
  echo "✗ Could not read required checks for $REPO (no access, or no branch protection)." >&2
  exit 1
fi

ready="$(queue_ready_jobs)"
known="$(all_jobs)"
bad=0
external=0

while IFS= read -r check; do
  [ -z "$check" ] && continue
  if printf '%s\n' "$ready" | grep -qxF "$check"; then
    printf '  ok        %s\n' "$check"
  elif printf '%s\n' "$known" | grep -qxF "$check"; then
    printf '  WILL HANG %s — its workflow has no `merge_group` trigger\n' "$check"
    bad=$((bad + 1))
  else
    printf '  external  %s — owned outside this repo; confirm by hand\n' "$check"
    external=$((external + 1))
  fi
done <<< "$required"

echo
if [ "$bad" -gt 0 ]; then
  echo "✗ $bad required check(s) would hang the merge queue. Add \`merge_group:\` to their workflow's \`on:\` block." >&2
  exit 1
fi
echo "✓ Every repo-owned required check fires on merge_group."
[ "$external" -gt 0 ] && echo "  $external external check(s) above still need a human to confirm merge-queue support."
exit 0
