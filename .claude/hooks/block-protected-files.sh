#!/usr/bin/env bash
# block-protected-files.sh — PreToolUse hook for Edit/Write/MultiEdit
#
# Blocks edits to secrets and git internals. Lockfiles and build output are
# left alone: regenerating them is ordinary work.
# Exit 0 to allow; exit 2 to block (Claude Code ignores any other non-zero code).
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
  # (a missing directory keeps the path as given, not "/<basename>")
  if dir=$(cd "$(dirname "$file_path")" 2>/dev/null && pwd -P); then
    abs_path="$dir/$(basename "$file_path")"
  else
    abs_path="$file_path"
  fi
  rel_path="${abs_path#$repo_root/}"
else
  rel_path="${file_path#$PWD/}"
fi

# Secrets and git internals. Example env files hold placeholder names, never
# secrets, and are tracked so contributors know what to set (2026-11-17).
blocked='\.env(\.|$)|\.envrc$|\.(pem|key|p12|pfx)$|(credentials|secrets)\.json$|service-account.*\.json$|(^|/)\.git/'

if echo "$rel_path" | grep -qE "$blocked" && ! echo "$rel_path" | grep -qE '(^|/)\.env\.example$'; then
  echo "❌ block-protected-files: edits to '$rel_path' are not allowed (secret or git internals)." >&2
  echo "   If you need this change, raise it with the founder." >&2
  exit 2
fi

exit 0
