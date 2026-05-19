#!/usr/bin/env bash
# require-pr-template.sh — PreToolUse hook for Bash
# When the agent runs `gh pr create`, verify the PR body contains
# `Closes D###` OR the branch is a bootstrap branch (chore/bootstrap-*).
# Exit 0 to allow; non-zero to block.

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Only act on gh pr create invocations
if ! echo "$command" | grep -qE "gh\s+pr\s+create"; then
  exit 0
fi

# Get the current branch
branch=$(git branch --show-current 2>/dev/null || echo "")

# Bootstrap branches are exempt (per CLAUDE.md §6)
if echo "$branch" | grep -qE "^chore/bootstrap-"; then
  exit 0
fi

# Branch name convention check
if ! echo "$branch" | grep -qE "^(feat|fix|chore|docs|refactor|test|perf|security)/(d[0-9]{3}-|bootstrap-)"; then
  echo "❌ require-pr-template: branch '$branch' does not match naming convention." >&2
  echo "   Expected: <type>/d<NNN>-<description> or chore/bootstrap-<topic>" >&2
  echo "   See CLAUDE.md §6 for full pattern." >&2
  exit 1
fi

# Extract --body or --body-file from the command
body=""
if echo "$command" | grep -qE -- "--body-file"; then
  body_file=$(echo "$command" | grep -oE -- "--body-file\s+[^\s]+" | awk '{print $2}')
  if [ -f "$body_file" ]; then
    body=$(cat "$body_file")
  fi
elif echo "$command" | grep -qE -- "--body"; then
  # Try to extract --body "..." or --body $(cat <<EOF... EOF)
  body=$(echo "$command" | grep -oE -- "--body\s+['\"][^'\"]*['\"]" || true)
fi

# Check for `Closes D###` pattern in the body
if [ -n "$body" ] && ! echo "$body" | grep -qE "Closes\s+D[0-9]+"; then
  echo "❌ require-pr-template: PR body must contain 'Closes D###' for one or more D-decisions." >&2
  echo "   See .github/pull_request_template.md for the template." >&2
  echo "   Bootstrap PRs (branch 'chore/bootstrap-*') are exempt." >&2
  exit 1
fi

# If we got here without a body, the PR will use the template — let it through.
# The GH Action 'require-pr-template' is the authoritative check.
exit 0
