#!/usr/bin/env bash
#
# Pages when we cannot read a billing provider, or cannot reach a verdict
# on a refund.
#
# What this exists for, precisely: on 2026-08-14 a refund was issued and
# approved by Paddle within 10.5 hours. Our settlement read — `GET
# /adjustments` — answered 403, because the prod Paddle API key was
# missing the `adjustment.read` permission. The verdict pass logged
# `billing.reconcile.verdict_unreadable` every ten minutes and took no
# action, by design: a read we could not make is never grounds for a
# write.
#
# It logged that line 1,223 times over eleven days. Nobody was paged. The
# customer held no plan and could not repurchase for the entire window,
# and the screen told them to wait for a confirmation that had already
# happened on day one. It surfaced only because the founder opened the
# billing page by hand.
#
# That is the healthz blind spot in its billing form: a revenue gate
# failing continuously, at LOG severity, with no consumer. The line was
# already correct — it named the subscription, the provider and the local
# verdict. It just had no audience.
#
# Creates three resources, check-before-create on each:
#   1. Log-based metric `billing_provider_read_blocked`.
#   2. Email notification channel for the founder (reused when present).
#   3. Alert policy: metric sustained > 0 for 30 min → notify the channel.
#
# This script NEVER deletes or mutates existing resources — it only
# creates what is missing. Safe to re-run any number of times.
#
# Auth: assumes gcloud is already authed against the target project.
# Mirrors scripts/setup-mailbox-lock-alert.sh deliberately — one shape for
# every log-line-to-page alert in this project.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-declutrmail-ai-prod}"
ALERT_EMAIL="${ALERT_EMAIL:-chintan.a.thakkar@gmail.com}"

METRIC_NAME="billing_provider_read_blocked"
POLICY_DISPLAY_NAME="Billing: provider read blocked or refund verdict frozen"

# Deliberately PROVIDER-AGNOSTIC. Pinning `paddle` would make this a blind
# guard for every Indian customer the day a Razorpay refund freezes — the
# same mitigation-recreates-the-bug shape D253 rejected when it refused a
# hardcoded `provider !== 'razorpay'` check.
#
# Three tokens, one class — "we asked the provider and could not get an
# answer":
#   verdict_unreadable   the customer-impact signal, emitted by the
#                        verdict pass for EITHER provider. One line per
#                        frozen refund per tick.
#   api_read.failed      Paddle's cause line (any endpoint).
#   reconcile_read.failed Razorpay's equivalent.
#
# Checkout and portal failures are deliberately NOT here: those surface to
# the customer synchronously and have their own handling. This alert is
# for the reads nobody is watching.
LOG_FILTER='resource.type="cloud_run_revision" AND (textPayload:"verdict_unreadable" OR textPayload:"api_read.failed" OR textPayload:"reconcile_read.failed")'

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
    --description="Billing provider read blocked: verdict_unreadable (refund frozen, either provider) or a Paddle/Razorpay reconciliation read failure" \
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

# ─── 3. Alert policy: sustained > 0 for 30 min → email ──────────────
#
# 30 minutes, not the 5 used by the mailbox-lock policy, and the
# difference is deliberate. The verdict pass ticks every ten minutes
# (BILLING_VERDICT_INTERVAL_MS), so a 600s alignment window holds at most
# one line per frozen row. Requiring the condition to hold for 1800s means
# roughly three consecutive ticks must fail.
#
# That is exactly the transient/stuck distinction that matters here. A
# single Paddle 503 resolves itself on the next tick and must not page. A
# missing API-key permission, a revoked key or a wrong environment never
# resolves and pages within half an hour — against eleven days of silence,
# that is the whole point.
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
      "displayName": "${METRIC_NAME} sustained > 0 for 30 min",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/${METRIC_NAME}\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "1800s",
        "aggregations": [
          {
            "alignmentPeriod": "600s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "documentation": {
    "mimeType": "text/markdown",
    "content": "We cannot read a billing provider, so at least one refund verdict is frozen. A customer may be unable to repurchase.\n\n**Find it:** \`gcloud logging read 'resource.type=\"cloud_run_revision\" AND textPayload:\"verdict_unreadable\"' --project=declutrmail-ai-prod --freshness=1h\` — the line names the provider, subscription id and local verdict. The cause line sits beside it (\`paddle.api_read.failed\` / \`razorpay.reconcile_read.failed\`) and now carries the provider's own error body, which names the reason outright.\n\n**Most likely cause:** an API-key permission. Reproduce with the stored key:\n\n\`\`\`\ncurl -sS -w '\\\\nHTTP %{http_code}\\\\n' -H \"Authorization: Bearer \$(gcloud secrets versions access latest --secret=paddle-api-key-prod --project=declutrmail-ai-prod | tr -d '\\\\n')\" -H 'Paddle-Version: 1' 'https://api.paddle.com/adjustments?per_page=1'\n\`\`\`\n\n403 → fix permissions in Paddle > Developer Tools > Authentication > API keys > Edit. \`adjustment.read\` is the one the settlement read needs; it was missing for eleven days in Aug 2026 and nothing noticed. 401 → the key is wrong or expired.\n\n**Blast radius while it burns:** refunded customers keep their plan for up to REFUND_PENDING_GRACE_DAYS (7) and then lapse into a locked plan picker. Context: MISTAKES.md 2026-08-25."
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
