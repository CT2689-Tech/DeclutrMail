#!/usr/bin/env bash
#
# assert-dev-db.sh — refuse to run destructive test steps against production.
#
# Used by docs/execution/billing-test-matrix-2026-07-29.md §0.2, which has
# `[DEV DB ONLY]` steps that mutate billing rows.
#
#   ./scripts/assert-dev-db.sh --record        # one-time enrollment of your dev cluster
#   ./scripts/assert-dev-db.sh --exec "<SQL>"  # run a mutation, guarded IN THE SAME SESSION
#   ./scripts/assert-dev-db.sh                 # bare check (informational only — see below)
#
# Exit 0 = safe to proceed. Exit 1 = refuse.
#
# ## Use --exec for anything that writes
#
# `assert-dev-db.sh && psql "$DATABASE_URL" -c '…'` is NOT safe, because the
# two halves resolve their target independently (Codex stop-review 2026-07-29).
# With `DATABASE_URL` unset in the shell, this script falls back to `.env.local`
# and validates THAT cluster, while `psql "$DATABASE_URL"` expands to `psql ""`
# and connects to libpq defaults — `PGHOST`/`PGDATABASE`/`PGSERVICE` or the
# local socket. Demonstrated: the guard printed OK for the recorded dev cluster
# while the very next command reached a different database entirely.
#
# `--exec` closes it by construction: ONE resolution of the URL, and the
# identity assertion runs in the SAME psql session and transaction as the
# statement, so there is no second connection to divert and no window between
# check and write.
#
# ## Why identity, and not the connection string
#
# Four earlier versions of this check lived in the runbook as prose and each
# could not fail (Codex stop-reviews, 2026-07-29):
#
#   1. `inet_server_addr()` compared to a hostname — that returns an IP, so the
#      comparison never matched.
#   2. grep for the prod project ref in `.env.local` — a denylist over a string,
#      bypassed by: file missing, shell export winning, no DATABASE_URL in the
#      file, or prod reached by IP/pooler host where the ref never appears.
#   3. An allowlist on the connection-string host. Still only a string: a port
#      forward (`ssh -L`, cloud-sql-proxy, kubectl port-forward) makes
#      production answer on localhost, and the check calls it dev.
#   4. Cluster identity, but enrolled by trust-on-first-use — recording the
#      identifier while pointed at production approves production forever, and
#      does it with a confident OK.
#
# So: identity comes from the SERVER (`pg_control_system()`, unfakeable by any
# URL or tunnel), and enrollment is itself gated against a committed list of
# known production clusters. The stored value is re-validated on every run, so
# a file enrolled before this guard existed cannot keep approving production.
set -uo pipefail

IDENTITY_FILE="${IDENTITY_FILE:-.dev-db-identity}"
# Populate via: SELECT system_identifier FROM pg_control_system();
# A Postgres cluster identifier is not a credential — it grants nothing without
# network access and a password — so listing it here is safe and is the only
# exact way to recognise production through a tunnel.
KNOWN_PRODUCTION_CLUSTERS="${KNOWN_PRODUCTION_CLUSTERS:-7642734024280108049}"

refuse() {
  echo "REFUSE — $1" >&2
  exit 1
}

is_production() {
  for id in $KNOWN_PRODUCTION_CLUSTERS; do
    [ "$1" = "$id" ] && return 0
  done
  return 1
}

# Resolve DATABASE_URL the way the app does: an exported var wins over the file.
resolve_db_url() {
  printf '%s' "${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' .env.local 2>/dev/null | tail -1)}"
}

# The server names itself. Nothing about the connection string can change this.
live_cluster_id() {
  psql "$1" -At -c 'SELECT system_identifier FROM pg_control_system();' 2>/dev/null | tr -dc '0-9'
}

DB_URL=$(resolve_db_url)
[ -n "$DB_URL" ] || refuse "no DATABASE_URL resolved (checked \$DATABASE_URL then .env.local)"

