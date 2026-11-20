#!/usr/bin/env bash
# require-pr-template.sh — PreToolUse hook for Bash
#
# Local fail-fast layer for PR creation conventions. Enforces ONLY the
# branch name pattern from CLAUDE.md §6 — the PR body / template check
# happens authoritatively in the GitHub Action (lands in PR 1).
#
# Why no local body check:
#   gh pr create --body "$(cat <<'EOF'...EOF)" is the standard pattern,
#   but the body content is a HEREDOC expanded by the shell BEFORE the
#   tool_input.command string reaches this hook — so the literal string
#   we see has the body fully interpolated, often spanning many lines
#   with embedded quotes that a regex can't reliably extract. Rather
#   than ship a body check that silently fails on every common usage,
#   we leave body validation to the GH Action which sees the actual
#   PR body via API.
#
# Coverage gaps (intentional — GH Action catches these):
#   - gh pr edit --body  (creates a body change after PR exists)
#   - gh api repos/.../pulls (direct API)
#   - PRs created via web UI
#
# Exit 0 to allow; exit 2 to block (Claude Code ignores any other non-zero code).

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Only act on gh pr create invocations
if ! echo "$command" | grep -qE "gh\s+pr\s+create"; then
  exit 0
fi

# Get the current branch
branch=$(git branch --show-current 2>/dev/null || echo "")

if [ -z "$branch" ]; then
  echo "❌ require-pr-template: could not determine current branch." >&2
  exit 2
fi

# Branch name convention — KEEP THIS LIST IN SYNC with .husky/pre-push and
# .github/workflows/branch-name.yml (both authoritative; this is only the
# local fail-fast copy). This list once drifted from both and blocked
# `gh pr create` from claude/ and codex/ branches that CI would have
# accepted (caught 2026-09-01).
# Pattern: <type>/<kebab> or (codex|claude|cursor)/<kebab>. The `d<NNN>-`
# segment was retired 2026-11-17 with the D-decision system.
if ! echo "$branch" | grep -qE "^((feat|fix|chore|docs|refactor|test|perf|security)/[a-z0-9]|(codex|claude|cursor)/[a-z0-9][a-z0-9-]*$)"; then
  echo "❌ require-pr-template: branch '$branch' does not match naming convention." >&2
  echo "   Expected: <type>/<kebab-description> or (codex|claude|cursor)/<kebab>" >&2
  echo "   Allowed types: feat, fix, chore, docs, refactor, test, perf, security" >&2
  echo "   See CLAUDE.md §6 for the full pattern." >&2
  exit 2
fi

exit 0
