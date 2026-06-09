#!/usr/bin/env bash
# scripts/infra-snapshot.sh
#
# Daily drift detector — captures the state of every external resource
# DeclutrMail depends on into a JSON blob that gets committed to
# docs/infra-snapshots/YYYY-MM-DD.json. Tomorrow's run diffs against
# today's; a non-empty diff is what the founder reads.
#
# What gets captured:
#   * Cloud Run revisions (API + worker) — name, image SHA, env vars
#     (names only, not values), allocated CPU/memory, traffic split.
#   * GCP Secret Manager — secret names + latest version numbers
#     (NOT values).
#   * Atlas migration head — DB's current revision per Atlas.
#   * IAM policy on the two runtime SAs (declutrmail-api,
#     declutrmail-worker) — bindings only.
#   * GitHub Actions secret names (NOT values) for the repo.
#
# WHAT'S DELIBERATELY EXCLUDED:
#   * Any secret VALUE — only names + version IDs. The snapshot lives
#     in the public repo; treating it as untrusted.
#   * User PII / mail data — the snapshot is infra-only.
#
# Privacy (D7 / D228): no row reads of mail_messages / senders /
# triage_decisions. The Supabase touchpoint is `atlas migrate status`
# which reads only `atlas_schema_revisions`.
#
# Auth:
#   * GCP: assumes gcloud is already authed (CI: WIF; local: founder's
#     active account).
#   * Atlas: reads `SUPABASE_SESSION_DSN` env if set; skips DB row
#     gracefully if unset (local dev without prod creds).
#   * GitHub: assumes `gh` is authed (CI: GITHUB_TOKEN; local: founder's
#     `gh auth login`).
#
# Output: stdout = JSON. The workflow handles writing + committing.

set -euo pipefail

PROJECT="${GCP_PROJECT:-declutrmail-ai-prod}"
REGION="${GCP_REGION:-us-central1}"
REPO="${GITHUB_REPOSITORY:-CT2689-Tech/DeclutrMail}"
SNAPSHOT_DATE="${SNAPSHOT_DATE:-$(date -u +%Y-%m-%d)}"
SNAPSHOT_TS="${SNAPSHOT_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# Helper: emit "null" instead of erroring if a gcloud call has no
# credentials in the current environment. Lets the same script run
# locally (founder's laptop, partial perms) AND in CI.
safe_gcloud() {
  local out
  if out=$("$@" 2>/dev/null); then
    if [ -z "$out" ]; then
      echo "[]"
    else
      echo "$out"
    fi
  else
    echo "[]"
  fi
}

# ─── Cloud Run revisions (API + worker) ─────────────────────────────
cloud_run_state() {
  local svc=$1
  local rev_json env_json traffic_json
  rev_json=$(safe_gcloud gcloud run revisions list \
    --service="$svc" --project="$PROJECT" --region="$REGION" \
    --limit=1 \
    --format='json(metadata.name, spec.containers[0].image, metadata.creationTimestamp, status.conditions[0].status)')
  env_json=$(safe_gcloud gcloud run services describe "$svc" \
    --project="$PROJECT" --region="$REGION" \
    --format='json(spec.template.spec.containers[0].env[].name)')
  traffic_json=$(safe_gcloud gcloud run services describe "$svc" \
    --project="$PROJECT" --region="$REGION" \
    --format='json(status.traffic[].revisionName, status.traffic[].percent)')
  jq -n \
    --arg svc "$svc" \
    --argjson revs "$rev_json" \
    --argjson env "$env_json" \
    --argjson traffic "$traffic_json" \
    '{service: $svc, latest_revision: $revs, env_var_names: $env, traffic: $traffic}'
}

# ─── Secret Manager — names + latest version ────────────────────────
secrets_state() {
  safe_gcloud gcloud secrets list --project="$PROJECT" \
    --format='json(name, createTime)' \
  | jq '[.[] | {name: (.name | split("/") | last), createTime}]'
}

# ─── Atlas migration head ───────────────────────────────────────────
atlas_state() {
  if [ -z "${SUPABASE_SESSION_DSN:-}" ] || ! command -v atlas >/dev/null 2>&1; then
    echo '{"current_version": null, "skipped": "no-dsn-or-no-cli"}'
    return
  fi
  local status
  status=$(atlas migrate status \
    --url "$SUPABASE_SESSION_DSN?sslmode=require" \
    --dir 'file://packages/db/migrations' 2>/dev/null \
    | grep -E "Current Version|Next Version" || true)
  jq -n --arg s "$status" '{raw: $s}'
}

# ─── IAM bindings on the two runtime SAs ────────────────────────────
sa_iam_state() {
  local sa=$1
  safe_gcloud gcloud iam service-accounts get-iam-policy "$sa" \
    --project="$PROJECT" \
    --format='json(bindings[].role, bindings[].members)' \
  | jq '. // {}'
}

# ─── GitHub Actions secret names ────────────────────────────────────
gh_secrets_state() {
  if ! command -v gh >/dev/null 2>&1; then
    echo '[]'
    return
  fi
  gh secret list --repo "$REPO" --json name,updatedAt 2>/dev/null | jq '. // []'
}

# ─── Assemble the snapshot ──────────────────────────────────────────
jq -n \
  --arg date "$SNAPSHOT_DATE" \
  --arg ts "$SNAPSHOT_TS" \
  --arg project "$PROJECT" \
  --argjson api "$(cloud_run_state declutrmail-api)" \
  --argjson worker "$(cloud_run_state declutrmail-worker)" \
  --argjson secrets "$(secrets_state)" \
  --argjson atlas "$(atlas_state)" \
  --argjson api_sa "$(sa_iam_state declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com)" \
  --argjson worker_sa "$(sa_iam_state declutrmail-worker@declutrmail-ai-prod.iam.gserviceaccount.com)" \
  --argjson gh_secrets "$(gh_secrets_state)" \
  '{
    snapshot_date: $date,
    snapshot_ts: $ts,
    gcp_project: $project,
    cloud_run: {
      api: $api,
      worker: $worker
    },
    secret_manager: $secrets,
    atlas_migration: $atlas,
    iam: {
      declutrmail_api_sa: $api_sa,
      declutrmail_worker_sa: $worker_sa
    },
    github_actions_secrets: $gh_secrets
  }'