if [ "${1:-}" = "--record" ]; then
  ACTUAL=$(live_cluster_id "$DB_URL")
  [ -n "$ACTUAL" ] || refuse "could not read the server's identity; nothing recorded"
  if is_production "$ACTUAL"; then
    refuse "that is a KNOWN PRODUCTION cluster ($ACTUAL). Refusing to enroll it as dev.
  This is the trust-on-first-use hole: enrolling production here would make the
  gate approve production from then on, confidently. Point .env.local at your
  dev database and re-run."
  fi
  printf '%s\n' "$ACTUAL" > "$IDENTITY_FILE"
  echo "OK — recorded dev cluster $ACTUAL in $IDENTITY_FILE"
  exit 0
fi

[ -f "$IDENTITY_FILE" ] || refuse "no $IDENTITY_FILE — run: ./scripts/assert-dev-db.sh --record"
EXPECTED=$(tr -dc '0-9' < "$IDENTITY_FILE")
[ -n "$EXPECTED" ] || refuse "$IDENTITY_FILE holds no identifier"

# Re-validate the STORED value every run. An identity file written before this
# guard existed — or copied from another machine — could name production.
if is_production "$EXPECTED"; then
  refuse "$IDENTITY_FILE names a KNOWN PRODUCTION cluster ($EXPECTED).
  Delete it and re-enroll against your dev database."
fi

# --exec: assert identity and run the statement in ONE session, ONE transaction.
if [ "${1:-}" = "--exec" ]; then
  shift
  SQL="${1:-}"
  [ -n "$SQL" ] || refuse "--exec needs a SQL statement"

  # A psql metacommand can RECONNECT after the assertion has already passed
  # (Codex stop-review 2026-07-29). Demonstrated: with a correct identity file,
  #
  #     \c dm_other_db
  #     INSERT INTO … VALUES (42);
  #
  # asserted against the recorded cluster, then wrote to a DIFFERENT database —
  # and `\c` silently discarded the surrounding transaction ("WARNING: there is
  # no transaction in progress"), so BEGIN/COMMIT framing protected nothing.
  # `\c` accepts a full conninfo, so the same trick reaches another cluster.
  #
  # Two defences:
  #   1. Refuse any backslash sequence outright. Nothing in this runbook needs
  #      one, and an allowlist of "safe" metacommands is a bigger surface than
  #      the feature is worth.
  case $SQL in
    *\\*) refuse "backslash metacommands are not allowed in --exec.
  A metacommand such as \\c can reconnect AFTER the identity assertion passes,
  which would run your statement on an unverified database. Split the work into
  separate --exec calls instead." ;;
  esac

  #   2. Send everything as ONE simple-query batch via -c, not -f. psql does not
  #      process metacommands inside a -c string, and a single batch is one
  #      round trip — there is no "next command" for psql to reconnect for, so
  #      the assertion and the statement cannot end up on different sessions.
  #      Single-quoted printf: $$ must reach psql literally, not expand to $PID.
  GUARD=$(printf 'DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) <> %s THEN RAISE EXCEPTION %s, (SELECT system_identifier FROM pg_control_system()); END IF; END $$;' \
    "'$EXPECTED'" \
    "'assert-dev-db: REFUSING — connected cluster % is not the recorded dev cluster $EXPECTED'")

  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; $GUARD $SQL COMMIT;" ||
    refuse "statement did not run (see the error above)"
  exit 0
fi

# Bare mode: informational. It proves the destination AT THIS MOMENT for the
# URL resolved HERE — it cannot vouch for a separate psql invocation, which is
# why every mutation must go through --exec.
ACTUAL=$(live_cluster_id "$DB_URL")
[ -n "$ACTUAL" ] || refuse "could not read the server's identity (unreachable, or the function is restricted)"

if is_production "$ACTUAL"; then
  refuse "connected to a KNOWN PRODUCTION cluster ($ACTUAL)."
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  refuse "cluster identity mismatch. expected=$EXPECTED actual=$ACTUAL
  Something changed the destination — a port forward, a different .env.local,
  or an exported DATABASE_URL."
fi

echo "OK — connected to the recorded dev cluster ($ACTUAL)"
echo "     (informational: use --exec for anything that writes)"
