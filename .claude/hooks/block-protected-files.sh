#!/usr/bin/env bash
# block-protected-files.sh — PreToolUse hook for Edit/Write/MultiEdit
# Blocks edits to secrets, lock files, build artifacts, git internals.
# Exit 0 to allow; exit non-zero to block.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ]; then
  # No file path in tool input (e.g., MultiEdit without explicit path). Allow.
  exit 0
fi

# Strip project root prefix for matching
rel_path="${file_path#$PWD/}"

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
  # Lock files (must be regenerated via package manager, not edited)
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
