#!/usr/bin/env bash
#
# Webhook tunnel for local billing testing — expose the api (:4000) via a
# cloudflared quick tunnel and re-point the Paddle SANDBOX notification
# destination at the new hostname.
#
# Why this exists. Quick tunnels mint a NEW hostname on every start, so
# after each restart the Paddle sandbox destination points at a dead host
# and webhooks drop silently — a purchase stops flipping the tier and the
# first instinct is to debug code (billing-test-matrix §0.3 trap). This
# script closes the loop: start tunnel → PATCH the destination's URL.
#
# PATCH-not-create is load-bearing. Each Paddle notification destination
# owns its endpoint secret; a URL PATCH keeps it, so PADDLE_WEBHOOK_SECRET
# in .env.local stays valid. CREATING a destination mints a NEW secret and
# orphans every in-flight checkout signed with the old one (real incident,
# 2026-07-30). So this script never creates — if no destination matches it
# tells you to make one in the dashboard, once, by hand.
#
# Razorpay standard accounts have no webhook-update API — that side stays
# a manual dashboard step, printed at the end.
#
# Usage:
#   ./scripts/dev-tunnel.sh          start (idempotent — reuses a live tunnel)
#   ./scripts/dev-tunnel.sh --stop   stop the tunnel
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/.local-logs"
TUNNEL_PID="$LOG_DIR/tunnel.pid"
TUNNEL_URL_FILE="$LOG_DIR/tunnel.url"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
PADDLE_PATH="/api/webhooks/billing/paddle"
RAZORPAY_PATH="/api/webhooks/billing/razorpay"

mkdir -p "$LOG_DIR"

if [[ "${1:-}" == "--stop" ]]; then
  if [[ -f "$TUNNEL_PID" ]] && kill -0 "$(cat "$TUNNEL_PID")" 2>/dev/null; then
    pid=$(cat "$TUNNEL_PID")
    echo "→ stopping tunnel pid $pid"
    # The pidfile may hold a wrapper subshell (dev-up.sh backgrounding
    # idiom) — sweep children first so cloudflared itself dies too.
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  else
    echo "→ no live tunnel (already stopped)"
  fi
  rm -f "$TUNNEL_PID" "$TUNNEL_URL_FILE"
  echo "✓ tunnel stopped."
  exit 0
fi

# Exported vars win over .env.local, mirroring how the app resolves env
# (same idiom as assert-dev-db.sh). Targeted sed, NOT `source` —
# .env.local holds unrelated secrets this script has no business loading.
PADDLE_API_KEY="${PADDLE_API_KEY:-$(sed -n 's/^PADDLE_API_KEY=//p' .env.local 2>/dev/null | tail -1)}"
PADDLE_ENV="${PADDLE_ENV:-$(sed -n 's/^PADDLE_ENV=//p' .env.local 2>/dev/null | tail -1)}"

# 1. Reuse a live tunnel — makes re-runs (and the dev-up.sh hook) safe:
# no stacked tunnels, and Paddle is simply re-pointed at the same URL.
TUNNEL_URL=""
if [[ -f "$TUNNEL_PID" && -f "$TUNNEL_URL_FILE" ]] && kill -0 "$(cat "$TUNNEL_PID")" 2>/dev/null; then
  TUNNEL_URL="$(cat "$TUNNEL_URL_FILE")"
  echo "→ reusing live tunnel (pid $(cat "$TUNNEL_PID")): $TUNNEL_URL"
fi

