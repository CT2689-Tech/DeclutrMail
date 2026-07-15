#!/usr/bin/env bash
# Revert one merged PR as one independently reviewable revert PR.
#
# Usage:
#   ./scripts/revert-pr.sh <PR_NUMBER>
#   ./scripts/revert-pr.sh <PR_NUMBER> --push

set -euo pipefail

PR="${1:-}"
MODE="${2:-}"

if [[ -z "$PR" || ! "$PR" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <PR_NUMBER> [--push]" >&2
  exit 1
fi

if [[ -n "$MODE" && "$MODE" != "--push" ]]; then
  echo "error: second argument must be --push" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: worktree must be clean before creating a revert branch" >&2
  exit 1
fi

git fetch origin main --quiet

# Prefer GitHub's exact mergeCommit field. The fallback matches a squash
# subject ending in (#N), avoiding collisions such as #32 versus #324.
SHA="$(gh pr view "$PR" --json mergeCommit --jq '.mergeCommit.oid // empty' 2>/dev/null || true)"
if [[ -z "$SHA" ]]; then
  SHA="$(git log origin/main --format='%H %s' |
    awk -v tail="(#${PR})" '{ if (substr($0, length($0) - length(tail) + 1) == tail) { print $1; exit } }')"
fi

if [[ -z "$SHA" ]]; then
  echo "error: could not resolve the merge commit for PR #${PR}" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "error: resolved commit $SHA is not on origin/main" >&2
  exit 1
fi

SUBJECT="$(git log -1 --format=%s "$SHA")"
BRANCH="revert/pr-${PR}"

echo "Reverting: $SUBJECT ($SHA)"
git switch -c "$BRANCH" origin/main

PARENT_COUNT="$(git rev-list --parents -n 1 "$SHA" | wc -w | tr -d ' ')"
if [[ "$PARENT_COUNT" -gt 2 ]]; then
  git revert --no-edit -m 1 "$SHA"
else
  git revert --no-edit "$SHA"
fi

echo "Created $BRANCH reverting PR #${PR}."

if [[ "$MODE" == "--push" ]]; then
  command -v gh >/dev/null 2>&1 || {
    echo "error: gh is required for --push" >&2
    exit 1
  }
  git push -u origin "$BRANCH"
  gh pr create \
    --title "revert: ${SUBJECT}" \
    --body "Reverts #${PR} (${SHA}).

Restores the decision state documented for that PR in docs/execution/d-break-ledger-2026-07-11.md."
  echo "Pushed $BRANCH and opened its revert PR."
fi
