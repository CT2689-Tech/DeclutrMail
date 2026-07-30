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
# Which destination? The one whose endpoint secret EQUALS our
# PADDLE_WEBHOOK_SECRET — that is the only destination this app can verify,
# so it is the only one this script may ever touch. URL suffix matching
# (the first version) could hijack someone else's destination or a stable
# endpoint; secret identity cannot (Codex stop-review 2026-07-30).
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
TUNNEL_CMD_MATCH="cloudflared tunnel --url http://localhost:4000"

mkdir -p "$LOG_DIR"

# Pid identity, not pid existence: after a reboot the OS reuses pids, so a
# stale pidfile can name an UNRELATED process. Killing (or trusting) it on
# `kill -0` alone kills bystanders / "reuses" a tunnel that is not there
# (Codex stop-review 2026-07-30). A pid counts ONLY if its command line is
# our exact invocation — port included. No bare-`cloudflared` fallback:
# that accepted any cloudflared on the box (another project's tunnel, a
# named tunnel), which --stop would then kill (second Codex round). The
# `( cmd ) & ` backgrounding idiom exec-optimizes, so the recorded pid IS
# cloudflared with this exact argv (verified live via `ps -o command=`);
# a wrapper-subshell pid would fail the match and safely read as stale.
is_our_tunnel() {
  local pid="$1" cmd
  [[ -n "$pid" ]] || return 1
  cmd=$(ps -p "$pid" -o command= 2>/dev/null) || return 1
  [[ "$cmd" == *"$TUNNEL_CMD_MATCH"* ]]
}

# Probe a tunnel URL, BYPASSING the system resolver. Load-bearing: probing
# a fresh hostname through getaddrinfo before its DNS record propagates
# plants an NXDOMAIN in mDNSResponder, and trycloudflare's negative TTL
# keeps it for ~30 min — the probe poisons the thing it measures, while
# Paddle's own resolvers (remote, never pre-queried) deliver fine (live
# incident, 2026-07-30: two "dead" tunnels answered 200 via pinned IP).
# dig asks 1.1.1.1 directly; curl --resolve pins the answer. Echoes the
# HTTP code; 000 = unreachable.
probe_url() {
  local url="$1" host ip code=000
  host="${url#https://}"; host="${host%%/*}"
  ip=$(dig +short @1.1.1.1 "$host" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)
  if [[ -n "$ip" ]]; then
    code=$(curl -s -o /dev/null --max-time 8 --resolve "$host:443:$ip" -w '%{http_code}' "$url" 2>/dev/null) || true
  else
    code=$(curl -s -o /dev/null --max-time 8 -w '%{http_code}' "$url" 2>/dev/null) || true
  fi
  printf '%s' "${code:-000}"
}

if [[ "${1:-}" == "--stop" ]]; then
  pid="$(cat "$TUNNEL_PID" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    if is_our_tunnel "$pid"; then
      echo "→ stopping tunnel pid $pid"
      # The pidfile may hold a wrapper subshell (backgrounding idiom) —
      # sweep children first so cloudflared itself dies too.
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    else
      echo "⚠ pid $pid is alive but is NOT our cloudflared (pid reuse) — refusing to kill it."
      echo "  Clearing stale tunnel files only."
    fi
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
PADDLE_WEBHOOK_SECRET="${PADDLE_WEBHOOK_SECRET:-$(sed -n 's/^PADDLE_WEBHOOK_SECRET=//p' .env.local 2>/dev/null | tail -1)}"
# Whitespace-only means unset — a blank selector must fall to manual mode,
# never reach the API and "match" nothing confusingly.
PADDLE_WEBHOOK_SECRET="$(printf '%s' "$PADDLE_WEBHOOK_SECRET" | tr -d '[:space:]')"

