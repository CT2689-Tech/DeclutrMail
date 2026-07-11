#!/usr/bin/env bash
# revert-pr.sh — revert everything a merged PR landed on main, as one commit.
#
# Usage:
#   ./scripts/revert-pr.sh <PR_NUMBER>          # create revert branch locally
#   ./scripts/revert-pr.sh <PR_NUMBER> --push   # also push + open a revert PR
#
# Works with this repo's squash-merge convention (merge commit subject ends
# with "(#<PR>)"). Handles true merge commits (2 parents) via `-m 1`.
# Every PR in the 2026-07-11 buildout wave lists its D-ledger in the PR
# body; reverting the PR reverts every D it amended/broke — see
# docs/execution/d-break-ledger-2026-07-11.md.

set -euo pipefail

PR="${1:-}"
PUSH="${2:-}"

if [[ -z "$PR" || ! "$PR" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <PR_NUMBER> [--push]" >&2
  exit 1
fi

git fetch origin main --quiet

# Primary: ask GitHub for the exact merge commit (immune to substring
# collisions like #32 vs #324 and to "#N" mentions in commit bodies).
SHA=$(gh pr view "$PR" --json mergeCommit --jq '.mergeCommit.oid // empty' 2>/dev/null || true)

# Fallback (offline / no gh): subject must END with "(#N)" — exact match,
# never a substring or a body mention.
if [[ -z "$SHA" ]]; then
  SHA=$(git log origin/main --format='%H %s' |
    awk -v tail="(#${PR})" '{ if (substr($0, length($0) - length(tail) + 1) == tail) { print $1; exit } }')
fi

if [[ -z "$SHA" ]]; then
  echo "error: could not resolve the merge commit for PR #${PR}" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "error: resolved commit $SHA is not on origin/main (PR #${PR} not merged?)" >&2
  exit 1
fi

SUBJECT=$(git log -1 --format=%s "$SHA")
echo "Reverting: $SUBJECT ($SHA)"

BRANCH="revert/pr-${PR}"
git checkout -b "$BRANCH" origin/main

PARENTS=$(git rev-list --parents -n 1 "$SHA" | wc -w | tr -d ' ')
if [[ "$PARENTS" -gt 2 ]]; then
  git revert --no-edit -m 1 "$SHA"
else
  git revert --no-edit "$SHA"
fi

echo "Created $BRANCH reverting #${PR}."

if [[ "$PUSH" == "--push" ]]; then
  git push -u origin "$BRANCH"
  gh pr create \
    --title "revert: ${SUBJECT}" \
    --body "Reverts #${PR} (${SHA}).

Restores every D-decision state that PR amended or broke — see its \`## D-ledger\` section and \`docs/execution/d-break-ledger-2026-07-11.md\`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  echo "Revert PR opened."
fi
