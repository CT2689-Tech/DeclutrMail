#!/usr/bin/env bash
#
# Pages when a mailbox has been silently broken past the watchdog's
# grace window, with nobody aware.
#
# Two production incidents (found by manual error review, not by any
# alert — 2026-09-04/05) share one shape: an initial sync stuck on
# `readiness_status = 'failed'` for 8+ days, never onboarded; and an
# incremental sync stuck on a revoked Gmail grant for 16+ days while
# `readiness_status` still read `'ready'`. Neither user saw an error.
# Neither did the founder, until someone happened to look.
#
# `packages/workers/src/stuck-mailbox-watchdog.ts` finds both shapes
# (and, being keyed on state rather than any one error code,
# generalizes to the next one). `apps/api/src/worker.ts` sweeps every
# 15 minutes and emits `mailbox.stuck_unnoticed` once per stuck mailbox
# per tick — deliberately not deduplicated across ticks, since the
# underlying condition (crossed the 2-hour grace window) does not
# self-resolve, so this alert firing on the FIRST tick it appears in is
# correct, not premature.
#
# Creates three resources, check-before-create on each:
#   1. Log-based metric `stuck_mailbox_unnoticed`.
#   2. Email notification channel (reused when present).
#   3. Alert policy: metric > 0 in a 30-min window → notify the channel.
#
# This script NEVER deletes or mutates existing resources — it only
# creates what is missing. Safe to re-run any number of times.
#
# Auth: assumes gcloud is already authed against the target project.
# Mirrors scripts/setup-mailbox-lock-alert.sh and
# setup-billing-verdict-alert.sh deliberately — one shape for every
# log-line-to-page alert in this project.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
ALERT_EMAIL="${ALERT_EMAIL:-admin@declutrmail.ai}"

METRIC_NAME="stuck_mailbox_unnoticed"
POLICY_DISPLAY_NAME="Mailbox stuck: broken past grace window, unnoticed"

LOG_FILTER='resource.type="cloud_run_revision" AND jsonPayload.kind="mailbox.stuck_unnoticed"'

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
    --description="A mailbox has been broken (failed initial sync, or a revoked grant) past the watchdog's 2-hour grace window with nothing recovering it" \
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
    --display-name="DeclutrMail admin (email)" \
    --description="Admin email for production availability alerts" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}"
  CHANNEL_NAME="$(find_channel)"
fi

if [ -z "$CHANNEL_NAME" ]; then
  echo "::error::could not resolve the notification channel after create" >&2
  exit 1
fi

# ─── 3. Alert policy: metric > 0 over 30 min → email ────────────────
#
# The watchdog ticks every 15 minutes (STUCK_MAILBOX_INTERVAL_MS). A
# 30-minute alignment window comfortably captures at least one full
# tick's log line, with margin for log-to-metric ingestion lag —
# without an additional "sustained" delay layered on top, because the
# 2-hour grace window already absorbed the transient-vs-permanent
# distinction upstream, in the query itself. By the time this line
# exists at all, the condition has already held for 2+ hours; the
# first occurrence is the correct moment to page, not a false alarm to
# wait out.
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
      "displayName": "${METRIC_NAME} > 0 over 30 min",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/${METRIC_NAME}\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "1800s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "A mailbox has been broken past the 2-hour grace window with nothing recovering it. Find it: \`gcloud logging read 'resource.type=\"cloud_run_revision\" AND jsonPayload.kind=\"mailbox.stuck_unnoticed\"' --project=declutrmail-ai-prod --freshness=1h\` — the line names \`mailboxAccountId\`, \`reason\` (\`sync_failed\` or \`needs_reconnect\`), \`errorCode\`, and \`stuckSinceHours\`.\n\n\`sync_failed\`: initial sync never completed and nothing is retrying it — check \`dead_letter_jobs\` for the underlying error, and \`provider_sync_state.readiness_status\`/\`error_code\` for that mailbox.\n\n\`needs_reconnect\`: a revoked Gmail grant — the user needs to reconnect. Confirm the reconnect banner is actually reaching them (has the workspace had ANY activity since \`stuckSinceHours\`?); if not, this may need a direct nudge outside the product.\n\nContext: two production incidents found by manual error review, not by any alert, 2026-09-04/05 — this alert exists so the third one doesn't repeat that."
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
