#!/usr/bin/env bash
# block-protected-files.sh — PreToolUse hook for Edit/Write/MultiEdit
#
# Blocks edits to secrets, lock files, build artifacts, git internals.
# Exit 0 to allow; non-zero to block.
#
# NOTE on CLAUDE.md: Edits to CLAUDE.md are NOT blocked here, by design.
# CLAUDE.md §11 declares a "founder-only via PR" CONVENTION for CLAUDE.md
# edits — enforced by review, not by hook. Hook-blocking CLAUDE.md would
# also block legitimate distillation PRs and bootstrap edits. If the
# convention is violated, code review catches it.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ]; then
  # No file path in tool input (e.g., MultiEdit batches without explicit path). Allow.
  exit 0
fi

# Normalize to a path relative to the repo root using git rev-parse — this
# is robust against being invoked from a subdirectory or worktree. Falls
# back to PWD-strip if git is unavailable.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$repo_root" ]; then
  # Resolve symlinks and produce an absolute path
  abs_path=$(cd "$(dirname "$file_path")" 2>/dev/null && pwd -P)/$(basename "$file_path") 2>/dev/null || abs_path="$file_path"
  rel_path="${abs_path#$repo_root/}"
else
  rel_path="${file_path#$PWD/}"
fi

# Patterns that are HARD-blocked
blocked_patterns=(
  # Secrets
  '\.env(\.|$)'
  '\.envrc$'
  '\.pem$'
  '\.key$'
  '\.p12$'
  '\.pfx$'
  'credentials\.json$'
  'secrets\.json$'
  'service-account.*\.json$'
  # Lock files (regenerate via package manager, not edit)
  '^pnpm-lock\.yaml$'
  '^package-lock\.json$'
  '^yarn\.lock$'
  # Git internals
  '^\.git/'
  # Build artifacts
  '^dist/'
  '^build/'
  '^\.next/'
  '^node_modules/'
  # Coverage / reports
  '^coverage/'
)

for pattern in "${blocked_patterns[@]}"; do
  if echo "$rel_path" | grep -qE "$pattern"; then
    echo "❌ block-protected-files: edits to '$rel_path' are not allowed." >&2
    echo "   Matched pattern: $pattern" >&2
    echo "   If you need this change, raise it with the founder." >&2
    exit 1
  fi
done

exit 0
