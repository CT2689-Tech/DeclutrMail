#!/usr/bin/env bash
# Regression tests for check-microcopy.sh.
#
# Run from repo root: `bash .claude/hooks/test/check-microcopy.test.sh`
# Exits non-zero on the first failed expectation.
#
# Why this file exists: in R1 Stream E (PR #51) the hook fired 3 times on test
# descriptions that quoted the banned verb to assert it does NOT appear in
# rendered UI. The hook was scanning *.test.tsx files as if they were
# user-facing copy, which is the inverse of the intent: tests document
# absence, they don't ship copy. The post-fix hook exempts *.test.* and
# *.spec.* files; these vectors lock that exemption in place + keep the
# Storybook + apps/web scoping honest.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
hook="$repo_root/.claude/hooks/check-microcopy.sh"

# Run the hook with a stub PostToolUse JSON payload pointing at a temp file
# containing $body.
#
# Args:
#   1) absolute path the hook should "see" (we materialise the file at $path
#      so the hook's `-f` check passes)
#   2) body to write into that path
#   3) expected exit code (0 = pass, 1 = block)
expect() {
  local path="$1"
  local body="$2"
  local want_exit="$3"

  mkdir -p "$(dirname "$path")"
  printf '%s' "$body" > "$path"

  local payload
  payload=$(jq -n --arg path "$path" '{tool_input: {file_path: $path}}')

  set +e
  echo "$payload" | "$hook" >/dev/null 2>&1
  local got_exit=$?
  set -e

  if [ "$got_exit" -ne "$want_exit" ]; then
    echo "FAIL: $path (body=${body:0:60}...) wanted exit=$want_exit got exit=$got_exit"
    rm -f "$path"
    return 1
  fi
  rm -f "$path"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Test files are exempt even if the banned verb appears verbatim — that
#    is the WHOLE POINT of a "never renders the word" assertion.
expect "$tmp/apps/web/src/features/triage/foo.test.tsx" \
  $'it("does not render the word Screen anywhere", () => { /* ... */ });\n' \
  0

expect "$tmp/apps/web/src/features/triage/foo.spec.ts" \
  $'expect(html).not.toContain("Screen");\n' \
  0

# 2. Storybook stories remain in scope — they ARE user-facing surface.
#    Stories that contain the banned verb in story copy must still block.
expect "$tmp/apps/web/src/features/triage/triage.stories.tsx" \
  $'export const Default = { args: { title: "Screen later" } };\n' \
  1

# 3. apps/web/** UI files with the banned verb still block.
expect "$tmp/apps/web/src/features/triage/triage-page.tsx" \
  $'export function Page() { return <h1>Screen</h1>; }\n' \
  1

# 4. Files outside apps/web/** and not *.stories.* are out of scope.
expect "$tmp/packages/db/src/schema/triage.ts" \
  $'export const verdictEnum = pgEnum("verdict", ["screen", "keep"]);\n' \
  0

# 5. Documentation surfaces are exempt by the earlier guard, even though
#    they may discuss the rule + name the banned verb.
expect "$tmp/docs/adr/0009-canonical-verbs.md" \
  $'# Why "Screen" is banned from product UI\n' \
  0

echo "OK — all check-microcopy.sh regression cases pass"
