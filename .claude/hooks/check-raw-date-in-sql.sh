#!/usr/bin/env bash
# check-raw-date-in-sql.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Fast regex tripwire for the recurring "raw Date/BigInt interpolated
# into a Drizzle `sql` template" bug class. PGlite (the test driver)
# silently coerces a raw JS Date to a string; postgres.js (production)
# sends `Date.toString()` — e.g. "Thu Sep 03 2026 07:46:21 GMT+0000..."
# — as the bind param and Postgres rejects it. This has now shipped to
# production three times (PR #117 D86 2026-05-27; PR #334 2026-07-15;
# packages/workers/src/lapse-reengagement.worker.ts's
# `notDecidedRecently`, live in prod 2026-08-23 through this fix),
# each time invisible to the PGlite-backed test suite that exercised
# it. See CLAUDE.md §2.6 "Never interpolate a JS Date/BigInt directly
# into a raw sql template."
#
# Heuristic (deliberately narrow — see check-microcopy.sh's T3 lesson
# on why an unbounded version of this kind of check rots):
#   - Only files that import `sql` from 'drizzle-orm' are scanned.
#   - Flags `${identifier}` where identifier is BARE (no dot, no call,
#     no cast) and its name looks like a date/time value (ends in
#     Date/Now/Time/Timestamp/At). A safe Drizzle column reference is
#     always dotted (`${table.column}`) and never matches; a safe cast
#     (`${now.toISOString()}`) has a `.` before the closing brace and
#     never matches either. A false negative (an oddly-named date
#     variable) is possible; a false positive on a legitimate bare
#     numeric/string const is not, since those never carry a
#     date-shaped suffix.
#
# This is a tripwire, not a type checker — it catches the exact shape
# that has bitten this codebase three times, nothing more. Exit 1 to
# block; the fix is almost always `.toISOString()}::timestamptz` (or
# the equivalent typed-column comparison via Drizzle's query builder
# instead of a raw template at all).

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

# Only files that actually use Drizzle's raw `sql` tag are in scope —
# everywhere else, `${someDate}` is an ordinary template string with no
# bind-parameter hazard at all.
if ! grep -qE "^\s*import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*['\"]drizzle-orm['\"]" "$file_path" 2>/dev/null; then
  exit 0
fi

pattern='\$\{(now|[a-zA-Z_][a-zA-Z0-9_]*(Date|Now|Time|Timestamp|At))\}'

# Match against a comment-stripped SCAN copy (line count preserved, so
# line numbers still line up with the real file) but report the REAL
# line text — a comment quoting this exact bad pattern as a cautionary
# example (this hook's own header does that, and so does
# score.worker.ts's) is documentation, not the violation. Same carve-out
# check-microcopy.sh makes for the same reason.
scan=$(sed -E \
  -e 's@(^|[^:])//.*$@\1@' \
  -e '/^[[:space:]]*(\*([^\/]|$)|\/\*\*?)/s/.*//' \
  "$file_path")
hit_lines=$(printf '%s\n' "$scan" | grep -nE "$pattern" | cut -d: -f1 || true)

if [ -n "$hit_lines" ]; then
  hits=$(printf '%s\n' "$hit_lines" | while IFS= read -r ln; do
    sed -n "${ln}p" "$file_path" | sed "s/^/${ln}:/"
  done)
  echo "❌ check-raw-date-in-sql: bare date/time identifier interpolated directly into a template string in a file that uses Drizzle's raw \`sql\` tag" >&2
  echo "$hits" | sed 's/^/   /' >&2
  echo "" >&2
  echo "   If this is inside a sql\`...\` template: PGlite (tests) silently accepts a raw JS Date here;" >&2
  echo "   postgres.js (production) sends Date.toString() as the bind param and Postgres rejects it." >&2
  echo "   Fix: \${value.toISOString()}::timestamptz — or use Drizzle's typed column comparison" >&2
  echo "   (eq/lt/gt on a column) instead of a raw template, which binds the Date correctly on its own." >&2
  echo "   If this line is NOT inside a sql\`\` template (e.g. a log message in a file that also uses" >&2
  echo "   sql\`\` elsewhere), this is a false positive — safe to proceed." >&2
  echo "   See CLAUDE.md §2.6 and packages/workers/src/lapse-reengagement.worker.ts's fix." >&2
  exit 1
fi

exit 0
