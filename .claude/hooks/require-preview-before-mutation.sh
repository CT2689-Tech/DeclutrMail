#!/usr/bin/env bash
# require-preview-before-mutation.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Heuristic check: when a destructive action mutation is added in the
# frontend, the file should also reference an ActionPreview / Preview
# component so the user sees what will change before it does (per D226).
#
# D226: User intent → action sheet → action preview → mutation → undo.
# The preview is MANDATORY (the sheet may be skipped via D34's
# "remember preference"; preview never).
#
# Soft warning — the full check is design-system-agent. Exit 0 always.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  *.tsx|*.ts)
    ;;
  *)
    exit 0
    ;;
esac

# Only relevant for the web app + UI package
case "$file_path" in
  */apps/web/*|*/packages/shared/*)
    ;;
  *)
    exit 0
    ;;
esac

case "$file_path" in
  *.test.tsx|*.test.ts|*.spec.tsx|*.spec.ts|*.stories.tsx|*/__tests__/*)
    exit 0
    ;;
esac

# Destructive client-side mutation patterns:
#   - useMutation({ mutationFn: ... archive / unsubscribe / trash / delete }
#   - direct fetch / fetchMutation with destructive endpoint
if grep -qE "(useMutation|mutateAsync|mutate\()" "$file_path" \
   && grep -qE "(archive|unsubscribe|trash|delete|modifyLabels|/api/(messages|senders)/[a-z]+/(archive|unsubscribe|trash|delete))" "$file_path"; then
  # Does the file also reference a preview component / preview state?
  if ! grep -qE "(ActionPreview|Preview\b|previewState|usePreview|<.*Preview\s|action[._-]?preview)" "$file_path"; then
    echo "⚠️  require-preview-before-mutation: destructive mutation in $file_path" >&2
    echo "   File mounts a destructive mutation but no Preview component / preview state visible." >&2
    echo "   Per D226, the action preview is MANDATORY before any destructive mutation." >&2
    echo "   The sheet may be skipped (D34); the preview never. design-system-agent runs the full check." >&2
  fi
fi

exit 0
