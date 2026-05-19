#!/usr/bin/env bash
# block-category-prediction.sh — PostToolUse hook for Edit/Write/MultiEdit
#
# Enforces D222: ML-based email category prediction is PERMANENTLY BANNED.
# DeclutrMail does NOT predict newsletter / transactional / personal /
# promotional / etc. categories to auto-protect or auto-route. Categories
# are user-assigned or rule-matched only.
#
# Exit 1 on match.

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
  echo "❌ block-category-prediction: looks like ML email category prediction (D222 — banned forever)" >&2
  grep -nEi "(predict|classify|infer|detect)[a-z_]*(category|categori[sz]ation|class|type)\s*\([^)]*(email|message|mail|msg)" "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

# Common model/feature names that imply category prediction
if grep -nEi "(email|message|mail)[a-z_]*categor[a-z]*(classifier|predictor|model)" "$file_path" >/dev/null 2>&1; then
  echo "❌ block-category-prediction: ML model identifier suggests category prediction (D222)" >&2
  grep -nEi "(email|message|mail)[a-z_]*categor[a-z]*(classifier|predictor|model)" "$file_path" | sed 's/^/   /' >&2
  violations=$((violations + 1))
fi

# Explicit category enum (newsletter/transactional/personal/promotional)
# WITH ML scaffolding nearby. Flag if both terms present in the same file.
if grep -nEi "(newsletter|transactional|personal|promotional|social|update)" "$file_path" >/dev/null 2>&1 \
   && grep -nEi "(\.predict\(|\.classify\(|\.infer\(|model\.run|ml\.predict|haiku|sonnet|opus)" "$file_path" >/dev/null 2>&1; then
  echo "⚠️  block-category-prediction: email category vocabulary + ML inference in same file (D222 — verify intent)" >&2
  violations=$((violations + 1))
fi

if [ "$violations" -gt 0 ]; then
  echo "" >&2
  echo "   D222: ML-based email category prediction is permanently banned at all versions." >&2
  echo "   Categories are user-assigned or rule-matched only — never ML-predicted." >&2
  exit 1
fi

exit 0
