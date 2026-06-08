#!/usr/bin/env bash
# block-destructive-cloud-ops.sh — PreToolUse hook for Bash
#
# Halts any Bash command that performs an irreversible / hard-to-reverse
# operation against production infra, the live Postgres / Redis backends,
# stored secrets, or version control. Reads (list, describe, get, query
# SELECT) pass through untouched.
#
# Rationale (memory `no-destructive-without-approval`): the founder
# rejects unilateral destructive actions from Claude sessions. The
# advisory memory + the per-action approval convention catch most
# cases — this hook is the enforced backstop.
#
# Exit 0 = allow. Exit 1 = block with a message explaining what
# matched and why. To override for a specific session, the founder
# can comment out the matching pattern below OR move the hook out of
# `.claude/settings.json`.

set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -z "$command" ]; then
  exit 0
fi

# Patterns are matched with `grep -qE`. Word boundaries avoid catching
# read-only subcommands that happen to share a word.
forbidden=(
  # GCP destructive operations
  'gcloud[[:space:]]+secrets[[:space:]]+(delete|destroy)\b'
  'gcloud[[:space:]]+secrets[[:space:]]+versions[[:space:]]+(disable|destroy)\b'
  'gcloud[[:space:]]+iam[[:space:]]+service-accounts[[:space:]]+delete\b'
  'gcloud[[:space:]]+iam[[:space:]]+service-accounts[[:space:]]+keys[[:space:]]+delete\b'
  'gcloud[[:space:]]+kms[[:space:]]+keys[[:space:]]+versions[[:space:]]+destroy\b'
  'gcloud[[:space:]]+run[[:space:]]+services[[:space:]]+delete\b'
  'gcloud[[:space:]]+run[[:space:]]+revisions[[:space:]]+delete\b'
  'gcloud[[:space:]]+pubsub[[:space:]]+(topics|subscriptions)[[:space:]]+delete\b'
  'gcloud[[:space:]]+artifacts[[:space:]]+repositories[[:space:]]+delete\b'
  'gcloud[[:space:]]+artifacts[[:space:]]+(docker|files|packages|tags|versions)[[:space:]]+delete\b'
  'gcloud[[:space:]]+sql[[:space:]]+instances[[:space:]]+delete\b'
  'gcloud[[:space:]]+sql[[:space:]]+databases[[:space:]]+delete\b'
  'gcloud[[:space:]]+sql[[:space:]]+backups[[:space:]]+delete\b'
  'gcloud[[:space:]]+sql[[:space:]]+users[[:space:]]+delete\b'
  'gcloud[[:space:]]+projects[[:space:]]+delete\b'
  'gcloud[[:space:]]+billing[[:space:]]+projects[[:space:]]+unlink\b'
  'gcloud[[:space:]]+iam[[:space:]]+workload-identity-pools[[:space:]]+delete\b'
  'gcloud[[:space:]]+logging[[:space:]]+(metrics|sinks)[[:space:]]+delete\b'
  'gcloud[[:space:]]+(alpha|beta)?[[:space:]]*monitoring[[:space:]]+(policies|channels)[[:space:]]+delete\b'
  'gcloud[[:space:]]+projects[[:space:]]+remove-iam-policy-binding\b'

  # GitHub destructive operations
  'gh[[:space:]]+secret[[:space:]]+delete\b'
  'gh[[:space:]]+repo[[:space:]]+delete\b'
  'gh[[:space:]]+release[[:space:]]+delete\b'
  'gh[[:space:]]+api[[:space:]]+.*-X[[:space:]]+DELETE\b'
  'gh[[:space:]]+api[[:space:]]+.*--method[[:space:]]+DELETE\b'

  # Vercel destructive operations
  'vercel[[:space:]]+(rm|remove)\b'
  'vercel[[:space:]]+project[[:space:]]+rm\b'
  'vercel[[:space:]]+env[[:space:]]+rm\b'

  # Supabase CLI / Postgres destructive operations
  'supabase[[:space:]]+projects[[:space:]]+delete\b'
  'supabase[[:space:]]+db[[:space:]]+reset\b'
  'redis-cli[[:space:]]+.*[[:space:]](FLUSHDB|FLUSHALL)\b'
  'psql[[:space:]]+.+DROP[[:space:]]+(DATABASE|SCHEMA|TABLE|ROLE|USER)\b'
  'psql[[:space:]]+.+TRUNCATE\b'
  'psql[[:space:]]+.+DELETE[[:space:]]+FROM\b'

  # Migration toolchain destructive
  'atlas[[:space:]]+migrate[[:space:]]+down\b'
  'atlas[[:space:]]+schema[[:space:]]+apply\b'
  'drizzle-kit[[:space:]]+drop\b'

  # Git rewrites and rewrites-to-remote
  'git[[:space:]]+push[[:space:]]+.*--force\b'
  'git[[:space:]]+push[[:space:]]+.*-f\b'
  'git[[:space:]]+push[[:space:]]+.*--mirror\b'
  'git[[:space:]]+push[[:space:]]+.*--delete\b'
  'git[[:space:]]+reset[[:space:]]+--hard\b'
  'git[[:space:]]+branch[[:space:]]+-D\b'
  'git[[:space:]]+tag[[:space:]]+-d\b'

  # File-system risk surfaces (.env / credentials)
  'rm[[:space:]]+(-[rfFv]+[[:space:]]+)*.*\.env(\.|$| )'
  'rm[[:space:]]+(-[rfFv]+[[:space:]]+)*.*credentials\.json'
  'rm[[:space:]]+(-[rfFv]+[[:space:]]+)*.*auth\.json'
  'shred[[:space:]]+.*\.env(\.|$| )'
)

for pattern in "${forbidden[@]}"; do
  if echo "$command" | grep -qE "$pattern"; then
    echo "block-destructive-cloud-ops: irreversible operation detected." >&2
    echo "   Pattern: $pattern" >&2
    echo "   Command: $command" >&2
    echo "" >&2
    echo "   The founder rule (memory: no-destructive-without-approval):" >&2
    echo "   reads / lists / describes pass freely. Mutations that DELETE," >&2
    echo "   destroy, drop, truncate, force-push, or hard-reset always need" >&2
    echo "   explicit founder approval before execution." >&2
    echo "" >&2
    echo "   To proceed: surface intent + exact command, wait for the" >&2
    echo "   founder's go-ahead, then have them run it directly OR comment" >&2
    echo "   out this pattern in .claude/hooks/block-destructive-cloud-ops.sh" >&2
    echo "   for a single session and revert immediately after." >&2
    exit 1
  fi
done

exit 0
