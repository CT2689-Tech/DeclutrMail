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
# Sentinels, in descending order of what we actually know:
#   <data>                captured
#   [] / {}               captured, and genuinely empty
#   {"not_found": true}   the API said the resource does not exist
#   {"available": false}  a section we could not reach, with a reason
#   null                  not captured (auth, permission, network)
# These are deliberately distinct. A drift detector that collapses them
# reports "nothing changed" about resources it never read, which is the
# one failure mode that makes the whole file worthless.

set -euo pipefail

PROJECT="${GCP_PROJECT:-declutrmail-ai-prod}"
REGION="${GCP_REGION:-us-central1}"
# The worker lives in its own region (deploy-cloud-run.yml WORKER_REGION):
# it has no domain mapping, so it moved to us-west1 to sit in the same
# metro as the database while the API waits for a certificate cutover.
# A snapshot that looked in one region would find the worker absent and
# record `null` — indistinguishable from a worker that is genuinely gone,
# which is exactly the drift this file exists to detect.
WORKER_REGION="${GCP_WORKER_REGION:-us-west1}"

# Region for one service name.
region_for() {
  case "$1" in
    declutrmail-worker) printf '%s' "$WORKER_REGION" ;;
    *)                  printf '%s' "$REGION" ;;
  esac
}
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
# Three outcomes, three encodings — a failed call is not one state:
#   <data>              the read succeeded
#   []                  the read succeeded and there was nothing there
#   {"not_found": true} the API answered "no such resource"
#   null                the read did not happen (auth, permission, network)
#
# The NOT_FOUND split matters for drift: `declutrmail-worker@` does not
# exist today, and "the SA is still absent" must stay distinguishable
# from "we could not check tonight" — otherwise the day it gets created
# (the remediation in FOUNDER-FOLLOWUPS) looks identical to a flaky run.
#
# We record the API's verdict, we do not interpret it. Google merges the
# two cases itself when a whole project is unreachable: "does not have
# permission to access projects instance [...] (or it may not exist):
# Permission denied". Hence the match ORDER below — an explicit
# permission/auth failure must win over the "may not exist" in the same
# sentence, or a credentials outage would serialize as "absent".
safe_gcloud() {
  local out err msg
  err=$(mktemp)
  if out=$("$@" 2>"$err"); then
    rm -f "$err"
    if [ -z "$out" ]; then
      echo "[]"
    else
      echo "$out"
    fi
    return
  fi
  msg=$(tr '\n' ' ' < "$err")
  rm -f "$err"
  if printf '%s' "$msg" | grep -qiE 'UNAUTHENTICATED|PERMISSION_DENIED|does not have permission|permission denied'; then
    echo "null"
  elif printf '%s' "$msg" | grep -qiE 'NOT_FOUND|cannot find'; then
    echo '{"not_found": true}'
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
  local rev_json env_json traffic_json svc_region
  svc_region=$(region_for "$svc")
  rev_json=$(safe_gcloud gcloud run revisions list \
    --service="$svc" --project="$PROJECT" --region="$svc_region" \
    --limit=1 \
    --format='json(metadata.name, spec.containers[0].image, metadata.creationTimestamp, status.conditions[0].status)')
  env_json=$(safe_gcloud gcloud run services describe "$svc" \
    --project="$PROJECT" --region="$svc_region" \
    --format='json(spec.template.spec.containers[0].env[].name)')
  traffic_json=$(safe_gcloud gcloud run services describe "$svc" \
    --project="$PROJECT" --region="$svc_region" \
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
  | jq 'if type == "array" then [.[] | {name: (.name | split("/") | last), createTime}] else . end'
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