# 2. Otherwise start cloudflared and wait for the assigned hostname.
if [[ -z "$TUNNEL_URL" ]]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "✗ cloudflared not installed — brew install cloudflared" >&2
    exit 1
  fi
  rm -f "$TUNNEL_PID" "$TUNNEL_URL_FILE" # stale artifacts from a dead tunnel
  echo "→ starting cloudflared quick tunnel → $TUNNEL_LOG"
  ( cloudflared tunnel --url http://localhost:4000 >"$TUNNEL_LOG" 2>&1 ) &
  echo $! > "$TUNNEL_PID"

  # cloudflared prints the assigned https://<x>.trycloudflare.com in a
  # banner once the edge connection is up — poll rather than fixed-sleep.
  for _ in {1..60}; do
    TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
    [[ -n "$TUNNEL_URL" ]] && break
    sleep 0.5
  done
  if [[ -z "$TUNNEL_URL" ]]; then
    echo "✗ no tunnel URL after 30s — last log lines:" >&2
    tail -20 "$TUNNEL_LOG" >&2
    exit 1
  fi
  printf '%s\n' "$TUNNEL_URL" > "$TUNNEL_URL_FILE"
  echo "→ tunnel up: $TUNNEL_URL"
fi

# 3. HARD GUARD before any Paddle call. This script must never touch a
# production Paddle account: the key must be sandbox by its own prefix AND
# the env must say sandbox. Either miss → manual mode (tunnel stays usable,
# nothing is mutated, exit 0).
if [[ "$PADDLE_API_KEY" != pdl_sdbx_* || "$PADDLE_ENV" != "sandbox" ]]; then
  echo "⚠ Paddle auto-repoint SKIPPED — need PADDLE_API_KEY=pdl_sdbx_* AND PADDLE_ENV=sandbox."
  echo "  Manual mode. Point the webhook destinations at:"
  echo "    Paddle:   ${TUNNEL_URL}${PADDLE_PATH}"
  echo "    Razorpay: ${TUNNEL_URL}${RAZORPAY_PATH}"
  exit 0
fi

# 4. Find the existing sandbox destination for our webhook route. The
# response carries each destination's endpoint secret, so it is held in a
# shell var only — never written to disk, never printed.
echo "→ looking up the Paddle sandbox notification destination"
settings=$(curl -sf https://sandbox-api.paddle.com/notification-settings \
  -H "Authorization: Bearer $PADDLE_API_KEY") || {
  echo "✗ GET /notification-settings failed (network or auth) — nothing changed." >&2
  exit 1
}

set +e
picked=$(printf '%s' "$settings" | python3 -c '
import json, sys
path = sys.argv[1]
entries = [e for e in json.load(sys.stdin).get("data", []) if e.get("destination", "").endswith(path)]
if not entries:
    sys.exit(3)
active = [e for e in entries if e.get("active")]
picked = (active or entries)[0]
print(picked["id"] + "\t" + picked["destination"])
' "$PADDLE_PATH")
rc=$?
set -e
if [[ $rc -eq 3 ]]; then
  # Creating it here is FORBIDDEN — a new destination mints a new endpoint
  # secret, desyncing PADDLE_WEBHOOK_SECRET and orphaning in-flight
  # checkouts signed with the old one. One-time manual step instead:
  echo "✗ no Paddle destination ends with $PADDLE_PATH." >&2
  echo "  Create it ONCE in the dashboard: Paddle sandbox → Developer tools →" >&2
  echo "  Notifications → New destination → URL ${TUNNEL_URL}${PADDLE_PATH}," >&2
  echo "  then copy its endpoint secret into PADDLE_WEBHOOK_SECRET in .env.local." >&2
  echo "  After that, re-runs of this script keep the URL fresh (same secret)." >&2
  exit 1
elif [[ $rc -ne 0 ]]; then
  echo "✗ could not parse the Paddle response — nothing changed." >&2
  exit 1
fi
dest_id="${picked%%$'\t'*}"
before="${picked#*$'\t'}"
new_dest="${TUNNEL_URL}${PADDLE_PATH}"

# 5. PATCH the URL (and re-assert active) on the SAME destination — the
# endpoint secret survives, so PADDLE_WEBHOOK_SECRET keeps verifying.
echo "→ PATCHing Paddle destination $dest_id"
patched=$(curl -sf -X PATCH "https://sandbox-api.paddle.com/notification-settings/$dest_id" \
  -H "Authorization: Bearer $PADDLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"destination\": \"$new_dest\", \"active\": true}") || {
  echo "✗ PATCH failed — destination NOT updated; webhooks will miss until fixed." >&2
  exit 1
}
# Read the destination back from Paddle's response (never the raw body —
# it carries the endpoint secret).
after=$(printf '%s' "$patched" | python3 -c 'import json, sys; print(json.load(sys.stdin)["data"]["destination"])' 2>/dev/null) || after="$new_dest"
echo "  before: $before"
echo "  after:  $after"

echo ""
echo "✓ tunnel ready."
echo "  tunnel:   $TUNNEL_URL"
echo "  paddle:   $dest_id → $after (same endpoint secret — PATCHed, not recreated)"
echo "  razorpay: Razorpay dashboard → Webhooks → set URL to ${TUNNEL_URL}${RAZORPAY_PATH}"
echo "            (Razorpay standard accounts have no webhook-update API — manual, once per tunnel restart)"
echo "  stop:     ./scripts/dev-tunnel.sh --stop"
