# API database driver rollout prerequisites

Normal releases declare `API_DB_DRIVER=postgres-js`. The deploy workflow checks
every positive-traffic API revision before building or releasing either service.
The API deployment helper repeats that check before staging, verifies the
candidate's driver, and refuses promotion if serving traffic changes during smoke.
Missing revision selectors mean the application's existing postgres-js default.
Unknown, secret-backed or duplicate selectors and failed readbacks stop release.
Zero-traffic diagnostic tags do not block release.

This is preparation for a separately approved rollout; it does not switch the
public API driver or region. The worker keeps postgres-js. Production
node-postgres uses the bundled Supabase public root CA with verified TLS.

During a mixed-driver canary, normal releases deliberately stop. Use a separate,
reviewed canary procedure with fixed revisions, bounded measurements and rollback;
`deploy-api-safely.mjs` promotes its candidate to 100% and must not perform a canary.
After an approved canary completes at 100%, update the workflow's explicit driver
selector to match the serving revision before resuming normal releases. A failed
canary restores the previous resolved traffic assignment and leaves the selector
at postgres-js. Do not bypass the guard or change the default as preparation.

Read-only preflight:

```bash
node scripts/deploy-api-safely.mjs --check-driver=postgres-js \
  --region=us-central1 --project=declutrmail-ai-prod
```

An API image's bounded read-only driver probe is
`apps/api/src/db/probe-api-database.ts`. Run it only in a private job with the
runtime service account and a reference to the existing database secret. It reads
constants and read-only transactions, verifies TLS booleans, parameterization,
rollback and recovery, and closes both one-connection pools. It does not verify
account HTTP behavior or screen-load performance. Never print the database URL.
