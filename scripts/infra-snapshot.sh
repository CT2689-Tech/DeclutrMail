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
#
# Sentinel: a section that could NOT be captured is `null` — deliberately
# distinct from `[]` / `{}`, which mean "captured, and empty". A drift
# detector that cannot tell those two apart reports "nothing changed"
# about resources it never read.

set -euo pipefail

PROJECT="${GCP_PROJECT:-declutrmail-ai-prod}"
REGION="${GCP_REGION:-us-central1}"
REPO="${GITHUB_REPOSITORY:-CT2689-Tech/DeclutrMail}"
SNAPSHOT_DATE="${SNAPSHOT_DATE:-$(date -u +%Y-%m-%d)}"
SNAPSHOT_TS="${SNAPSHOT_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# Helper: emit "null" instead of erroring if a gcloud call has no
# credentials in the current environment. Lets the same script run
# locally (founder's laptop, partial perms) AND in CI.
#
# A FAILED call emits `null`; only a call that genuinely succeeded with
# no rows emits `[]`. Collapsing those two into `[]` — as this did until
# 2026-07-26 — makes the snapshot assert "this service account has no
# IAM bindings" or "Secret Manager holds no secrets" whenever it merely
# lacked permission to look. That reads as a clean diff forever, which
# is strictly worse than a missing section: it is the same lie the
# GitHub-secrets section told while a stale Razorpay key sat undetected.
safe_gcloud() {
  local out
  if out=$("$@" 2>/dev/null); then
    if [ -z "$out" ]; then
      echo "[]"
    else
      echo "$out"
    fi
  else
    echo "null"
  fi
}

# Guard every `--argjson` input. jq aborts the WHOLE snapshot on one
# invalid value ("invalid JSON text passed to --argjson"), so a single
# section that emits nothing costs all seven — which is exactly how this
# script failed 8 consecutive nightly runs (2026-07-18 → 07-25) without
# producing a single usable snapshot.
#   $1 candidate JSON  $2 fallback JSON
json_or() {
  if [ -n "$1" ] && printf '%s' "$1" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$1"
  else
    printf '%s' "$2"
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
  | jq 'if . == null then null else [.[] | {name: (.name | split("/") | last), createTime}] end'
}

# ─── Atlas migration head ───────────────────────────────────────────
atlas_state() {
  if [ -z "${SUPABASE_SESSION_DSN:-}" ] || ! command -v atlas >/dev/null 2>&1; then
    echo '{"current_version": null, "skipped": "no-dsn-or-no-cli"}'
    return
  fi
  # Grep AFTER the call, not in a pipeline with it: under `pipefail` the
  # `|| true` that absorbs a no-match grep also absorbed an atlas that
  # never ran, so an unreachable database serialized as `{"raw": ""}` —
  # "the migration status is empty" rather than "we could not read it".
  local raw status rc=0
  raw=$(atlas migrate status \
    --url "$SUPABASE_SESSION_DSN?sslmode=require" \
    --dir 'file://packages/db/migrations' 2>/dev/null) || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo '{"raw": null, "unavailable": "atlas migrate status failed (bad DSN, unreachable DB, or unreadable migration dir)"}'
    return
  fi
  status=$(printf '%s\n' "$raw" | grep -E "Current Version|Next Version" || true)
  jq -n --arg s "$status" '{raw: $s}'
}

# ─── IAM bindings on the two runtime SAs ────────────────────────────
# No `// {}` coalesce here on purpose: it turned a failed read into an
# empty policy, i.e. "this service account has no bindings" — the most
# misleading possible answer from a security drift detector.
sa_iam_state() {
  local sa=$1
  safe_gcloud gcloud iam service-accounts get-iam-policy "$sa" \
    --project="$PROJECT" \
    --format='json(bindings[].role, bindings[].members)'
}

# ─── GitHub Actions secret names ────────────────────────────────────
#
# Listing repo secrets requires repo ADMIN. CI's default `GITHUB_TOKEN`
# never carries it regardless of the workflow `permissions:` block, so
# `gh secret list` 403s there and returns nothing — which used to reach
# `--argjson` as an empty string and abort the entire snapshot.
#
# The fix is NOT to fall back to `[]`. An empty array is a claim: "these
# are the secrets, and none changed." Asserting that about a thing we
# never read is the same defect the snapshot exists to catch — a stale
# Razorpay key sat in this repo undetected while this section reported
# nothing was wrong. Report reachability explicitly instead, so a diff
# shows the section going blind rather than going quiet.
#
# Bind `INFRA_SNAPSHOT_TOKEN` (a fine-grained PAT scoped to this repo
# with Secrets: read) to make it readable in CI.
gh_secrets_state() {
  if ! command -v gh >/dev/null 2>&1; then
    echo '{"available": false, "reason": "gh CLI not on PATH"}'
    return
  fi
  local out
  if ! out=$(gh secret list --repo "$REPO" --json name,updatedAt 2>/dev/null); then
    echo '{"available": false, "reason": "gh secret list failed — token lacks repo admin; bind INFRA_SNAPSHOT_TOKEN (fine-grained PAT, Secrets: read)"}'
    return
  fi
  jq -n --argjson s "$(json_or "$out" '[]')" '{available: true, secrets: $s}'
}

# ─── Assemble the snapshot ──────────────────────────────────────────
jq -n \
  --arg date "$SNAPSHOT_DATE" \
  --arg ts "$SNAPSHOT_TS" \
  --arg project "$PROJECT" \
  --argjson api "$(json_or "$(cloud_run_state declutrmail-api)" null)" \
  --argjson worker "$(json_or "$(cloud_run_state declutrmail-worker)" null)" \
  --argjson secrets "$(json_or "$(secrets_state)" null)" \
  --argjson atlas "$(json_or "$(atlas_state)" null)" \
  --argjson api_sa "$(json_or "$(sa_iam_state declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com)" null)" \
  --argjson worker_sa "$(json_or "$(sa_iam_state declutrmail-worker@declutrmail-ai-prod.iam.gserviceaccount.com)" null)" \
  --argjson gh_secrets "$(json_or "$(gh_secrets_state)" null)" \
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
