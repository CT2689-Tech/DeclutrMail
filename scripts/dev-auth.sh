#!/usr/bin/env bash
#
# Clean-slate OAuth spot-check.
#
# Drops the DB, reapplies all migrations, starts api + worker, and opens
# the Gmail connect URL in your default browser. Use this when you want
# to test the full first-run flow (OAuth → initial sync) from scratch.
#
# Destroys all local DB rows + OAuth tokens. Existing connect is lost.
#
# Usage:
#   ./scripts/dev-auth.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/.local-logs"
mkdir -p "$LOG_DIR"

# Stop anything running first — dev-api.sh --reset will drop the DB.
"$REPO_ROOT/scripts/dev-up.sh" --stop || true

# Drop + recreate + apply migrations (dev-api.sh does this when --reset is passed)
# but then exec's into the api foreground — we want background, so split it up.
DB_NAME="declutrmail"
PG_BASE="postgresql://postgres:postgres@localhost:5432"

if ! pg_isready -h localhost -p 5432 -q; then
  echo "✗ Postgres is not running on localhost:5432" >&2
  exit 1
fi

echo "→ dropping $DB_NAME"
psql "$PG_BASE/postgres" -v ON_ERROR_STOP=1 -tAc \
  "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null

echo "→ creating $DB_NAME"
createdb -h localhost -U postgres "$DB_NAME"

echo "→ applying migrations via atlas"
"$REPO_ROOT/scripts/db-migrate.sh" apply

# Start api + worker in background.
API_LOG="$LOG_DIR/api.log"
WORKER_LOG="$LOG_DIR/worker.log"

echo "→ starting api → $API_LOG"
( "$REPO_ROOT/scripts/dev-api.sh" >"$API_LOG" 2>&1 ) &
echo $! > "$LOG_DIR/api.pid"

echo "→ starting worker → $WORKER_LOG"
( "$REPO_ROOT/scripts/dev-worker.sh" >"$WORKER_LOG" 2>&1 ) &
echo $! > "$LOG_DIR/worker.pid"

# Wait for api to be reachable.
echo "→ waiting for api on :4000"
for _ in {1..30}; do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1 \
     || curl -sf http://localhost:4000 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

URL="http://localhost:4000/api/auth/google/start"
echo "→ opening $URL"
open "$URL" || echo "  (open failed — visit manually)"

echo ""
echo "✓ ready. tail -f $LOG_DIR/{api,worker}.log"
echo "  stop:  ./scripts/dev-up.sh --stop"
