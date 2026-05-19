#!/usr/bin/env bash
# require-tests-after-edit.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Soft reminder: when a production source file is edited, warn if no
# co-located test file exists. This is a NUDGE, not a block — many edits
# (refactors, comment-only, type-only) don't warrant a test, and the
# full enforcement lives in the PR's Definition of Done (CLAUDE.md §8).
#
# Exit 0 always (warning-only); print to stderr if the nudge fires.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

# Only relevant for production TS in the workspace packages
case "$file_path" in
  *.ts|*.tsx)
    ;;
  *)
    exit 0
    ;;
esac

# Skip files that are themselves tests / stories / type-only / config
case "$file_path" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.stories.tsx|*.stories.ts)
    exit 0
    ;;
  *.d.ts|*/types.ts|*/types/*|*/__tests__/*|*/__mocks__/*)
    exit 0
    ;;
  */.claude/*|*/docs/*|*/.github/*|*/scripts/*)
    exit 0
    ;;
esac

# Skip skeleton files (just `export {};`) — they're scaffold, not logic
if [ "$(wc -l < "$file_path")" -le 2 ]; then
  exit 0
fi

# Only nudge for code in apps/* or packages/* — root files are usually config
case "$file_path" in
  */apps/*|*/packages/*)
    ;;
  *)
    exit 0
    ;;
esac

# Look for a co-located test file via common conventions:
#   foo.ts  → foo.test.ts | foo.spec.ts | __tests__/foo.ts
dir=$(dirname "$file_path")
base=$(basename "$file_path")
stem="${base%.ts}"
stem="${stem%.tsx}"

candidates=(
  "$dir/${stem}.test.ts"
  "$dir/${stem}.test.tsx"
  "$dir/${stem}.spec.ts"
  "$dir/${stem}.spec.tsx"
  "$dir/__tests__/${stem}.ts"
  "$dir/__tests__/${stem}.tsx"
  "$dir/__tests__/${stem}.test.ts"
)

for cand in "${candidates[@]}"; do
  if [ -f "$cand" ]; then
    exit 0
  fi
done

echo "ℹ️  require-tests-after-edit: no co-located test file for $file_path" >&2
echo "   Looked for: ${stem}.{test,spec}.{ts,tsx} + __tests__/${stem}.*" >&2
echo "   Not a blocker — but the PR Definition of Done (CLAUDE.md §8) requires unit/integration tests" >&2
echo "   for affected modules. Type-only / comment-only edits can ignore this." >&2

exit 0
