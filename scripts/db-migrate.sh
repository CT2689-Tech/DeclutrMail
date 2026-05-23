#!/usr/bin/env bash
#
# Idempotent local DB migration applier.
#
# Use after `git pull` to bring the local `declutrmail` DB up to the
# latest forward migration. Safe to re-run — atlas tracks applied
# revisions in `atlas_schema_revisions`.
#
# First-time setup (one-off): if the DB already has migrations 0001..N
# applied but no atlas tracker exists, baseline with:
#   atlas migrate set <N> --url <DB_URL> --dir 'file://migrations'
# (`scripts/db-migrate.sh --baseline <N>` shortcut below.)
#
# Usage:
#   ./scripts/db-migrate.sh                  apply pending migrations
#   ./scripts/db-migrate.sh --status         show current vs latest
#   ./scripts/db-migrate.sh --baseline 0004  mark up-to-version applied
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/packages/db"

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/declutrmail}"
# Atlas needs sslmode=disable for local Postgres.
ATLAS_URL="${DB_URL/postgresql:/postgres:}?sslmode=disable"
DIR='file://migrations'

if ! command -v atlas >/dev/null 2>&1; then
  echo "✗ atlas not installed — run: brew install ariga/tap/atlas" >&2
  exit 1
fi

# Ensure checksum file exists.
if [[ ! -f migrations/atlas.sum ]]; then
  echo "→ generating migrations/atlas.sum"
  atlas migrate hash --dir "$DIR"
fi

case "${1:-apply}" in
  --status|status)
    atlas migrate status --url "$ATLAS_URL" --dir "$DIR"
    ;;
  --baseline)
    [[ -z "${2:-}" ]] && { echo "usage: $0 --baseline <version>" >&2; exit 1; }
    atlas migrate set "$2" --url "$ATLAS_URL" --dir "$DIR"
    ;;
  apply|--apply|"")
    atlas migrate apply --url "$ATLAS_URL" --dir "$DIR"
    ;;
  *)
    echo "unknown: $1" >&2
    echo "usage: $0 [apply|--status|--baseline <version>]" >&2
    exit 1
    ;;
esac
