#!/usr/bin/env bash
#
# Local dev runner for apps/api — one command to test the Gmail OAuth flow (PR-B).
#
# It: checks Postgres is up, creates the `declutrmail` DB + applies all
# migrations if missing, frees port 4000, then starts the NestJS API.
# The API's `start` script auto-loads the repo-root `.env.local`.
#
# Usage:
#   ./scripts/dev-api.sh            start the API (sets up the DB if needed)
#   ./scripts/dev-api.sh --reset    drop + recreate the DB first (clean slate)
#
# After it prints "starting", open:  http://localhost:4000/api/auth/google/start
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB_NAME="declutrmail"
PG_BASE="postgresql://postgres:postgres@localhost:5432"
PORT=4000

# 1. Postgres reachable?
if ! pg_isready -h localhost -p 5432 -q; then
  echo "✗ Postgres is not running on localhost:5432 — start it, then re-run." >&2
  exit 1
fi

# 2. Free port 4000 (a stale API would block the new one + a --reset drop).
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "→ freeing port $PORT (stale API)"
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# 3. --reset → drop the DB (FORCE terminates any leftover connections).
if [[ "${1:-}" == "--reset" ]]; then
  echo "→ --reset: dropping $DB_NAME"
  psql "$PG_BASE/postgres" -v ON_ERROR_STOP=1 -tAc \
    "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null
fi

# 4. Create the DB + apply every migration, only if it doesn't exist.
if ! psql "$PG_BASE/postgres" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME';" | grep -q 1; then
  echo "→ creating $DB_NAME + applying migrations"
  createdb -h localhost -U postgres "$DB_NAME"
  for f in packages/db/migrations/*.sql; do
    echo "  apply $(basename "$f")"
    psql "$PG_BASE/$DB_NAME" -v ON_ERROR_STOP=1 -q -f "$f"
  done
else
  echo "→ $DB_NAME already exists (pass --reset for a clean slate)"
fi

# 5. Start the API. `pnpm --filter` runs with cwd=apps/api, so the
#    start script's --env-file-if-exists=../../.env.local resolves to root.
echo "→ starting apps/api on :$PORT"
echo "  test the OAuth flow: open http://localhost:$PORT/api/auth/google/start"
exec pnpm --filter @declutrmail/api start
