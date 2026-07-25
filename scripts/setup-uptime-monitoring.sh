#!/usr/bin/env bash
#
# Idempotently creates the public API uptime checks and their founder email
# alert. Existing resources are never updated or deleted; the script only
# fills gaps.
#
# TWO probes, because they detect different failures:
#
#   /api/healthz  liveness  — is the process up? Dependency-free by design,
#                             so it cannot see a dependency outage.
#   /api/readyz   readiness — can it actually serve? 503s when Postgres or
#                             Redis is unreachable.
#
# The second exists because the first is structurally blind to the outage
# that actually happened: Upstash suspended the production Redis for
# exceeding its budget and /healthz answered 200 for 46 days while BullMQ
# could not reach it (7,922 Sentry errors from 2026-06-09). An uptime check
# watching only liveness had nothing to fire on.
#
# Prerequisite: deploy both routes before running this script.
# Auth: gcloud must be logged in with Monitoring + notification-channel access.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
API_HOST="${API_HOST:-api.declutrmail.com}"
ALERT_EMAIL="${ALERT_EMAIL:-chintan.a.thakkar@gmail.com}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "::error::gcloud not on PATH" >&2
  exit 2
fi

echo "Project: ${PROJECT_ID}"
echo "Probes: https://${API_HOST}/api/healthz + /api/readyz"
echo "Alert email: ${ALERT_EMAIL}"
echo ""

# Look up an uptime check by display name; empty when absent.
find_uptime() {
  gcloud monitoring uptime list-configs \
    --project="$PROJECT_ID" \
    --filter="display_name=\"$1\"" \
    --format='value(name)' 2>/dev/null | head -n1
}

# Idempotently create one HTTPS uptime check and echo its check id.
#   $1 display name  $2 path
# The body matcher prevents an unrelated 200 response (CDN error page,
# parked domain, or wrong service) from going green. Both probes emit
# `"status":"ok"` only when genuinely healthy — /readyz reports
# `"status":"degraded"` with a 503, so status-class and body agree.
ensure_uptime() {
  local display="$1" path="$2" name
  name=$(find_uptime "$display")
  if [ -n "$name" ]; then
    echo "  uptime check exists (${name}) — skipping." >&2
  else
    echo "  creating one-minute HTTPS uptime check on ${path}…" >&2
    gcloud monitoring uptime create "$display" \
      --project="$PROJECT_ID" \
      --resource-type=uptime-url \
      --resource-labels="host=${API_HOST},project_id=${PROJECT_ID}" \
      --protocol=https \
      --request-method=get \
      --path="$path" \
      --period=1 \
      --timeout=10 \
      --validate-ssl=true \
      --status-classes=2xx \
      --matcher-type=contains-string \
      --matcher-content='"status":"ok"' >&2
    name=$(find_uptime "$display")
  fi
  if [ -z "$name" ]; then
    echo "::error::could not resolve uptime check '${display}' after create" >&2
    exit 1
  fi
  echo "${name##*/}"
}

echo "[1/3] Uptime checks"
LIVENESS_CHECK_ID=$(ensure_uptime "DeclutrMail API healthz" /api/healthz)
READINESS_CHECK_ID=$(ensure_uptime "DeclutrMail API readyz" /api/readyz)

# 2. Reuse the founder email notification channel if it already exists.
find_channel() {
  gcloud beta monitoring channels list \
    --project="$PROJECT_ID" \
    --filter="type=\"email\" AND labels.email_address=\"${ALERT_EMAIL}\"" \
    --format='value(name)' 2>/dev/null | head -n1
}

CHANNEL_NAME=$(find_channel)
if [ -n "$CHANNEL_NAME" ]; then
  echo "[2/3] Email channel already exists (${CHANNEL_NAME}) — skipping."
else
  echo "[2/3] Creating email notification channel…"
  gcloud beta monitoring channels create \
    --project="$PROJECT_ID" \
    --display-name="DeclutrMail founder (email)" \
    --description="Founder email for production availability alerts" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}"
  CHANNEL_NAME=$(find_channel)
fi

if [ -z "$CHANNEL_NAME" ]; then
  echo "::error::could not resolve notification channel after create" >&2
  exit 1
fi

# 3. Alert when more than one regional probe is failing for two minutes.
# This follows Cloud Monitoring's uptime-policy shape while tightening its
# example's ten-minute window for launch detection. One regional blip does not
# page; a multi-region failure does.
#
# One policy PER probe, deliberately: they mean different things and want
# different first moves. "API unavailable" points at Cloud Run and recent
# deploys; "API not ready" points at Postgres and Redis — most likely a
# vendor suspension or connection-limit ceiling, not the app.
#   $1 policy display name  $2 condition text  $3 check id  $4 runbook text
ensure_policy() {
  local display="$1" condition="$2" check_id="$3" doc="$4" name policy_file
  name=$(gcloud monitoring policies list \
    --project="$PROJECT_ID" \
    --filter="display_name=\"${display}\"" \
    --format='value(name)' 2>/dev/null | head -n1)
  if [ -n "$name" ]; then
    echo "  alert policy exists (${name}) — skipping."
    return
  fi
  echo "  creating alert policy '${display}'…"
  policy_file=$(mktemp)
  cat > "$policy_file" <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "${condition}",
      "conditionThreshold": {
        "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${check_id}\" AND resource.type=\"uptime_url\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 1,
        "duration": "120s",
        "aggregations": [
          {
            "alignmentPeriod": "120s",
            "perSeriesAligner": "ALIGN_NEXT_OLDER",
            "crossSeriesReducer": "REDUCE_COUNT_FALSE",
            "groupByFields": ["resource.label.*"]
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "documentation": { "mimeType": "text/markdown", "content": "${doc}" },
  "notificationChannels": ["${CHANNEL_NAME}"]
}
EOF
  gcloud monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$policy_file"
  rm -f "$policy_file"
}

echo "[3/3] Alert policies"
ensure_policy \
  "DeclutrMail API unavailable" \
  "API healthz fails from multiple regions for 2 minutes" \
  "$LIVENESS_CHECK_ID" \
  "The DeclutrMail API process is unreachable from a majority of Cloud Monitoring probes. Check Cloud Run service health and recent deploys, then verify https://${API_HOST}/api/healthz."
ensure_policy \
  "DeclutrMail API not ready" \
  "API readyz fails from multiple regions for 2 minutes" \
  "$READINESS_CHECK_ID" \
  "The DeclutrMail API is RUNNING but cannot reach a dependency — /healthz will still be green, so do not read that as healthy. Fetch https://${API_HOST}/api/readyz for the per-dependency verdict. Redis down means BullMQ is not processing sync or mail-mutating jobs: check the Upstash console first (a budget suspension has caused this before), then Supabase connection limits."

echo ""
echo "Done — 2 uptime checks + email channel + 2 alert policies are present."
