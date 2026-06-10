#!/usr/bin/env bash
# scripts/setup-billing-alerts.sh
#
# Idempotent setup for the Upstash quota-exhaustion alert chain
# (2026-06-09 incident: free-tier 500K command cap hit → every BullMQ
# queue rejected commands for ~41h with no alert; the only signal was
# the sync-stuck watchdog firing on the downstream symptom. See
# MISTAKES.md 2026-06-10).
#
# Creates three resources, check-before-create on each:
#   1. Log-based metric `bullmq_max_requests_errors` — counts worker
#      log lines where Upstash rejects a command with
#      "max requests limit exceeded".
#   2. Email notification channel for the founder (reused if one
#      already exists for the address).
#   3. Alert policy: metric > 0 over a 5-min window → notify the
#      channel.
#
# This script NEVER deletes or mutates existing resources — it only
# creates what's missing. Safe to re-run any number of times.
#
# Auth: assumes gcloud is already authed against the target project
# (CI: WIF; local: founder's active account). Notification channels
# have no GA gcloud surface yet, hence `gcloud beta monitoring
# channels`; metrics + policies use the stable surfaces.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
ALERT_EMAIL="${ALERT_EMAIL:-chintan.a.thakkar@gmail.com}"

METRIC_NAME="bullmq_max_requests_errors"
POLICY_DISPLAY_NAME="BullMQ: Upstash max-requests limit exceeded (worker)"

# Matches the exact Upstash rejection the worker logs as a structured
# bullmq.error line ("ERR max requests limit exceeded. Limit: 500000").
LOG_FILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="declutrmail-worker" AND jsonPayload.kind="bullmq.error" AND jsonPayload.message=~"max requests limit exceeded"'

if ! command -v gcloud >/dev/null 2>&1; then
  echo "::error::gcloud not on PATH" >&2
  exit 2
fi

echo "Project: ${PROJECT_ID}"
echo "Alert email: ${ALERT_EMAIL}"
echo ""

# ─── 1. Log-based metric ────────────────────────────────────────────
if gcloud logging metrics describe "$METRIC_NAME" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "[1/3] Log metric ${METRIC_NAME} already exists — skipping."
else
  echo "[1/3] Creating log metric ${METRIC_NAME}…"
  gcloud logging metrics create "$METRIC_NAME" \
    --project="$PROJECT_ID" \
    --description="Worker bullmq.error lines where Upstash rejects a command (max requests limit exceeded)" \
    --log-filter="$LOG_FILTER"
fi

# ─── 2. Email notification channel ──────────────────────────────────
# Reuse any existing email channel for the address regardless of its
# display name — the address is the identity, not the label.
find_channel() {
  gcloud beta monitoring channels list \
    --project="$PROJECT_ID" \
    --filter="type=\"email\" AND labels.email_address=\"${ALERT_EMAIL}\"" \
    --format='value(name)' 2>/dev/null | head -n1
}

CHANNEL_NAME="$(find_channel)"
if [ -n "$CHANNEL_NAME" ]; then
  echo "[2/3] Email channel for ${ALERT_EMAIL} already exists (${CHANNEL_NAME}) — skipping."
else
  echo "[2/3] Creating email notification channel for ${ALERT_EMAIL}…"
  gcloud beta monitoring channels create \
    --project="$PROJECT_ID" \
    --display-name="DeclutrMail founder (email)" \
    --description="Founder email for vendor-limit / billing alerts" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}"
  CHANNEL_NAME="$(find_channel)"
fi

if [ -z "$CHANNEL_NAME" ]; then
  echo "::error::could not resolve the notification channel after create" >&2
  exit 1
fi

# ─── 3. Alert policy: metric > 0 over 5 min → email ─────────────────
EXISTING_POLICY=$(gcloud monitoring policies list \
  --project="$PROJECT_ID" \
  --filter="display_name=\"${POLICY_DISPLAY_NAME}\"" \
  --format='value(name)' 2>/dev/null | head -n1)

if [ -n "$EXISTING_POLICY" ]; then
  echo "[3/3] Alert policy \"${POLICY_DISPLAY_NAME}\" already exists (${EXISTING_POLICY}) — skipping."
else
  echo "[3/3] Creating alert policy \"${POLICY_DISPLAY_NAME}\"…"
  POLICY_FILE=$(mktemp)
  trap 'rm -f "$POLICY_FILE"' EXIT
  cat > "$POLICY_FILE" <<EOF
{
  "displayName": "${POLICY_DISPLAY_NAME}",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "${METRIC_NAME} > 0 over 5 min",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/${METRIC_NAME}\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "Upstash Redis is rejecting BullMQ commands (max requests limit exceeded). The whole async layer is down: syncs, scoring, undo-expiry, unsubscribe execution. First action: Upstash console → check plan/usage; confirm the Fixed plan is active. Runbook context: MISTAKES.md 2026-06-10."
  },
  "notificationChannels": ["${CHANNEL_NAME}"]
}
EOF
  gcloud monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE"
fi

echo ""
echo "Done — metric + channel + policy in place on ${PROJECT_ID}."
