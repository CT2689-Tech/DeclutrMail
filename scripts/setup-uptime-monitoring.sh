#!/usr/bin/env bash
#
# Idempotently creates the public API uptime check and its founder email alert.
# Existing resources are never updated or deleted; the script only fills gaps.
#
# Prerequisite: deploy the /api/healthz route before running this script.
# Auth: gcloud must be logged in with Monitoring + notification-channel access.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
API_HOST="${API_HOST:-api.declutrmail.com}"
ALERT_EMAIL="${ALERT_EMAIL:-chintan.a.thakkar@gmail.com}"

UPTIME_DISPLAY_NAME="DeclutrMail API healthz"
POLICY_DISPLAY_NAME="DeclutrMail API unavailable"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "::error::gcloud not on PATH" >&2
  exit 2
fi

echo "Project: ${PROJECT_ID}"
echo "Probe: https://${API_HOST}/api/healthz"
echo "Alert email: ${ALERT_EMAIL}"
echo ""

# 1. Public HTTPS uptime check. The body matcher prevents an unrelated 200
# response (CDN error page, parked domain, or wrong service) from going green.
UPTIME_NAME=$(gcloud monitoring uptime list-configs \
  --project="$PROJECT_ID" \
  --filter="display_name=\"${UPTIME_DISPLAY_NAME}\"" \
  --format='value(name)' 2>/dev/null | head -n1)

if [ -n "$UPTIME_NAME" ]; then
  echo "[1/3] Uptime check already exists (${UPTIME_NAME}) — skipping."
else
  echo "[1/3] Creating one-minute HTTPS uptime check…"
  gcloud monitoring uptime create "$UPTIME_DISPLAY_NAME" \
    --project="$PROJECT_ID" \
    --resource-type=uptime-url \
    --resource-labels="host=${API_HOST},project_id=${PROJECT_ID}" \
    --protocol=https \
    --request-method=get \
    --path=/api/healthz \
    --period=1 \
    --timeout=10 \
    --validate-ssl=true \
    --status-classes=2xx \
    --matcher-type=contains-string \
    --matcher-content='"status":"ok"'
  UPTIME_NAME=$(gcloud monitoring uptime list-configs \
    --project="$PROJECT_ID" \
    --filter="display_name=\"${UPTIME_DISPLAY_NAME}\"" \
    --format='value(name)' 2>/dev/null | head -n1)
fi

if [ -z "$UPTIME_NAME" ]; then
  echo "::error::could not resolve uptime check after create" >&2
  exit 1
fi
CHECK_ID=${UPTIME_NAME##*/}

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
POLICY_NAME=$(gcloud monitoring policies list \
  --project="$PROJECT_ID" \
  --filter="display_name=\"${POLICY_DISPLAY_NAME}\"" \
  --format='value(name)' 2>/dev/null | head -n1)

if [ -n "$POLICY_NAME" ]; then
  echo "[3/3] Alert policy already exists (${POLICY_NAME}) — skipping."
else
  echo "[3/3] Creating availability alert policy…"
  POLICY_FILE=$(mktemp)
  trap 'rm -f "$POLICY_FILE"' EXIT
  cat > "$POLICY_FILE" <<EOF
{
  "displayName": "${POLICY_DISPLAY_NAME}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "API healthz fails from multiple regions for 2 minutes",
      "conditionThreshold": {
        "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${CHECK_ID}\" AND resource.type=\"uptime_url\"",
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
  "documentation": {
    "mimeType": "text/markdown",
    "content": "The public DeclutrMail API liveness endpoint is failing from a majority of Cloud Monitoring probes. Check Cloud Run service health and recent deploys, then verify https://${API_HOST}/api/healthz."
  },
  "notificationChannels": ["${CHANNEL_NAME}"]
}
EOF
  gcloud monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE"
fi

echo ""
echo "Done — uptime check + email channel + alert policy are present."