# 1. Reuse a live tunnel — makes re-runs (and the dev-up.sh hook) safe: no
# stacked tunnels, and Paddle is simply re-pointed at the same URL. Reuse
# requires pid IDENTITY (our cloudflared, not a reused pid) AND an edge
# that still answers for the hostname — otherwise the script would PATCH
# Paddle onto a dead host and exit green, the silent blackhole it exists
# to prevent. Any HTTP status except 000 (no connection) / 530 (tunnel
# unregistered at the edge) proves the tunnel: a 502 just means the api
# behind it is down, which is not this script's business.
TUNNEL_URL=""
pid="$(cat "$TUNNEL_PID" 2>/dev/null || true)"
if [[ -n "$pid" && -f "$TUNNEL_URL_FILE" ]] && kill -0 "$pid" 2>/dev/null && is_our_tunnel "$pid"; then
  candidate="$(cat "$TUNNEL_URL_FILE")"
  [[ "$candidate" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]] || candidate=""
  # One failed probe must not kill a healthy tunnel — 3 tries. probe_url
  # (not bare curl): bare curl double-appended 000 via its fallback echo
  # AND read through the poisoned local resolver (both caught live,
  # 2026-07-30).
  edge=000
  if [[ -n "$candidate" ]]; then
    for _ in 1 2 3; do
      edge=$(probe_url "$candidate")
      [[ "$edge" != "000" && "$edge" != "530" ]] && break
      sleep 4
    done
  fi
  if [[ -n "$candidate" && "$edge" != "000" && "$edge" != "530" ]]; then
    TUNNEL_URL="$candidate"
    echo "→ reusing live tunnel (pid $pid, edge HTTP $edge): $TUNNEL_URL"
  else
    echo "⚠ tunnel pid $pid alive but edge answers $edge for $candidate — restarting tunnel."
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
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
  # `-a` is load-bearing: the log carries control bytes, and without it
  # grep answers the literal text "Binary file … matches", which then
  # became the "URL" that got PATCHed into Paddle (caught live,
  # 2026-07-30). The shape check below is the backstop for any future
  # log-format surprise.
  for _ in {1..60}; do
    TUNNEL_URL="$(grep -oaE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
    [[ -n "$TUNNEL_URL" ]] && break
    sleep 0.5
  done
  if [[ ! "$TUNNEL_URL" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]]; then
    echo "✗ no usable tunnel URL after 30s (got: '${TUNNEL_URL:-none}') — last log lines:" >&2
    tail -20 "$TUNNEL_LOG" >&2
    exit 1
  fi
  printf '%s\n' "$TUNNEL_URL" > "$TUNNEL_URL_FILE"
  echo "→ tunnel up: $TUNNEL_URL"
fi

# 3. HARD GUARD before any Paddle call. This script must never touch a
# production Paddle account: the key must be sandbox by its own prefix AND
# the env must say sandbox. Either miss → manual mode (tunnel stays usable,
# nothing is mutated, exit 0). The webhook secret is additionally required
# because it is the destination SELECTOR (step 4).
if [[ "$PADDLE_API_KEY" != pdl_sdbx_* || "$PADDLE_ENV" != "sandbox" || -z "$PADDLE_WEBHOOK_SECRET" ]]; then
  echo "⚠ Paddle auto-repoint SKIPPED — need PADDLE_API_KEY=pdl_sdbx_*, PADDLE_ENV=sandbox"
  echo "  AND PADDLE_WEBHOOK_SECRET set (it selects WHICH destination is ours)."
  echo "  Manual mode. Point the webhook destinations at:"
  echo "    Paddle:   ${TUNNEL_URL}${PADDLE_PATH}"
  echo "    Razorpay: ${TUNNEL_URL}${RAZORPAY_PATH}"
  exit 0
fi

# 4. Find OUR destination: the one whose endpoint secret equals
# PADDLE_WEBHOOK_SECRET. Secret identity is the only correct selector —
# it is by definition the destination this app verifies, and per-secret
# uniqueness makes hijacking someone else's destination impossible. The
# secret travels via the environment (argv shows in `ps`); the response
# is held in shell vars only — never written to disk, never printed.
echo "→ looking up the Paddle sandbox notification destination"
settings=$(curl -sf "https://sandbox-api.paddle.com/notification-settings?per_page=200" \
  -H "Authorization: Bearer $PADDLE_API_KEY") || {
  echo "✗ GET /notification-settings failed (network or auth) — nothing changed." >&2
  exit 1
}

