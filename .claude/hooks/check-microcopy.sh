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

# ── Marketing truth constraints (ADR-0030 T2/T3/T5/T6) ──────────────
#
# ADR-0030:105-108 records that these were NOT hook-enforced: "a false
# reversibility or privacy claim in marketing copy passes CI silently
# today." action-safety.test.ts only asserts against ACTION_SAFETY_SUMMARY
# itself, so a false claim in hero.tsx was never scanned. This block is
# that missing guard.
#
# Only the MECHANICALLY checkable constraints live here. T1 (manual actions
# create no future-mail rules), T4 (Autopilot tiering) and T7 (Trash is a
# separate recovery) are claims about scope and tier, not fixed strings —
# they need a reader, and stay in the copy spec's review brief.
#
# Scope: apps/web/**, packages/shared/src/copy/**, and *.stories.*. The two
# copy modules that DEFINE the bans are exempt: their comments quote the
# banned wording, which is the rule, not a violation (same carve-out the
# privacy-badge rule makes above).
case "$file_path" in
  */packages/shared/src/copy/privacy.ts|*/packages/shared/src/copy/action-safety.ts)
    ;;
  */apps/web/*|*/packages/shared/src/copy/*|*.stories.tsx|*.stories.ts|*.stories.jsx|*.stories.js|*.stories.mdx)
    truth_violations=0

    # T2 — a delivered unsubscribe cannot be recalled, so blanket
    # reversibility is false. Scope undo claims to Archive/Later/Delete
    # and state the window.
    if matches=$(grep -nEi "every action (is )?(reversible|undoable)|fully reversible|always reversible|100% reversible|nothing is permanent|all actions are (reversible|undoable)" "$file_path" 2>/dev/null); then
      echo "❌ check-microcopy: blanket reversibility claim (T2 — a delivered unsubscribe cannot be recalled)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    # T5 — privacy copy is the locked generated badge. Forward-looking
    # absolutes about reading are unfalsifiable AND wrong (metadata IS read).
    if matches=$(grep -nEi "never reads? your (e-?mail|message|inbox)|we never read your|does ?n[o']t read your (e-?mail|message)|never looks? at your (e-?mail|message)" "$file_path" 2>/dev/null); then
      echo "❌ check-microcopy: forward-looking privacy absolute (T5 — use the locked 'Full bodies fetched: 0' badge)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    # T6 — D209 forbidden words. The full list is: AI magic, supercharged,
    # nuke, destroy, blast, obliterate, `smart` standalone, `intelligent`
    # standalone, `AI-powered` standalone.
    if matches=$(grep -nEi "AI magic|supercharg|\bnuke[sd]?\b|obliterat|\bblast(s|ed|ing)?\b|\bdestroy(s|ed|ing)?\b|AI-powered" "$file_path" 2>/dev/null); then
      echo "❌ check-microcopy: D209 forbidden marketing word (T6)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    # T6 — `smart` / `intelligent` STANDALONE. Compound product nouns are
    # legitimate and must not trip this: competitors ship "smart folders"
    # and "Smart Inbox", and comparison pages have to name them. Only the
    # bare adjective applied to DeclutrMail is banned.
    if matches=$(grep -nEiw "smart|intelligent" "$file_path" 2>/dev/null |
      grep -Eiv "smart[- ](folder|label|inbox|filter|compose|reply|feature|view|list)|smartphone|intelligent[- ](sort|sorting|inbox|filter)"); then
      echo "❌ check-microcopy: standalone 'smart'/'intelligent' (T6/D209 — name the mechanism instead)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    # T6 — 'clean' as a verb applied to the user's data. Covers the bare
    # verb and the "clean UP" phrasal form, with an optional intensifier
    # ("clean up your inbox", "cleaning out the mailbox"). The NOUN
    # "cleanup" is fine and is the product's own category word, so the
    # pattern requires a following possessive + data object.
    # A leading quote mark exempts the phrase: copy that QUOTES a vague
    # goal in order to criticise it ("“Clean my inbox” is too broad to
    # verify") is discussing the words, not making the claim — the same
    # carve-out tests and the copy modules get above.
    if matches=$(grep -nEi "(^|[^\"'“‘’[:alnum:]])clean(s|ing|ed)?[[:space:]]+(up[[:space:]]+|out[[:space:]]+)?(your|their|the|my)[[:space:]]+([a-z]+[[:space:]]+)?(gmail|inbox|mail|e-?mail|mailbox|messages)" "$file_path" 2>/dev/null); then
      echo "❌ check-microcopy: 'clean' as a verb on user data (T6/D209 — 'cleanup' the noun is fine)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    # T3 — Screener is soft quarantine: new senders STILL ARRIVE in Gmail.
    # Never claim it blocks, prevents, intercepts, or quarantines.
    if matches=$(grep -nEi "screener[^.]{0,80}(block|prevent|keeps? +out|intercept|quarantin)|(block|prevent|intercept|quarantin)[a-z]*[^.]{0,60}screener" "$file_path" 2>/dev/null); then
      echo "❌ check-microcopy: Screener framed as blocking (T3/D194 — mail still arrives in Gmail)" >&2
      echo "$matches" | sed 's/^/   /' >&2
      truth_violations=$((truth_violations + 1))
    fi

    if [ "$truth_violations" -gt 0 ]; then
      echo "" >&2
      echo "   Truth constraints live in docs/execution/repositioning-copy-spec-2026-08-01.md §1." >&2
      echo "   Positioning rules: docs/adr/0030-positioning-preview-guarantee.md." >&2
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
