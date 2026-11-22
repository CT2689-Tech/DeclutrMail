#!/usr/bin/env bash
# block-bypass-flags.sh — PreToolUse hook for Bash
#
# Blocks a git command that skips hooks or signing: --no-verify,
# --no-gpg-sign, or -c commit.gpgsign=false. Fix the failing hook instead.
#
# Only a git invocation counts. Quoted strings are dropped first, so the flag
# named inside a commit message (-m "…") or a PR body (gh … --body "…") passes.
# Each simple command (split on ; & | and newlines) is judged on its own.
#
# Exit 0 to allow; exit 2 to block (Claude Code ignores any other non-zero code).

set -euo pipefail

command=$(jq -r '.tool_input.command // empty')
[ -z "$command" ] && exit 0

hit=$(printf '%s' "$command" | perl -0777 -ne '
  s/"(?:\\.|[^"\\])*"|\x27[^\x27]*\x27/""/gs;   # drop quoted strings
  for my $seg (split /;|&&?|\|\|?|\n/) {
    next unless $seg =~ /^[\s({]*(?:[A-Za-z_]\w*=\S*\s+)*git(?:\s|$)/;
    if ($seg =~ /(?:^|\s)(--no-verify|--no-gpg-sign|commit\.gpgsign=false)(?:\s|=|$)/) {
      print $1; exit;
    }
  }')

if [ -n "$hit" ]; then
  echo "❌ block-bypass-flags: git called with $hit." >&2
  echo "   Command: $command" >&2
  echo "   Fix the failing hook or signing setup instead of bypassing it." >&2
  exit 2
fi

exit 0
