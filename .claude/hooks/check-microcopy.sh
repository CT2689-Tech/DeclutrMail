#!/usr/bin/env bash
# check-microcopy.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces D227 canonical verbs (Keep / Archive / Unsubscribe / Later — K/A/U/L)
# in product UI surfaces. "Screen" is an internal enum only — never user-facing.
#
# Scope: apps/web/** and any *.stories.tsx file (Storybook copy must also comply).
# Skipped: .claude/, docs/, CLAUDE.md, agent definitions, the plan mirror, this hook.
#
# Exit 1 to block on canonical-verbs violation.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

# Only scan UI-relevant file types
case "$file_path" in
  *.tsx|*.ts|*.jsx|*.js|*.mdx|*.md)
    ;;
  *)
    exit 0
    ;;
esac

# Documentation / config / agent surfaces are exempt — they discuss the rule
case "$file_path" in
  */.claude/*|*/CLAUDE.md|*/LEARNINGS.md|*/MISTAKES.md|*/IMPLEMENTATION-LOG.md|*/docs/*|*/.github/*)
    exit 0
    ;;
esac

# Scope: apps/web/** + any *.stories.* anywhere (Storybook stories live in
# packages/ui and apps/web both)
case "$file_path" in
  */apps/web/*|*.stories.tsx|*.stories.ts|*.stories.jsx|*.stories.js|*.stories.mdx)
    ;;
  *)
    exit 0
    ;;
esac

# Canonical verbs check (D227): "Screen" as a user-facing verb is banned.
# The Screener feature name is allowed (always capitalized + product noun).
#
# Trip patterns:
#   - "Screen" as button label / action verb in JSX text or strings
#   - "screen" as shortcut hint (e.g. "Screen (S)")
#   - "Screen this sender" / "Screen all" / etc.
#
# Allowed:
#   - "Screener" (the feature name)
#   - "screen" in component naming (file paths, CSS classes)
#   - "Screen" in comments referencing the internal enum
#
# Heuristic: flag occurrences that look like UI copy.

violations=0

# 1) JSX text content: >Screen< or >Screen all< etc.
if grep -nE '>[[:space:]]*Screen([[:space:]][^<]*)?<' "$file_path" >/dev/null 2>&1; then
  echo "❌ check-microcopy: 'Screen' as user-facing verb in JSX text (D227 — use K/A/U/L)" >&2
  grep -nE '>[[:space:]]*Screen([[:space:]][^<]*)?<' "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

# 2) String literals that look like button/action labels with "Screen"
#    but NOT "Screener" (lookahead in grep-perl isn't portable; we use a
#    follow-up check instead).
if grep -nE "['\"]Screen([[:space:]]|['\"\$])" "$file_path" >/dev/null 2>&1; then
  # Filter out "Screener" matches — those are allowed
  matches=$(grep -nE "['\"]Screen([[:space:]]|['\"\$])" "$file_path" | grep -v "Screener" || true)
  if [ -n "$matches" ]; then
    echo "❌ check-microcopy: 'Screen' in UI string literal (D227 — use K/A/U/L)" >&2
    echo "$matches" | sed 's/^/   /' >&2
    violations=$((violations + 1))
  fi
fi

# 3) Banned shortcut: the 'S' key was canonical pre-D227; now it's 'L' for Later.
#    Flag any aria-keyshortcut or hotkey config that binds 'S' to a verb action.
if grep -nE "(aria-keyshortcuts|hotkey|shortcut)\s*[:=]\s*['\"](S|s)['\"]" "$file_path" >/dev/null 2>&1; then
  echo "❌ check-microcopy: 'S' as shortcut (D227 reverbed to K/A/U/L — 'S' was old verb)" >&2
  grep -nE "(aria-keyshortcuts|hotkey|shortcut)\s*[:=]\s*['\"](S|s)['\"]" "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

if [ "$violations" -gt 0 ]; then
  echo "" >&2
  echo "   D227: product UI uses 4 verbs — Keep / Archive / Unsubscribe / Later (K/A/U/L)." >&2
  echo "   'Screen' is an internal enum only (triage_decision.verdict='screen')." >&2
  exit 1
fi

exit 0
