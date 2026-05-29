#!/usr/bin/env bash
#
# Copy gitignored .env.local files from the MAIN checkout into a
# git worktree so dev-up.sh / preview servers in that worktree pick
# up the same secrets.
#
# Why this exists. `.env.local` (root + apps/web/) is gitignored —
# `git worktree add` does NOT copy it. Symptoms when missing:
#   - apps/web Next dev server fails the AuthProvider check with
#     `GET /api/auth/me failed: 404` because NEXT_PUBLIC_API_URL is
#     unset and the client falls back to relative paths (Next dev
#     returns 404 for /api/auth/me — no such Next route).
#   - apps/api boot crashes on REDIS_URL / JWT_*_SECRET / KMS / etc.
#     (these all live in the root .env.local).
#
# Files synced:
#   - <repo-root>/.env.local         → <worktree>/.env.local
#   - <repo-root>/apps/web/.env.local → <worktree>/apps/web/.env.local
#
# Re-running this script after rotating local secrets in the main
# checkout is the supported re-sync flow. It overwrites the worktree
# copies WITHOUT prompting; the worktree is expected to be a scratch
# space for the same dev environment, not a different one.
#
# Usage:
#   ./scripts/sync-env-to-worktree.sh <worktree-path>
#
# Example:
#   ./scripts/sync-env-to-worktree.sh ../wt-feat-d156-rl-severity-and-admin-read
#
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <worktree-path>" >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE="$1"

# Normalise — accept both relative and absolute paths.
if [[ ! -d "$WORKTREE" ]]; then
  echo "error: $WORKTREE is not a directory" >&2
  exit 1
fi
WORKTREE="$(cd "$WORKTREE" && pwd)"

# Refuse to copy onto itself — source and target are the same directory
# (e.g. founder ran this from a worktree pointing at the same worktree).
# REPO_ROOT here is the script's own checkout, which is the source of
# truth; target must differ. Run this script from the MAIN checkout
# whose .env.local you want to propagate.
if [[ "$WORKTREE" == "$REPO_ROOT" ]]; then
  echo "error: source and target are the same directory ($WORKTREE)" >&2
  echo "       run this script from the MAIN checkout — it copies that" >&2
  echo "       checkout's .env.local into the worktree you pass as arg." >&2
  exit 2
fi

# Confirm it's actually a git worktree — guards against typo'd paths
# landing in an unrelated directory.
if ! git -C "$WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: $WORKTREE is not inside a git work tree" >&2
  exit 3
fi

copied=0
skipped=0

# Repo-root .env.local — the API + worker + scripts read this.
if [[ -f "$REPO_ROOT/.env.local" ]]; then
  cp "$REPO_ROOT/.env.local" "$WORKTREE/.env.local"
  echo "✓ .env.local → $WORKTREE/.env.local"
  copied=$((copied + 1))
else
  echo "⚠ $REPO_ROOT/.env.local missing — skipping"
  skipped=$((skipped + 1))
fi

# apps/web/.env.local — Next.js dev reads ONLY from its package CWD
# (apps/web/), NOT the repo root. So this file is required separately
# for `NEXT_PUBLIC_API_URL` to land in the browser bundle.
if [[ -f "$REPO_ROOT/apps/web/.env.local" ]]; then
  mkdir -p "$WORKTREE/apps/web"
  cp "$REPO_ROOT/apps/web/.env.local" "$WORKTREE/apps/web/.env.local"
  echo "✓ apps/web/.env.local → $WORKTREE/apps/web/.env.local"
  copied=$((copied + 1))
else
  echo "⚠ $REPO_ROOT/apps/web/.env.local missing — skipping"
  skipped=$((skipped + 1))
fi

echo
echo "synced $copied file(s); skipped $skipped"
echo "tip: re-run after rotating local secrets in the main checkout."
