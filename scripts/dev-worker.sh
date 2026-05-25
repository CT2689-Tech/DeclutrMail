#!/usr/bin/env bash
#
# Local dev runner for the BullMQ worker process (PR-C).
#
# It starts the InitialSyncWorker consumer. The worker drains the
# `initial-sync` queue: each job backfills one mailbox's metadata.
#
# Run `./scripts/dev-api.sh` FIRST — it creates the `declutrmail` DB and
# applies migrations. This script only checks prerequisites and starts
# the worker; it does not set the DB up.
#
# Usage:
#   ./scripts/dev-worker.sh         start the worker
#
# Enqueue a job by completing an OAuth connect (see dev-api.sh).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Postgres reachable?
if ! pg_isready -h localhost -p 5432 -q; then
  echo "✗ Postgres is not running on localhost:5432 — start it, then re-run." >&2
  exit 1
fi

# 2. .env.local present with a REDIS_URL? The worker cannot run without it.
if [[ ! -f .env.local ]]; then
  echo "✗ .env.local not found — cp .env.example .env.local and fill it in." >&2
  exit 1
fi
if ! grep -qE '^REDIS_URL=.+' .env.local; then
  echo "✗ REDIS_URL is empty in .env.local — set redis://localhost:6379 for dev." >&2
  echo "  (Production injects an Upstash rediss:// URL via [gcp] Secret Manager.)" >&2
  exit 1
fi

# 2b. Loud warning if dev points at a paid Upstash endpoint. BullMQ's
#     idle blocking polls burn ~700K commands/month per worker — the
#     Upstash free tier (500K/month) breaks within ~3 weeks of leaving
#     a worker on. See .env.example REDIS_URL comment.
if grep -qE '^REDIS_URL=rediss?://.*upstash\.io' .env.local; then
  echo "⚠ REDIS_URL points at Upstash — dev usage burns prod quota." >&2
  echo "  Recommended: run \`docker compose up -d redis\` and set" >&2
  echo "  REDIS_URL=redis://localhost:6379 in .env.local." >&2
fi

# 3. Start the worker. `pnpm --filter` runs with cwd=apps/api, so the
#    worker script's --env-file-if-exists=../../.env.local resolves to root.
echo "→ starting the initial-sync worker"
exec pnpm --filter @declutrmail/api worker
