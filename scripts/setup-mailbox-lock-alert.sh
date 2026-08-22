#!/usr/bin/env bash
#
# Pages on the mailbox advisory-lock leak detector.
#
# PR #509 added four structured error lines that detect the 2026-08-12
# leaked-lock class — `mailbox_lock.acquire_failed`, `.unlock_failed`,
# `.unlock_error`, `.session_probe_failed`. A log line nobody is paged on
# only works when someone happens to grep for it, which is the same
# healthz blind spot that let a suspended production Redis answer 200 for
# 46 days (MISTAKES.md 2026-06-10, and the readyz probe that followed).
#
# What a fire means: a mailbox advisory lock leaked or could not be taken.
# `unlock_failed` is the loudest — it means the pooler rebound backends
# and THIS session no longer owns a lock it successfully acquired, so the
# lock is held until that backend dies. Mail-mutating work for the
# affected mailbox blocks behind it.
#
# Creates three resources, check-before-create on each:
#   1. Log-based metric `mailbox_lock_errors`.
#   2. Email notification channel for the founder (reused when present).
#   3. Alert policy: metric > 0 over a 5-min window → notify the channel.
#
# This script NEVER deletes or mutates existing resources — it only
# creates what is missing. Safe to re-run any number of times.
#
# Auth: assumes gcloud is already authed against the target project.
# Notification channels have no GA gcloud surface yet, hence
# `gcloud beta monitoring channels`; metrics + policies use the stable
# surfaces. Mirrors scripts/setup-billing-alerts.sh deliberately — one
# shape for every log-line-to-page alert in this project.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
ALERT_EMAIL="${ALERT_EMAIL:-chintan.a.thakkar@gmail.com}"

METRIC_NAME="mailbox_lock_errors"
POLICY_DISPLAY_NAME="Mailbox lock: leak or acquisition failure"

# Every `mailbox_lock.*` kind, across BOTH Cloud Run services rather than
# pinned to the worker. Only `apps/api/src/worker.ts` takes the lock today
# (`createMailboxActionLock`), but pinning the service name would make this
# a blind guard the moment the API takes it too — and the filter costs
# nothing extra unpinned, because these are the only two services in the
# project. The prefix match covers all four kinds without enumerating them,
# so a fifth added later is alerted on the day it ships.
LOG_FILTER='resource.type="cloud_run_revision" AND jsonPayload.kind=~"^mailbox_lock\."'

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
    --description="Mailbox advisory-lock leak detector: any mailbox_lock.* error line (acquire_failed / unlock_failed / unlock_error / session_probe_failed)" \
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
    --description="Founder email for production availability alerts" \
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
    "content": "A mailbox advisory lock leaked or could not be acquired. Find the line: \`jsonPayload.kind =~ \"^mailbox_lock.\"\` on declutrmail-worker, and read \`mailboxAccountId\`. \`unlock_failed\` is the severe one — the pooler rebound backends and the session no longer owns a lock it acquired, so mail-mutating work for that mailbox blocks until the backend dies. \`acquire_failed\` means a consumer timed out waiting (MAILBOX_LOCK_TIMEOUT). Check pgbouncer/pooler mode and connection churn first. Context: MISTAKES.md 2026-08-12, PR #509."
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
