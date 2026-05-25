#!/usr/bin/env bash
# wt-new.sh — Create a worktree from origin/main with a fresh fetch.
#
# Background: R1 Stream D (PR #50) created a worktree from local `main` while
# the local `main` was 1 commit behind `origin/main`. The first commit on the
# new branch silently reverted the missing row in IMPLEMENTATION-LOG.md (the
# D179 row added by PR #46). The cleanup needed a separate commit on the same
# branch; reviewer noise + risk of merge confusion.
#
# This helper:
#   1. `git fetch origin --prune`
#   2. Refuses to create the worktree if `origin/main` is unreachable.
#   3. Creates the worktree from `origin/main` directly (NOT local `main`),
#      so a stale local main cannot rewind the new branch's base.
#   4. Places the worktree at `../wt-<branch>` (CLAUDE.md §6 convention).
#
# Usage: scripts/wt-new.sh <branch-name>
#
# Branch-name convention (CLAUDE.md §6):
#   <type>/d<NNN>-<kebab-description>     (≤50 chars; zero-padded D)
#   chore/bootstrap-<topic>               (pre-PR-1 work or no D-tie)
#
# The script does NOT enforce the convention — that's the GH Action's job.
# It WILL warn loudly if the branch name looks malformed.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $(basename "$0") <branch-name>" >&2
  echo "  example: $(basename "$0") feat/d042-sender-detail-charts" >&2
  exit 2
fi

branch="$1"

# Soft-warn on malformed names rather than refusing — agents already failed
# enough today.
if ! printf '%s' "$branch" | grep -qE '^(feat|fix|chore|docs|refactor|test|perf|security)/(d[0-9]{3}-[a-z0-9-]+|bootstrap-[a-z0-9-]+)$'; then
  echo "WARN: '$branch' does not match the CLAUDE.md §6 convention." >&2
  echo "      Expected: <type>/d<NNN>-<kebab>  or  chore/bootstrap-<topic>" >&2
  echo "      Continuing anyway — the GH Action will reject on PR open if non-conformant." >&2
fi

if [ ${#branch} -gt 50 ]; then
  echo "WARN: '$branch' is ${#branch} chars; CLAUDE.md §6 prefers ≤50." >&2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "→ fetching origin..."
git fetch origin --prune

if ! git rev-parse --verify --quiet origin/main >/dev/null; then
  echo "ERROR: origin/main is unreachable. Cannot create worktree from a base that doesn't exist." >&2
  exit 1
fi

# If the branch already exists locally, refuse — `git worktree add -b` would
# fail with a noisy git message; we surface a clearer one.
if git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "ERROR: branch '$branch' already exists locally." >&2
  echo "      List worktrees with 'git worktree list' to find the existing one," >&2
  echo "      or delete the branch with 'git branch -D $branch' and re-run." >&2
  exit 1
fi

# Worktree path: sibling of repo, prefixed `wt-`, no slashes in the name.
wt_name="wt-$(printf '%s' "$branch" | tr '/' '-')"
wt_path="$(dirname "$repo_root")/$wt_name"

if [ -e "$wt_path" ]; then
  echo "ERROR: '$wt_path' already exists. Aborting to avoid clobbering." >&2
  exit 1
fi

echo "→ creating worktree at $wt_path from origin/main..."
git worktree add "$wt_path" -b "$branch" origin/main

echo ""
echo "✓ Worktree ready:"
echo "  branch: $branch"
echo "  path:   $wt_path"
echo "  base:   origin/main @ $(git rev-parse --short origin/main)"
echo ""
echo "Next:  cd $wt_path"
