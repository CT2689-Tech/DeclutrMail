#!/usr/bin/env bash
#
# Post-`git pull` bring-up — one command to make a freshly-pulled main
# branch runnable for spot-checking.
#
# Does NOT reset the DB (so existing OAuth tokens + synced rows survive).
# For a clean-slate run, use `./scripts/dev-auth.sh` instead.
#
# Steps:
#   1. pnpm install (only if lockfile changed)
#   2. start local redis container (docker-compose.yml) — avoids burning
#      Upstash quota in dev (see .env.example REDIS_URL comment)
#   3. apply pending migrations (idempotent)
#   4. start api on :4000 in background
#   5. start worker in background
#   6. tail both logs
#
# Usage:
#   ./scripts/dev-up.sh           bring redis + api + worker up
#   ./scripts/dev-up.sh --stop    kill api + worker (leaves redis container running)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/.local-logs"
API_PID="$LOG_DIR/api.pid"
WORKER_PID="$LOG_DIR/worker.pid"
API_LOG="$LOG_DIR/api.log"
WORKER_LOG="$LOG_DIR/worker.log"

mkdir -p "$LOG_DIR"

stop() {
  for f in "$API_PID" "$WORKER_PID"; do
    if [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; then
      echo "→ stopping pid $(cat "$f")"
      kill "$(cat "$f")" 2>/dev/null || true
    fi
    rm -f "$f"
  done
  # Belt-and-braces — kill anything still bound to :4000.
  if lsof -ti:4000 >/dev/null 2>&1; then
    lsof -ti:4000 | xargs kill -9 2>/dev/null || true
  fi
}

if [[ "${1:-}" == "--stop" ]]; then
  stop
  exit 0
fi

# 1. Install deps if lockfile newer than node_modules root.
if [[ pnpm-lock.yaml -nt node_modules/.modules.yaml || ! -d node_modules ]]; then
  echo "→ pnpm install"
  pnpm install
fi

# 2. Start local redis sidecar for BullMQ + rate limiter. Idempotent —
# `up -d` no-ops if the container is already running. Skipped if docker
# isn't installed so contributors who run a system redis aren't blocked.
if command -v docker >/dev/null 2>&1; then
  echo "→ starting local redis container"
  docker compose up -d redis
  # Wait for the healthcheck so the worker / api don't race the boot.
  for i in {1..20}; do
    if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
else
  echo "⚠ docker not installed — skipping redis sidecar."
  echo "  Provide your own redis on \$REDIS_URL or install Docker Desktop."
fi

# 3. Migrate.
echo "→ applying pending migrations"
"$REPO_ROOT/scripts/db-migrate.sh" apply

# 4+5. Restart api + worker.
stop
echo "→ starting api → $API_LOG"
( "$REPO_ROOT/scripts/dev-api.sh" >"$API_LOG" 2>&1 ) &
echo $! > "$API_PID"

echo "→ starting worker → $WORKER_LOG"
( "$REPO_ROOT/scripts/dev-worker.sh" >"$WORKER_LOG" 2>&1 ) &
echo $! > "$WORKER_PID"

echo ""
echo "✓ up. tail -f $LOG_DIR/{api,worker}.log"
echo "  stop:    ./scripts/dev-up.sh --stop"
echo "  auth:    open http://localhost:4000/api/auth/google/start"
