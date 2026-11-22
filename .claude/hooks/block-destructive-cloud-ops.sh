#!/usr/bin/env bash
# block-destructive-cloud-ops.sh — PreToolUse hook for Bash
#
# Halts a Bash command that deletes or destroys production infra, stored
# secrets or a non-local database. Reads (list, describe, get, SELECT) pass.
# Git rewrites are left to the deny list in .claude/settings.json.
#
# psql TRUNCATE / DELETE FROM pass only against a local DSN (localhost,
# 127.0.0.1 or $DEV_DATABASE_URL) and with no other host on the line.
#
# Exit 0 = allow. Exit 2 = block. The founder runs a blocked command, or
# approves it for one session (memory: no-destructive-without-approval).

set -euo pipefail

command=$(jq -r '.tool_input.command // empty')
[ -z "$command" ] && exit 0

S='[[:space:]]+'
cloud="gcloud$S(secrets$S(delete|destroy|versions$S(disable|destroy))"
cloud+="|iam$S(service-accounts$S(keys$S)?delete|workload-identity-pools${S}delete)"
cloud+="|kms${S}keys${S}versions${S}destroy|run$S(services|revisions)${S}delete"
cloud+="|pubsub$S(topics|subscriptions)${S}delete"
cloud+="|artifacts$S(repositories|docker|files|packages|tags|versions)${S}delete"
cloud+="|sql$S(instances|databases|backups|users)${S}delete|projects${S}delete"
cloud+="|billing${S}projects${S}unlink|logging$S(metrics|sinks)${S}delete"
cloud+="|((alpha|beta)$S)?monitoring$S(policies|channels)${S}delete"
cloud+="|projects${S}remove-iam-policy-binding)"
cloud+="|gh$S(secret|repo|release)${S}delete|gh${S}api$S.*(-X|--method)${S}DELETE"
cloud+="|vercel$S(rm|remove|project${S}rm|env${S}rm)"
cloud+="|supabase$S(projects${S}delete|db${S}reset)"
cloud+="|redis-cli$S.*(FLUSHDB|FLUSHALL)"
cloud+="|psql$S.+DROP$S(DATABASE|SCHEMA|TABLE|ROLE|USER)"
cloud+="|atlas${S}migrate${S}down|atlas${S}schema${S}apply|drizzle-kit${S}drop"
files="(rm$S(-[rfFv]+$S)*|shred$S).*(\.env(\.|$| )|credentials\.json|auth\.json)"

block() {
  echo "❌ block-destructive-cloud-ops: $1" >&2
  echo "   Command: $command" >&2
  echo "   Deletes against prod, secrets or a shared DB need the founder's go-ahead;" >&2
  echo "   surface the exact command and let them run it." >&2
  exit 2
}

if printf '%s' "$command" | grep -qE "($cloud)([^[:alnum:]_-]|$)|$files"; then
  block "irreversible cloud, secret or database operation."
fi

if printf '%s' "$command" | grep -qiE "psql$S.+(TRUNCATE|DELETE${S}FROM)([^[:alnum:]_]|$)"; then
  local_dsn="postgres(ql)?://([^[:space:]\"'/@]*@)?(localhost|127\.0\.0\.1)([:/][^[:space:]\"']*)?([[:space:]\"']|$)"
  local_dsn+="|(-h|--host)[[:space:]=]*(localhost|127\.0\.0\.1)([[:space:]\"']|$)|\\$\\{?DEV_DATABASE_URL\\}?"
  rest=$(printf '%s' "$command" | sed -E "s#$local_dsn# #g")
  if [ "$rest" = "$command" ] ||
    printf '%s' "$rest" | grep -qE "postgres(ql)?://|(^|[[:space:]])(-h|--host)([[:space:]=]|$)|\\$\\{?[A-Z_]*DATABASE_URL"; then
    block "psql TRUNCATE/DELETE against a non-local database."
  fi
fi

exit 0
