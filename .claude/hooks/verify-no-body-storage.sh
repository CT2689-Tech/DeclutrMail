#!/usr/bin/env bash
# verify-no-body-storage.sh — PostToolUse hook for Edit/Write/MultiEdit
# Fast regex scan for D7/D228 privacy violations.
# This is a tripwire, not the full audit — privacy-auditor subagent
# runs the semantic data-flow review.
# Exit 0 unless a hard match is found.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Only scan code files where body storage could happen
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.sql|*.md|*.mdx)
    ;;
  *)
    exit 0
    ;;
esac

# Skip the agent definitions / hooks / CLAUDE.md themselves (they
# discuss banned patterns in metadata, not in code)
case "$file_path" in
  */.claude/agents/*|*/.claude/hooks/*|*/CLAUDE.md|*/LEARNINGS.md|*/MISTAKES.md|*/IMPLEMENTATION-LOG.md|*/docs/execution/*)
    exit 0
    ;;
esac

if [ ! -f "$file_path" ]; then
  exit 0
fi

findings=0

# Pattern 1: Direct body access on Gmail message objects
if grep -nE "(msg|message|email|gmsg|m)\.(payload|body|raw|html|textBody)\b" "$file_path" >/dev/null 2>&1; then
  echo "⚠️  verify-no-body-storage: direct body access pattern found in $file_path" >&2
  grep -nE "(msg|message|email|gmsg|m)\.(payload|body|raw|html|textBody)\b" "$file_path" | sed 's/^/   /' >&2
  findings=$((findings + 1))
fi

# Pattern 2: Gmail API called with format='full' or 'raw'
if grep -nE "format:\s*['\"](full|raw)['\"]" "$file_path" >/dev/null 2>&1; then
  echo "⚠️  verify-no-body-storage: Gmail API format=full/raw in $file_path" >&2
  grep -nE "format:\s*['\"](full|raw)['\"]" "$file_path" | sed 's/^/   /' >&2
  findings=$((findings + 1))
fi

# Pattern 3: Banned trust copy
if grep -niE "bod(y|ies)\s+read.*0" "$file_path" >/dev/null 2>&1; then
  echo "❌ verify-no-body-storage: banned trust copy 'Bodies read: 0' in $file_path (D228)" >&2
  grep -niE "bod(y|ies)\s+read.*0" "$file_path" | sed 's/^/   /' >&2
  exit 1
fi

# Pattern 4: Storing Message-ID header (D231 forbids this)
if grep -nE "(message[_-]?id|messageId)\s*[:=]" "$file_path" >/dev/null 2>&1; then
  # Allow internal Pub/Sub messageId references (different concept)
  if ! grep -nE "pubsub|webhook|dedup" "$file_path" >/dev/null 2>&1; then
    echo "⚠️  verify-no-body-storage: possible Message-ID storage in $file_path (D231)" >&2
    grep -nE "(message[_-]?id|messageId)\s*[:=]" "$file_path" | sed 's/^/   /' >&2
    findings=$((findings + 1))
  fi
fi

if [ "$findings" -gt 0 ]; then
  echo "" >&2
  echo "   These are heuristic findings — privacy-auditor subagent runs the full review." >&2
  echo "   If false positive, document why in PR body or LEARNINGS.md." >&2
fi

# PostToolUse: warnings don't block (edit already happened). Exit 0
# unless a hard violation (banned trust copy above already exited 1).
exit 0
