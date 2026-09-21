#!/usr/bin/env bash
# check-pr-body-d-ref.sh — PR-body D-citation gate (CLAUDE.md §6).
#
# Authoritative copy lives here so the GitHub Action and the local tests
# cannot drift. `.github/workflows/branch-name.yml` job `pr-body` is the
# required check; this script is what it runs.
#
# Passes when ANY of:
#   1. Branch is chore/bootstrap-* or chore/distill-* (exempt).
#   2. Branch is claude/ | codex/ | cursor/ AND the body declares no D-tie.
#   3. Body cites a D-decision in a form that is not the unfilled template:
#        Closes D159 / Closes D-159     — shipping form; impl-log still
#                                         flips ONLY on `Closes D###`
#                                         (packages/config CLOSES_RE).
#        Relates to D159 / Related to   — documented non-flipping form
#                                         (MISTAKES.md 2026-07-17).
#        D-159                          — hyphenated citation.
#        docs/adr/0019 or docs/decisions/0017
#
# Bare `D159` is NOT enough: the PR template's unused API row says
# "Response follows D202 envelope", so accepting a bare D-number would
# green every unfilled template.
#
# Usage: HEAD_REF=... PR_BODY=... ./scripts/check-pr-body-d-ref.sh

set -euo pipefail

HEAD_REF=${HEAD_REF-}
PR_BODY=${PR_BODY-}

if echo "$HEAD_REF" | grep -qE '^chore/(bootstrap|distill)-'; then
  echo "✓ Bootstrap/distill branch — exempt from D-citation requirement."
  exit 0
fi

# Harness-assigned branches may DECLARE no D-tie instead of citing one
# (claude/ 2026-08-28; same constraint for codex/ and cursor/). Deliberately
# not a blanket exemption — most of these PRs DO ship D-decisions.
# Line-leading only: prose that mentions the phrase (this PR's CI notes
# said "declare No D-tie") must not trip the exemption.
if [[ "$HEAD_REF" == claude/* || "$HEAD_REF" == codex/* || "$HEAD_REF" == cursor/* ]] &&
  [[ "$PR_BODY" =~ (^|$'\n')[-*[:blank:]]*[Nn]o[[:blank:]]+D-(tie|number) ]]; then
  echo "✓ Harness branch explicitly declares no D-tie — exempt."
  exit 0
fi

# Matched in-process, not via `printf | grep -q`, because grep -q + pipefail
# SIGPIPE-fails a body that DOES match when the match is early and the
# payload is large (PR #477, `Closes D112` on line 1 of a 3.5 KB body).
# `[[:blank:]]` (space/tab), not `[[:space:]]`: newline between the verb
# and `D159` never counted under the old line-oriented grep, and loosening
# that would accept a heading "Closes" plus an unrelated D later.
if [[ "$PR_BODY" =~ [Cc]loses[[:blank:]]+D-?[0-9]{1,3} ]] ||
  [[ "$PR_BODY" =~ [Rr]elat(es|ed)[[:blank:]]+to[[:blank:]]+D-?[0-9]{1,3} ]] ||
  [[ "$PR_BODY" =~ D-[0-9]{1,3} ]] ||
  [[ "$PR_BODY" =~ docs/(adr|decisions)/[0-9]{4} ]]; then
  echo "✓ PR body cites a D-decision or decision record."
  exit 0
fi

echo "::error::PR body must cite a D-decision or be exempt (CLAUDE.md §6)."
echo "Shipping PRs: 'Closes D###' (this is what flips IMPLEMENTATION-LOG)."
echo "Follow-ups that must not flip a row: 'Relates to D###'."
echo "Also accepted: 'D-159', 'docs/adr/0019-…', 'docs/decisions/0017-…'."
echo "Harness branches (claude/|codex/|cursor/): cite a D, or declare 'No D-tie'."
echo "Otherwise rename the branch to chore/bootstrap-<topic> or chore/distill-<topic>."
exit 1
