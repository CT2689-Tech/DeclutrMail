#!/usr/bin/env bash
# block-category-prediction.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces CLAUDE.md §2.4: no ML-based email category prediction. This is
# a product choice with no external backing; the founder decides whether
# it stays. Until then it blocks exactly what it always has.
# DeclutrMail does NOT predict newsletter / transactional / personal /
# promotional / etc. categories to auto-protect or auto-route. Categories
# are user-assigned or rule-matched only.
#
# Exit 2 on match.

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

# Scan code + config + tests; exempt docs/agent/hook surfaces (they discuss the rule).
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.sql|*.json|*.yml|*.yaml)
    ;;
  *)
    exit 0
    ;;
esac

case "$file_path" in
  */.claude/*|*/CLAUDE.md|*/LEARNINGS.md|*/MISTAKES.md|*/IMPLEMENTATION-LOG.md|*/docs/*|*/.github/*)
    exit 0
    ;;
esac

# Patterns that smell like email category prediction.
# The terms here are intentionally specific — generic "classify" /
# "predict" would false-positive on many legitimate uses (sender
# protection scoring, action recommendation, etc.).
violations=0

if grep -nEi "(predict|classify|infer|detect)[a-z_]*(category|categori[sz]ation|class|type)\s*\([^)]*(email|message|mail|msg)" "$file_path" >/dev/null 2>&1; then
  echo "❌ block-category-prediction: looks like ML email category prediction (CLAUDE.md §2.4)" >&2
  grep -nEi "(predict|classify|infer|detect)[a-z_]*(category|categori[sz]ation|class|type)\s*\([^)]*(email|message|mail|msg)" "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

# Common model/feature names that imply category prediction
if grep -nEi "(email|message|mail)[a-z_]*categor[a-z]*(classifier|predictor|model)" "$file_path" >/dev/null 2>&1; then
  echo "❌ block-category-prediction: ML model identifier suggests category prediction (CLAUDE.md §2.4)" >&2
  grep -nEi "(email|message|mail)[a-z_]*categor[a-z]*(classifier|predictor|model)" "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

# NOTE: a third heuristic — co-occurrence of category vocabulary
# (newsletter / transactional / etc.) AND any LLM call in the same file
# — was removed after early review: it false-positived on legitimate
# brief generation (the Brief uses Haiku) and on per-category UI surfaces.
# The semantic §2.4 check belongs in an agent (architecture-guardian),
# not a hook.

if [ "$violations" -gt 0 ]; then
  echo "" >&2
  echo "   CLAUDE.md §2.4: no ML-based email category prediction (a product choice — the founder's call)." >&2
  echo "   Categories are user-assigned or rule-matched only — never ML-predicted." >&2
  exit 2
fi

exit 0
