#!/usr/bin/env bash
# check-microcopy.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces D227 canonical verbs (Keep / Archive / Unsubscribe / Later — K/A/U/L)
# in product UI surfaces. "Screen" is an internal enum only — never user-facing.
#
# Also enforces the D228 privacy-badge rule: the pre-D228 trust copy
# "Bodies read: 0" is banned in product surfaces (CLAUDE.md §2.1) — the
# locked replacement is "Full bodies fetched: 0" + the explicit storage
# list, rendered by PrivacyBadge from packages/shared/src/copy/privacy.ts.
#
# Scope: apps/web/** and any *.stories.tsx file (Storybook copy must also
# comply); the privacy-badge rule additionally covers packages/shared/**.
# Skipped: .claude/, docs/, CLAUDE.md, agent definitions, the plan mirror, this hook.
#
# Exit 1 to block on canonical-verbs or privacy-badge violation.

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

# Test files are exempt: tests document intent (e.g. "never uses the word
# 'Screen' in any rendered surface"), not user-facing copy. Including the
# banned token inside an `it(...)` / `describe(...)` description or an
# `expect(...).not.toMatch('Screen')` assertion is the WHOLE POINT of the
# test — it would be absurd to forbid it. Storybook stories remain in scope
# (they ARE user-facing surface) but *.stories.test.* files are tests.
case "$file_path" in
  *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx)
    exit 0
    ;;
esac

# Privacy badge rule (D228 + CLAUDE.md §2.1): the pre-D228 trust copy
# "Bodies read: 0" is banned in product surfaces. The locked replacement
# is "Full bodies fetched: 0" + the explicit storage list — render
# <PrivacyBadge> from @declutrmail/shared; copy literals live ONLY in
# packages/shared/src/copy/privacy.ts.
#
# Scope: apps/web/**, packages/shared/**, and any *.stories.* file. The
# copy module itself is exempt — its comments document the banned wording
# (like tests, that mention IS the rule, not user-facing copy).
case "$file_path" in
  */packages/shared/src/copy/privacy.ts)
    ;;
  */apps/web/*|*/packages/shared/*|*.stories.tsx|*.stories.ts|*.stories.jsx|*.stories.js|*.stories.mdx)
    if grep -nF 'Bodies read: 0' "$file_path" >/dev/null 2>&1; then
      echo "❌ check-microcopy: banned pre-D228 trust copy 'Bodies read: 0' (D228 — use 'Full bodies fetched: 0')" >&2
      grep -nF 'Bodies read: 0' "$file_path" | sed 's/^/   /' >&2
      echo "" >&2
      echo "   D228: the trust badge says 'Full bodies fetched: 0' + the explicit storage list." >&2
      echo "   Render <PrivacyBadge> from @declutrmail/shared — copy lives only in packages/shared/src/copy/privacy.ts." >&2
      exit 1
    fi
    ;;
esac

# Scope: apps/web/** + any *.stories.* anywhere (Storybook stories live in
# packages/shared and apps/web both)
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
