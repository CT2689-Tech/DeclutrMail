# API database driver validation and rollout

The API defaults to `API_DB_DRIVER=postgres-js` (also the behavior when unset).
`node-postgres` is an explicit API-only opt-in. This change does not enable it
in deployment manifests, change the database region, or replace worker pools.
Workers and the dedicated session pools for advisory locks and LISTEN retain
postgres-js. See [ADR-0022](../adr/0022-postgres-supabase-pre-launch.md).

## Why an alternative exists

With postgres-js 3.4.9 and `prepare:false`, parameterized queries wait for a
Describe response before sending Bind/Execute. Each sequential query can pay
an additional network round trip. The pinned pg 8.23.1 adapter uses unnamed
statements without that extra wait. Both adapters retain the existing typed
Drizzle schema and bounded `API_DB_POOL_MAX` (default 10, maximum 20).
Named prepared statements and pipelining remain incompatible with the
transaction pooler and must not be introduced.

A controlled local experiment with 30 ms response delay measured these query
medians, with ten alternating pairs. They are query measurements on synthetic
fixtures, **not HTTP or browser page-load measurements**:

| Read             | postgres-js | node-postgres |
| ---------------- | ----------: | ------------: |
| Senders          |    80.82 ms |      48.15 ms |
| Senders metadata |    69.26 ms |      36.37 ms |
| Sender detail    |    72.31 ms |      39.63 ms |
| Senders summary  |    73.39 ms |      40.88 ms |
| Activity         |   356.63 ms |     186.93 ms |
| Screener         |   141.39 ms |      76.96 ms |

These figures motivate validation; they do not establish a 200 ms page-load
SLO or predict production throughput.

## Configuration and verification

For a production opt-in, the adapter enforces verified TLS when the shared
PostgreSQL DSN omits a TLS mode, without changing the secret or worker settings.
An explicit `sslmode` must be exactly one `verify-full` or `require` parameter.
The latter is normalized to verify-full so parser upgrades cannot silently weaken verification.
Duplicate modes, libpq compatibility, global TLS verification disabling and
pipeline URL options fail startup with a static, credential-free error.
Use API-only trust configuration, such as a mounted CA referenced by
`NODE_EXTRA_CA_CERTS`, when required. Do not add pg-specific certificate URL
options to the shared DSN: postgres-js can treat them as server startup
parameters. Never disable verification to work around an untrusted chain.
Physically verify the socket is encrypted and
authorized against the intended pooler before changing serving traffic.

The owned pool has a 30 second connection acquisition timeout, no idle expiry,
and a 30 minute connection lifetime. Idle socket errors are handled and only
an allowlisted error code is logged. Shutdown closes the pool once through
Nest's lifecycle after the HTTP adapter has been disposed. Confirm active
request draining under realistic concurrency before a traffic cutover.

Native integration tests run only when `API_DRIVER_TEST_PG_URL` names a
loopback `declutrmail_*_test` database without query options. They create and
drop a uniquely named disposable database. CI supplies its own PostgreSQL 16
service; manual verification also ran on private PostgreSQL 17.11. Never pass
a production DSN. Tests cover parameter values and decoding, rollback,
savepoints, concurrent row locks, idle socket replacement, and safe option
parsing. The worker driver is deliberately unchanged because its raw affected
row-count consumers have not all been validated for pg results.

The explicit `apps/api/src/db/probe-api-database.ts` diagnostic executes only
constant SELECTs and read-only transactions. It uses at most one connection
per driver, alternates ten timing pairs, checks division-by-zero rollback and
subsequent recovery, and reports only timings, closed codes and TLS booleans.
It never reads customer tables, mints sessions, or invokes Gmail or billing.
Run it in a private Cloud Run job with the API's existing service account and
DATABASE_URL secret reference, zero retries and a 300 second task timeout.
Do not export secret values locally or publish raw logs. Individual timing
queries have no separate query timeout; the job timeout is the outer bound.
This helper is not imported during API bootstrap.

## Rollout gates and rollback

1. Pass native contracts, full API tests, worker helper tests, typecheck, lint,
   required reviews and the actual container runtime smoke. Authenticated
   local HTTP smoke must cover populated/empty reads, auth and ownership
   rejection, no active mailbox, paid-tier denial and response parity.
2. Verify the intended transaction pooler with the private read-only job.
   A local successful probe is insufficient. Clean up the diagnostic job.
3. Compare a private candidate against the serving revision using the same
   account and region. Measure first and repeat navigation separately across
   all screens, along with API p50/p95, errors and connection use. Check
   mailbox switching and concurrent reads, transactions, and signal draining.
4. Review the combined connection budget across all API replicas and workers.
   The unchanged per-instance cap does not prove fleet capacity.
5. Obtain approval for the concrete traffic cutover only after the preceding
   evidence is available. Keep the current revision and env snapshot for
   rollback. An opt-in adapter merged with the default retained is not a
   production performance improvement.

Rollback serving traffic to the verified postgres-js revision, or remove the
API_DB_DRIVER opt-in and deploy the previous driver. No data or schema rollback
is needed. Keep ready, queued, merged, deployed, and production-verified states
separate; record the exact image/revision and validation evidence at each step.
