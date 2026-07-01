#!/usr/bin/env bash
# wt-clean.sh — Remove all worktrees and branches except main (local + remote).
#
# Pairs with wt-new.sh: use wt-new to spin up isolated work, wt-clean to
# tear everything down when done.
#
# What it does:
#   1. git fetch origin --prune
#   2. checkout main (refuses if the working tree has uncommitted changes)
#   3. remove every linked worktree except the repo root
#   4. prune worktree metadata + delete orphan dirs (.claude/worktrees/*, ../wt-*)
#   5. delete all local branches except main
#   6. delete all remote branches on origin except main
#   7. git fetch origin --prune (final tidy)
#
# Usage:
#   ./scripts/wt-clean.sh              # interactive confirm
#   ./scripts/wt-clean.sh --yes        # skip confirm
#   ./scripts/wt-clean.sh --dry-run    # print actions only
#
# Safety:
#   - Never touches main (local or origin/main)
#   - Never force-pushes main
#   - Remote branch deletes are permanent (GitHub reflog window only recovery)

set -euo pipefail

KEEP_BRANCH="main"
YES=0
DRY_RUN=0

usage() {
  echo "usage: $(basename "$0") [--yes | -y] [--dry-run]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes | -y)
      YES=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h | --help)
      usage
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage
      ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "→ repo: $repo_root"

git fetch origin --prune

if ! git rev-parse --verify --quiet "refs/heads/$KEEP_BRANCH" >/dev/null; then
  echo "ERROR: local branch '$KEEP_BRANCH' does not exist. Aborting." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [ "$current_branch" != "$KEEP_BRANCH" ]; then
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "ERROR: uncommitted changes on '$current_branch'. Commit, stash, or discard before cleaning." >&2
    exit 1
  fi
  needs_checkout=1
else
  needs_checkout=0
fi

# --- discover linked worktrees ---
worktree_paths=()
while IFS= read -r wt_path; do
  [ -n "$wt_path" ] || continue
  if [ "$wt_path" != "$repo_root" ]; then
    worktree_paths+=("$wt_path")
  fi
done < <(git worktree list --porcelain | awk '/^worktree / {print $2}')

# --- discover orphan worktree dirs (unregistered leftovers only) ---
is_linked_worktree() {
  local candidate="$1"
  for linked in "${worktree_paths[@]}"; do
    [ "$candidate" = "$linked" ] && return 0
  done
  return 1
}

orphan_dirs=()

if [ -d "$repo_root/.claude/worktrees" ]; then
  for entry in "$repo_root/.claude/worktrees"/*; do
    [ -e "$entry" ] || continue
    is_linked_worktree "$entry" && continue
    orphan_dirs+=("$entry")
  done
fi

parent_dir="$(dirname "$repo_root")"
for entry in "$parent_dir"/wt-*; do
  [ -e "$entry" ] || continue
  is_linked_worktree "$entry" && continue
  orphan_dirs+=("$entry")
done

# --- discover local branches ---
local_branches=()
while IFS= read -r branch; do
  [ -n "$branch" ] || continue
  [ "$branch" = "$KEEP_BRANCH" ] && continue
  local_branches+=("$branch")
done < <(git branch --format='%(refname:short)')

# --- discover remote branches ---
remote_branches=()
while IFS= read -r branch; do
  [ -n "$branch" ] || continue
  [ "$branch" = "$KEEP_BRANCH" ] && continue
  remote_branches+=("$branch")
done < <(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||')

total_actions=$((needs_checkout + ${#worktree_paths[@]} + ${#orphan_dirs[@]} + ${#local_branches[@]} + ${#remote_branches[@]} + 2))

if [ "$total_actions" -le 2 ] && [ "$needs_checkout" -eq 0 ]; then
  echo "✓ already clean — only $KEEP_BRANCH remains (local + origin)"
  git worktree list
  exit 0
fi

echo ""
echo "Plan:"
[ "$needs_checkout" -eq 1 ] && echo "  checkout: $KEEP_BRANCH (from $current_branch)"
if [ "${#worktree_paths[@]}" -gt 0 ]; then
  echo "  linked worktrees (${#worktree_paths[@]}):"
  for wt_path in "${worktree_paths[@]}"; do
    echo "    - $wt_path"
  done
fi
if [ "${#orphan_dirs[@]}" -gt 0 ]; then
  echo "  orphan dirs (${#orphan_dirs[@]}):"
  for dir in "${orphan_dirs[@]}"; do
    echo "    - $dir"
  done
fi
if [ "${#local_branches[@]}" -gt 0 ]; then
  echo "  local branches (${#local_branches[@]}):"
  for branch in "${local_branches[@]}"; do
    echo "    - $branch"
  done
fi
if [ "${#remote_branches[@]}" -gt 0 ]; then
  echo "  remote branches (${#remote_branches[@]}):"
  for branch in "${remote_branches[@]}"; do
    echo "    - origin/$branch"
  done
fi
echo "  keeping: $KEEP_BRANCH (local + origin/$KEEP_BRANCH)"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run complete — no changes made. Re-run without --dry-run to apply."
  exit 0
fi

if [ "$YES" -eq 0 ]; then
  read -r -p "Type 'yes' to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

if [ "$needs_checkout" -eq 1 ]; then
  echo "→ checking out $KEEP_BRANCH"
  git checkout "$KEEP_BRANCH"
fi

if [ "${#worktree_paths[@]}" -gt 0 ]; then
  echo "→ removing linked worktrees"
  for wt_path in "${worktree_paths[@]}"; do
    echo "    $wt_path"
    git worktree remove --force "$wt_path"
  done
fi

git worktree prune

if [ "${#orphan_dirs[@]}" -gt 0 ]; then
  echo "→ removing orphan worktree dirs"
  for dir in "${orphan_dirs[@]}"; do
    echo "    $dir"
    rm -rf "$dir"
  done
fi

if [ "${#local_branches[@]}" -gt 0 ]; then
  echo "→ deleting local branches"
  for branch in "${local_branches[@]}"; do
    echo "    $branch"
    git branch -D "$branch"
  done
fi

if [ "${#remote_branches[@]}" -gt 0 ]; then
  echo "→ deleting remote branches on origin"
  for branch in "${remote_branches[@]}"; do
    echo "    origin/$branch"
    git push origin --delete "$branch" || echo "WARN: failed to delete origin/$branch (may already be gone)" >&2
  done
fi

git fetch origin --prune

echo ""
echo "✓ clean — only $KEEP_BRANCH remains"
git branch
echo ""
git branch -r
echo ""
git worktree list
