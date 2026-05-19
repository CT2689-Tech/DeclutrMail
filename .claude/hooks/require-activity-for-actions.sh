#!/usr/bin/env bash
# require-activity-for-actions.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Heuristic check: when a controller adds a destructive mutation handler
# (archive / unsubscribe / delete / trash / modify labels), the same file
# should also reference the ActivityService / activity event emission so
# undo + audit have something to read from (per D207 / D232).
#
# This is a soft warning — the full semantic check lives in
# architecture-guardian. Exit 0 always; print warnings to stderr.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  *.ts|*.tsx)
    ;;
  *)
    exit 0
    ;;
esac

# Only relevant for controllers / services / orchestrators in the API
case "$file_path" in
  */apps/api/*)
    ;;
  *)
    exit 0
    ;;
esac

case "$file_path" in
  *.test.ts|*.spec.ts|*/__tests__/*|*/__mocks__/*)
    exit 0
    ;;
esac

# Destructive verbs in handler/method names that we care about
if grep -qE "(archive|unsubscribe|trash|delete|modifyLabels|removeLabel|addLabel)\s*\(" "$file_path"; then
  # Does the file also emit to ActivityService or the activity event channel?
  if ! grep -qE "(activityService|ActivityService|emit\(\s*['\"]activity\.|activity\.emit|undoJournal|UndoJournal)" "$file_path"; then
    echo "⚠️  require-activity-for-actions: destructive mutation handler in $file_path" >&2
    echo "   File mentions archive/unsubscribe/trash/delete but no ActivityService / UndoJournal call." >&2
    echo "   Per D207 + D232, destructive actions emit an activity event and write to the undo journal." >&2
    echo "   If this file is just a type/DTO file, ignore. architecture-guardian runs the full check." >&2
  fi
fi

exit 0
