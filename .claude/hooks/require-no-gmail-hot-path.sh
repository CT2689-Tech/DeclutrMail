#!/usr/bin/env bash
# require-no-gmail-hot-path.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces the "no Gmail API call from the request hot path" rule. Gmail
# API calls must originate from worker code (packages/workers/** or
# apps/api/workers/**) so the request thread isn't blocked on Gmail
# latency + rate limits.
#
# Exit 1 if a synchronous Gmail call appears in non-worker code.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx)
    ;;
  *)
    exit 0
    ;;
esac

# Documentation / config / agent surfaces are exempt
case "$file_path" in
  */.claude/*|*/CLAUDE.md|*/LEARNINGS.md|*/MISTAKES.md|*/IMPLEMENTATION-LOG.md|*/docs/*|*/.github/*|*/tests/**)
    exit 0
    ;;
esac

# Workers are the legitimate location for Gmail calls — exempt.
case "$file_path" in
  */packages/workers/*|*/apps/api/workers/*|*.worker.ts|*.worker.tsx)
    exit 0
    ;;
esac

# Test files often mock Gmail — exempt.
case "$file_path" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/__tests__/*|*/__mocks__/*)
    exit 0
    ;;
esac

# Gmail API surface: `gmail.users.messages.*`, `gmail.users.labels.*`,
# `gmail.users.threads.*`. The googleapis client also exposes
# `google.gmail()` — that's the constructor; flag any subsequent
# `.users.` access too.
if grep -nE "gmail\.users\.(messages|labels|threads|history|drafts)\." "$file_path" >/dev/null 2>&1; then
  # Allow opt-out via explicit comment marker on the same or previous line
  matches=$(grep -nE "gmail\.users\.(messages|labels|threads|history|drafts)\." "$file_path")
  filtered=""
  while IFS= read -r line; do
    lineno=$(echo "$line" | cut -d: -f1)
    prev=$((lineno - 1))
    # Check the matched line + previous line for the allow marker
    if sed -n "${prev}p;${lineno}p" "$file_path" | grep -qF "@declutrmail-allow-gmail-hot-path"; then
      continue
    fi
    filtered+="${line}"$'\n'
  done <<< "$matches"

  if [ -n "$filtered" ]; then
    echo "❌ require-no-gmail-hot-path: Gmail API call outside worker code" >&2
    echo "$filtered" | sed 's/^/   /' >&2
    echo "" >&2
    echo "   Gmail calls must originate from packages/workers/** or apps/api/workers/**." >&2
    echo "   The request hot path cannot block on Gmail latency / rate limits." >&2
    echo "   Override with '// @declutrmail-allow-gmail-hot-path' on the prior line if intentional." >&2
    exit 1
  fi
fi

exit 0
