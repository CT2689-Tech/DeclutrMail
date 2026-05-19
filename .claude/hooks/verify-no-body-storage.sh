#!/usr/bin/env bash
# verify-no-body-storage.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Fast regex tripwire for D7/D228 privacy violations. The full
# semantic data-flow review is privacy-auditor (subagent). This hook
# catches obvious cases at edit-time; subtle ones require semantic
# review.
#
# Exit 0 unless a hard match is found (banned trust copy).

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Only scan file types where body storage could happen.
# JSON included to catch test fixtures and DB seeds that might embed
# message data.
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.sql|*.json|*.md|*.mdx)
    ;;
  *)
    exit 0
    ;;
esac

# Skip files that legitimately discuss banned patterns in documentation
# (not in code paths). Without this, the hook recursively flags itself.
case "$file_path" in
  */.claude/agents/*|*/.claude/hooks/*|*/CLAUDE.md|*/LEARNINGS.md|*/MISTAKES.md|*/IMPLEMENTATION-LOG.md|*/docs/execution/*)
    exit 0
    ;;
esac

if [ ! -f "$file_path" ]; then
  exit 0
fi

findings=0

# Pattern 1: direct body access on Gmail message-shaped variables.
# Word boundary \b before the alternation is critical — without it,
# `system.body`, `program.body` would match because `m.body` is a
# substring.
if grep -nE "\b(msg|message|email|gmsg)\.(payload|body|raw|html|textBody)\b" "$file_path" >/dev/null 2>&1; then
  echo "⚠️  verify-no-body-storage: direct body access pattern in $file_path" >&2
  grep -nE "\b(msg|message|email|gmsg)\.(payload|body|raw|html|textBody)\b" "$file_path" | sed 's/^/   /' >&2
  findings=$((findings + 1))
fi

# Pattern 2: Gmail API called with format='full' or format='raw'.
# Only these formats return body content.
if grep -nE "format:\s*['\"](full|raw)['\"]" "$file_path" >/dev/null 2>&1; then
  echo "⚠️  verify-no-body-storage: Gmail API format=full/raw in $file_path" >&2
  grep -nE "format:\s*['\"](full|raw)['\"]" "$file_path" | sed 's/^/   /' >&2
  findings=$((findings + 1))
fi

# Pattern 3: Banned trust copy (D228). This is the only HARD block —
# trust copy violations are easy to grep and severe to ship.
if grep -niE "bod(y|ies)\s+read.*0" "$file_path" >/dev/null 2>&1; then
  echo "❌ verify-no-body-storage: banned trust copy 'Bodies read: 0' in $file_path (D228)" >&2
  grep -niE "bod(y|ies)\s+read.*0" "$file_path" | sed 's/^/   /' >&2
  exit 1
fi

# Note on Message-ID detection (D231): a regex check produced too many
# false positives because `messageId` is a generic identifier in many
# contexts (Pub/Sub message IDs, internal UUIDs, queue IDs). Detection
# of RFC822 Message-ID header storage requires semantic context, which
# privacy-auditor (subagent) handles. Do NOT re-add a Message-ID regex
# here without a more specific anchor.

if [ "$findings" -gt 0 ]; then
  echo "" >&2
  echo "   Heuristic findings — privacy-auditor subagent runs the full review." >&2
  echo "   If false positive, document why in PR body or LEARNINGS.md." >&2
fi

# PostToolUse: warnings don't block (the edit already happened).
# The hard violation (banned trust copy above) already exited 1.
exit 0
