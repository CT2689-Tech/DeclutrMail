#!/usr/bin/env bash
# block-bypass-flags.sh — PreToolUse hook for Bash
#
# Blocks Bash commands that attempt to bypass safety/integrity checks.
# These flags should never be used outside of explicit founder authorization.
#
# Why a hook instead of a permission rule:
#   Claude Code permission patterns (e.g., Bash(git push:*)) match the
#   command prefix, not arbitrary substrings. A pattern like
#   Bash(*--no-verify*) does not reliably enforce — its semantics are
#   inconsistent across versions. A small hook gives precise control.
#
# Exit 0 to allow; non-zero to block.

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -z "$command" ]; then
  exit 0
fi

# Forbidden flags. Each entry is a regex matched against the command.
# Bash word boundaries ensure flags aren't accidentally matched inside
# longer strings (e.g., inside a quoted commit message).
forbidden=(
  '\B--no-verify\b'      # skips pre-commit/pre-push hooks
  '\B--no-gpg-sign\b'    # skips commit signing
  '\B--no-edit\b.*git rebase'   # git rebase --no-edit (per system prompt: invalid combo)
  'commit\.gpgsign=false'       # inline gpgsign disable via -c flag
)

for pattern in "${forbidden[@]}"; do
  if echo "$command" | grep -qE "$pattern"; then
    echo "❌ block-bypass-flags: forbidden bypass flag detected in Bash command." >&2
    echo "   Pattern: $pattern" >&2
    echo "   Command: $command" >&2
    echo "   If a hook is failing, fix the underlying issue rather than bypassing." >&2
    echo "   If this is genuinely needed, ask the founder to override per-PR." >&2
    exit 1
  fi
done

exit 0