set +e
picked=$(printf '%s' "$settings" | WEBHOOK_SECRET="$PADDLE_WEBHOOK_SECRET" python3 -c '
import json, os, sys
secret = os.environ["WEBHOOK_SECRET"]
entries = [e for e in json.load(sys.stdin).get("data", [])
           if e.get("endpoint_secret_key") == secret]
if not entries:
    sys.exit(3)
if len(entries) > 1:
    sys.exit(4)  # cannot happen per Paddle (unique secrets) — refuse over guessing
e = entries[0]
print(e["id"] + "\t" + e.get("destination", "") + "\t" + ("1" if e.get("active") else "0"))
')
rc=$?
set -e
if [[ $rc -eq 3 ]]; then
  # Creating it here is FORBIDDEN — a new destination mints a new endpoint
  # secret, desyncing PADDLE_WEBHOOK_SECRET and orphaning in-flight
  # checkouts signed with the old one. One-time manual step instead:
  echo "✗ no Paddle destination's endpoint secret matches PADDLE_WEBHOOK_SECRET." >&2
  echo "  Either the secret in .env.local is stale, or the destination is gone." >&2
  echo "  Fix ONCE in the dashboard: Paddle sandbox → Developer tools →" >&2
  echo "  Notifications → (create or open the destination for" >&2
  echo "  ${TUNNEL_URL}${PADDLE_PATH}) and copy ITS endpoint secret into" >&2
  echo "  PADDLE_WEBHOOK_SECRET in .env.local. Re-runs then keep the URL fresh." >&2
  exit 1
elif [[ $rc -ne 0 ]]; then
  echo "✗ could not parse the Paddle response — nothing changed." >&2
  exit 1
fi
IFS=$'\t' read -r dest_id before was_active <<<"$picked"

# Guard: this script manages ROTATING quick-tunnel hostnames. If our
# destination points somewhere stable (not *.trycloudflare.com), someone
# set that up deliberately — clobbering it with an ephemeral hostname
# would break a stable setup on every dev-up. Refuse; manual call.
if [[ -n "$before" && "$before" != *".trycloudflare.com"* && "$before" != "${TUNNEL_URL}${PADDLE_PATH}" ]]; then
  echo "⚠ our destination ($dest_id) points at a STABLE endpoint:" >&2
  echo "    $before" >&2
  echo "  Not repointing it at an ephemeral quick tunnel. If you want the" >&2
  echo "  tunnel anyway, update the dashboard by hand:" >&2
  echo "    ${TUNNEL_URL}${PADDLE_PATH}" >&2
  exit 1
fi

# 5. PATCH the URL (and re-assert active) on the SAME destination — the
# endpoint secret survives, so PADDLE_WEBHOOK_SECRET keeps verifying.
new_dest="${TUNNEL_URL}${PADDLE_PATH}"
echo "→ PATCHing Paddle destination $dest_id (active was: $was_active)"
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

# 6. Prove the hostname actually serves before reporting success — a
# minted-but-unreachable quick tunnel otherwise exits green while every
# webhook 000s (caught live 2026-07-30: registration succeeded, DNS never
# appeared). Any HTTP code proves the edge; 000/530 after the wait means
# the tunnel is not reachable and the founder must know NOW, not at the
# next silently-lost purchase.
echo "→ verifying the tunnel serves (fresh hostnames can take ~a minute)"
reach=000
for _ in {1..18}; do
  reach=$(probe_url "$TUNNEL_URL")
  [[ "$reach" != "000" && "$reach" != "530" ]] && break
  sleep 5
done
if [[ "$reach" == "000" || "$reach" == "530" ]]; then
  echo "⚠ tunnel NOT reachable after ~90s (last probe: $reach)." >&2
  echo "  Paddle now points at $new_dest but deliveries will fail until this" >&2
  echo "  resolves. Try: ./scripts/dev-tunnel.sh --stop && ./scripts/dev-tunnel.sh" >&2
  echo "  (a fresh hostname usually fixes it; heavy quick-tunnel churn can" >&2
  echo "  degrade trycloudflare mints)." >&2
  exit 1
fi

echo ""
echo "✓ tunnel ready (edge answers HTTP $reach)."
echo "  tunnel:   $TUNNEL_URL"
echo "  paddle:   $dest_id → $after (same endpoint secret — PATCHed, not recreated)"
echo "  razorpay: Razorpay dashboard → Webhooks → set URL to ${TUNNEL_URL}${RAZORPAY_PATH}"
echo "            (Razorpay standard accounts have no webhook-update API — manual, once per tunnel restart)"
echo "  stop:     ./scripts/dev-tunnel.sh --stop"
