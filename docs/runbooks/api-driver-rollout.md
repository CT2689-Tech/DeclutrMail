# API database driver rollout

Normal releases declare `API_DB_DRIVER=node-postgres`. The deploy workflow checks
every positive-traffic API revision before building or releasing either service.
The API deployment helper repeats that check before staging, verifies the
candidate's driver, and refuses promotion if serving traffic changes during smoke.
Missing revision selectors mean the application's existing postgres-js default.
Unknown, secret-backed or duplicate selectors and failed readbacks stop release.
Zero-traffic diagnostic tags do not block release.

The HTTP API selector follows the verified driver rollout in us-central1.
The worker keeps postgres-js. Production node-postgres uses the bundled Supabase
public root CA with verified TLS.

During a mixed-driver canary, normal releases deliberately stop. Use a separate,
reviewed canary procedure with fixed revisions, bounded measurements and rollback;
`deploy-api-safely.mjs` promotes its candidate to 100% and must not perform a canary.
After a rollout completes at 100%, the workflow's explicit driver selector must
match the serving revision before normal releases resume. A failed canary restores
the previous resolved traffic assignment; its manifest must retain or restore that
previous driver. Do not bypass the guard or change the application's default.

Read-only preflight:

```bash
node scripts/deploy-api-safely.mjs --check-driver=node-postgres \
  --region=us-central1 --project=declutrmail-ai-prod
```

An API image's bounded read-only driver probe is
`apps/api/src/db/probe-api-database.ts`. Run it only in a private job with the
runtime service account and a reference to the existing database secret. It reads
constants and read-only transactions, verifies TLS booleans, parameterization,
rollback and recovery, and closes both one-connection pools. It does not verify
account HTTP behavior or screen-load performance. Never print the database URL.

The launch environment has no external users, so driver validation uses matched
controlled reads rather than a sparse 5% traffic canary. Stage the same verified
image at zero traffic, with only the HTTP API selector changed; check its runtime
configuration, dependency readiness and protected read contracts before assigning
100% to its fixed revision. Retain the previous resolved revision for rollback.
Normal releases remain held whenever their selector differs from the serving
revision. A rollback to postgres-js requires restoring its explicit workflow
selector through review before ordinary releases can resume.
