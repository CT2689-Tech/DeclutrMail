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
# MATCHING IS WHITESPACE-NORMALISED, NOT LINE-BASED. grep works a line at
# a time, but what this guards is prose, and Prettier rewraps prose. A
# line-based pattern therefore misses any multi-word ban that happens to
# straddle a break — "Start cleaning up your\n inbox" sailed through the
# first version of this block, as did every phrase split by JSX wrapping
# or string concatenation. Collapsing the file to one whitespace-normal
# stream removes the whole class instead of patching each phrase.
#
# Scope: apps/web/**, packages/shared/src/copy/**, the transactional email
# templates, and *.stories.*. The two copy modules that DEFINE the bans
# are exempt: their comments quote the banned wording, which is the rule,
# not a violation (same carve-out the privacy-badge rule makes above).
case "$file_path" in
  */packages/shared/src/copy/privacy.ts|*/packages/shared/src/copy/action-safety.ts)
    ;;
  */apps/web/*|*/packages/shared/src/copy/*|*/apps/api/src/notifications/templates/*|*.stories.tsx|*.stories.ts|*.stories.jsx|*.stories.js|*.stories.mdx)
    truth_violations=0

    # COMMENTS ARE STRIPPED FIRST. They discuss the rules; they are not
    # copy — the same reason test files are exempt above. Scanning them
    # produces confident nonsense: `// the property that decides blast
    # radius` is a T6 hit, `{/* Archive/Later are fully reversible */}` is
    # a T2 hit, and the Screener's own `— the soft-quarantine` header
    # comment is a T3 hit, all while the shipped strings are fine.
    # Line comments go BEFORE flattening, since flattening destroys the
    # line ends that terminate them. The `[^:]` guard keeps `https://`
    # intact.
    #
    # Then one logical line: newlines and runs of whitespace become single
    # spaces, so wrapped phrases read as continuous prose. JS string
    # concatenation (`'clean up ' + 'your inbox'`) is joined, which splits
    # a phrase without any newline involved.
    #
    # Markup is normalised for the same reason the whitespace is: a ban
    # must not escape by having <Text> or {tier} dropped into the middle
    # of it.
    # Only a CLOSED list of block-level elements becomes a sentence break;
    # everything else — including every capitalised React component — is
    # stripped as mid-sentence formatting. Listing inline tags instead was
    # the wrong way round: the inline set is open (`<Link>`, `<Text>`,
    # `<Pill>`, any component a feature invents), so anything unlisted fell
    # through to the block rule and silently became a full stop, hiding
    # `The Screener <Link>blocks</Link> new senders`. The block set is the
    # small, closed one, so it is the one worth enumerating.
    flat=$(sed -E 's@(^|[^:])//.*$@\1@' "$file_path" |
      tr '\n' ' ' | tr -s '[:space:]' ' ' |
      sed -E 's@/\*[^*]*\*+([^/*][^*]*\*+)*/@ @g' |
      sed -E "s/['\"] *\+ *['\"]//g" |
      sed -E 's/[Ss]oft[- ][Qq]uarantin[a-z]*/SANCTIONEDTERM/g' |
      sed -E 's@\$?\{[^{}]*\}@@g' |
      sed -E 's@</?(p|div|section|article|aside|header|footer|main|nav|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|figure|figcaption|form|fieldset|legend|dl|dt|dd|pre|hr)( [^>]*)?/?>@ . @g' |
      sed -E 's@</?[A-Za-z][A-Za-z0-9.]*( [^>]*)?/?>@@g' |
      tr -s '[:space:]' ' ')
    # Collapse AGAIN at the end: every strip above leaves a gap behind it,
    # so `never reads {x} your email` became `never reads  your email` and
    # stopped matching a pattern that expects single spaces. The removals
    # are what create the double space, so the squeeze has to follow them.

    # check <label> <extended-regex> [exclude-regex]
    # Reports the matched phrases themselves. Line numbers are
    # deliberately omitted: after normalisation a match may span several
    # lines, and pointing at one of them would be misleading.
    check() {
      local label="$1" pattern="$2" exclude="${3:-}" nocase="${4-i}" hits
      # `|| true` is load-bearing: `set -e` is on, and grep exits 1 when it
      # finds nothing, which is the NORMAL case here. Without it a clean
      # file kills the hook mid-run — exit 1 with no message, so every
      # edit looks blocked and no rule ever gets to report.
      hits=$(printf '%s' "$flat" | grep -oE${nocase} "$pattern" 2>/dev/null | sort -u || true)
      if [ -n "$exclude" ] && [ -n "$hits" ]; then
        hits=$(printf '%s\n' "$hits" | grep -Eiv "$exclude" || true)
      fi
      if [ -n "$hits" ]; then
        echo "❌ check-microcopy: $label" >&2
        printf '%s\n' "$hits" | sed 's/^/   → /' >&2
        truth_violations=$((truth_violations + 1))
      fi
    }

    # T2 — a delivered unsubscribe cannot be recalled, so blanket
    # reversibility is false. Scope undo claims to Archive/Later/Delete
    # and state the window.
    check "blanket reversibility claim (T2 — a delivered unsubscribe cannot be recalled)" \
      "every action (is )?(reversible|undoable)|(fully|always|100%) reversible|nothing is permanent|all actions (are )?(reversible|undoable)"

    # T5 — privacy copy is the locked generated badge. Forward-looking
    # absolutes about reading are unfalsifiable AND wrong (metadata IS read).
    check "forward-looking privacy absolute (T5 — use the locked 'Full bodies fetched: 0' badge)" \
      "never reads? your (e-?mail|message|inbox)|we never read your|does ?n[o'’]t read your (e-?mail|message)|never looks? at your (e-?mail|message)"

    # T6 — D209 forbidden words. All nine: AI magic, supercharged, nuke,
    # destroy, blast, obliterate, standalone smart, standalone
    # intelligent, AI-powered. Separator-flexible ("AI powered",
    # "AI-powered") and inflection-flexible ("nuking", "destroys").
    check "D209 forbidden marketing word (T6)" \
      "AI[- ]magic|supercharg[a-z]*|\bnuk(e|es|ed|ing)\b|obliterat[a-z]*|\bblast(s|ed|ing)?\b|\bdestroy(s|ed|ing)?\b|AI[- ]powered"

    # T6 — standalone `smart` / `intelligent`. Compound product nouns are
    # legitimate and must not trip this: competitors ship "smart folders"
    # and "Smart Inbox", and comparison pages have to name them.
    check "standalone 'smart'/'intelligent' (T6/D209 — name the mechanism instead)" \
      "\b(smart|intelligent)\b[- ]?[a-z]*" \
      "smart[- ](folder|label|inbox|filter|compose|reply|feature|view|list)|smartphone|intelligent[- ](sort|sorting|inbox|filter)"

    # T6 — 'clean' as a verb applied to the user's data, including the
    # phrasal form ("clean up your inbox"). The NOUN "cleanup" is fine and
    # is the product's own category word, so the pattern requires a
    # following possessive + data object.
    #
    # A leading TYPOGRAPHIC quote exempts the phrase: copy that QUOTES a
    # vague goal in order to criticise it (“Clean my inbox” is too broad
    # to verify) is discussing the words, not making the claim — the same
    # carve-out tests and the copy modules get above.
    #
    # Straight ' and " deliberately do NOT exempt. They are string-literal
    # syntax far more often than quotation, so honouring them would let
    # `'clean up your inbox'` — the single most likely way this ban is
    # actually violated — walk straight through the carve-out.
    check "'clean' as a verb on user data (T6/D209 — 'cleanup' the noun is fine)" \
      "[^“‘’[:alnum:]]clean(s|ing|ed)? (up |out )?(your|their|the|my) ([a-z]+ )?(gmail|inbox|mail|e-?mail|mailbox|messages)"

    # T3 (Screener framed as blocking) is deliberately NOT enforced here.
    #
    # It was, for six review rounds, and it failed in a new place every
    # single one: line-wrapped phrases, a window that crossed code
    # structure, a closed verb list that lost `quarantining`, a
    # case-sensitivity flag that `${4:-i}` quietly ignored, inline markup
    # that bounded the window, an inline-tag list enumerated when the
    # block list was the closed one, and finally hyphenated custom
    # elements and attributes containing `>`. Rounds three onward were
    # all fixes to fixes.
    #
    # The reason is structural, not a run of bad luck. Every other rule in
    # this block matches a FIXED STRING. T3 is the only one that needs
    # PROXIMITY — "does this sentence attribute blocking to the Screener"
    # — which is a reading, not a match, and each patch narrowed or
    # widened a window that has no correct width.
    #
    # The copy spec already routes exactly this kind of constraint to a
    # human: T1 (manual actions create no future-mail rules), T4
    # (Autopilot tiering) and T7 (Trash is a separate recovery) are all
    # listed there as needing a reader. T3 belongs with them, in the
    # review brief at docs/execution/repositioning-copy-spec-2026-08-01.md
    # §7, not in a regex that reports confident nonsense in both
    # directions.
    #
    # D194's forbidden framings (blocks / prevents / keeps out /
    # intercepts / quarantines) remain binding on copy. They are simply
    # checked by review, like the three constraints beside them.

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
