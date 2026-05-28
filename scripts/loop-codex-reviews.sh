#!/usr/bin/env bash
# Sequentially run Codex adversarial-review on each PR branch.
# Output: docs/reviews/pr-<N>.md per PR. Skips PRs already reviewed.
# Restores starting branch on completion.

set -u
cd /Users/chintant/projects/DeclutrMail

CODEX="/Users/chintant/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs"
PRS=(81 80 79 78 77 76 75 74 73 72 71 70 69 68 67 66 65 64 63)
PER_PR_TIMEOUT=900   # 15 min hard cap per PR (perl watchdog — macOS lacks `timeout`)
START_BRANCH=$(git branch --show-current)

run_with_timeout() {
  # $1=secs, rest=cmd. Returns 124 on timeout (like coreutils `timeout`).
  local secs=$1; shift
  perl -e 'use POSIX; my $secs=shift; my $pid=fork; if($pid==0){ exec @ARGV or die $!; } $SIG{ALRM}=sub{ kill 9,$pid; exit 124 }; alarm $secs; waitpid $pid,0; exit($?>>8);' "$secs" "$@"
}
LOG=docs/reviews/_loop.log

mkdir -p docs/reviews
: > "$LOG"

echo "[$(date)] Loop start. Starting branch: $START_BRANCH" | tee -a "$LOG"

for pr in "${PRS[@]}"; do
  OUT="docs/reviews/pr-$pr.md"
  if [[ -s "$OUT" ]]; then
    echo "[$(date)] PR #$pr already has output, skipping" | tee -a "$LOG"
    continue
  fi

  echo "[$(date)] === PR #$pr checkout ===" | tee -a "$LOG"
  if ! gh pr checkout "$pr" >>"$LOG" 2>&1; then
    echo "[$(date)] PR #$pr checkout FAILED" | tee -a "$LOG"
    echo "# PR #$pr — checkout failed" > "$OUT"
    continue
  fi

  echo "[$(date)] PR #$pr review running (timeout ${PER_PR_TIMEOUT}s)" | tee -a "$LOG"
  STDOUT_TMP=$(mktemp)
  if run_with_timeout "$PER_PR_TIMEOUT" node "$CODEX" adversarial-review --wait --scope branch --base main > "$STDOUT_TMP" 2>>"$LOG"; then
    if [[ -s "$STDOUT_TMP" ]]; then
      cp "$STDOUT_TMP" "$OUT"
    else
      # Stdout empty -- fall back to companion's `result` cmd for the last job
      node "$CODEX" result > "$OUT" 2>>"$LOG" || echo "# PR #$pr — no output captured" > "$OUT"
    fi
    echo "[$(date)] PR #$pr DONE (size=$(wc -c < "$OUT"))" | tee -a "$LOG"
  else
    rc=$?
    cp "$STDOUT_TMP" "$OUT" 2>/dev/null || true
    echo "" >> "$OUT"
    echo "_(exit code $rc — possibly timed out)_" >> "$OUT"
    echo "[$(date)] PR #$pr FAILED rc=$rc (timeout=124)" | tee -a "$LOG"
  fi
  rm -f "$STDOUT_TMP"
done

echo "[$(date)] Restoring starting branch $START_BRANCH" | tee -a "$LOG"
git checkout "$START_BRANCH" >>"$LOG" 2>&1
echo "[$(date)] Loop complete" | tee -a "$LOG"
