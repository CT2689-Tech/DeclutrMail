# ADR-0022: Postgres on Supabase pre-launch (amends D158)

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D158 (hosting stack — Cloud SQL Postgres), D152
  (Atlas migrations), D193 (`min_instances=1`), D235 (partitioning gate)
- **Amends:** D158 — "Database: Cloud SQL Postgres (us-central1, regional HA)"

## Context

D158 specifies **Cloud SQL Postgres** with regional HA from day one as the
managed Postgres backend. The locked plan was set when the bootstrap
cost envelope ("~$200/mo at 0-100 users") assumed all infrastructure
ran in production-grade configuration from day zero.

The 2026-06-08 prod-infra-bootstrap session re-examined the dev-phase
burn against the locked stack. Findings:

- Cloud SQL `db-g1-small` regional HA bills **~$50-100/mo idle**,
  whether or not any user has signed up.
- The bootstrap envelope's "$200/mo" target was a soft-launch number;
  for pre-launch (founder + 0 users), $100+/mo of idle Postgres is
  wasted spend.
- Supabase Free tier provides 500 MB storage + 2 GB egress/mo, far
  exceeding pre-launch needs. PgBouncer pooler is built in, meeting
  D158's serverless connection-pooling requirement out of the box.
- DSN value is fully opaque to application code — Drizzle ORM +
  Atlas migrations are storage-engine-agnostic. Swapping Cloud SQL
  for Supabase touches zero `.ts` files; only Secret Manager values
  change.

The founder explicitly directed: "If we are doing to mitigate dev
cost then lets do that."

## Decision

**Use Supabase Postgres for pre-launch + soft-launch.** Plan to
migrate to GCP Cloud SQL when one of the explicit migration triggers
fires (below). Until then, Cloud SQL provisioning is deferred.

**Supabase project shape (live this session):**

- Org: `declutrmail` (new free org distinct from V1 `declutrmail-prod`).
- Project: `declutrmail-prod` (`hewwqjkvrngxbihciewr`).
- Region: AWS `us-west-2` (only free region available at create time).
- Postgres 17.6.
- Data API: **OFF** (we don't ship Supabase client; D7 forbids
  browser → Postgres direct).
- Auto-expose-new-tables: **OFF** (defense-in-depth).
- Auto-RLS: **OFF** (Cloud Run connects as `postgres` role which
  bypasses RLS regardless; see follow-up below for belt + suspenders).
- Connection: **Transaction pooler** (`:6543`) mounted as
  `DATABASE_URL` on Cloud Run; **Session pooler** (`:5432`) used
  by Atlas migrations.

**Cost shift:**

| Stage                   | D158-strict                                 | This ADR                                  |
| ----------------------- | ------------------------------------------- | ----------------------------------------- |
| Dev (0 users)           | ~$115/mo (Cloud SQL + warm Cloud Run + KMS) | ~$25/mo (KMS + Supabase $10 + Upstash $5) |
| Soft launch (100 users) | ~$250/mo                                    | ~$60-80/mo                                |
| $20k MRR (1k users)     | ~$700-900/mo                                | ~$400-500/mo                              |

Net pre-launch saving: **~$90/mo**.

## Migration triggers (when this ADR's "Supabase pre-launch" expires)

Migrate Postgres from Supabase to GCP Cloud SQL when **any** of the
following fires:

1. **Latency** — p95 query time from Cloud Run > 150 ms sustained for
   24 h (D235's partitioning gate uses the same threshold).
   Cross-cloud (Supabase us-west-2 ↔ Cloud Run us-central1) RTT is
   ~50ms, leaving thin margin under load.
2. **Storage** — DB size > 6 GB (Supabase Pro limit before $0.125/GB
   add-on; Cloud SQL is cheaper per GB at scale).
3. **Row count** — `mail_messages` > 25 M rows (D235's partitioning
   trigger). If we partition, do it in Cloud SQL where we control the
   primary; Supabase Free does not allow custom PG extensions like
   `pg_partman`.
4. **Compliance** — if a customer or third-party-audit requires
   single-cloud data residency, GCP-only.

## Migration procedure (when triggered)

Single transactional cutover (max ~10 min downtime acceptable
at launch volume):

1. Provision Cloud SQL `db-g1-small` regional HA in us-central1.
2. `pg_dump --schema-only` from Supabase → apply to Cloud SQL.
3. Atlas `migrate apply` against Cloud SQL DSN (sanity check, no-op).
4. Take API + worker to `min_instances=0` briefly to drain writes.
5. `pg_dump --data-only --section=data` from Supabase → load Cloud SQL.
6. Update `database-url-prod` Secret Manager value → new Cloud SQL DSN.
7. Update Atlas state by running `migrate apply` once against Cloud
   SQL with `--allow-dirty`.
8. Redeploy Cloud Run API + worker → picks up `:latest` secret.
9. Smoke `/api/auth/me` (401) + a real authed read.
10. Pause Supabase project; keep for 30 days as rollback parachute,
    then archive.

Expected wall-clock: ~2 h founder + me.

## Consequences

- **Plus** — pre-launch + soft-launch cost falls to ~$25-80/mo from
  D158-strict's $115-250/mo, freeing budget for marketing + LLM
  experimentation.
- **Plus** — Supabase MCP integration speeds DDL exploration during
  active development (`list_tables`, `execute_sql`, `apply_migration`,
  `get_advisors` are all MCP-callable).
- **Plus** — Drizzle + Atlas are storage-engine-agnostic; the
  migration to Cloud SQL when triggers fire is a Secret Manager value
  swap, not a code refactor.
- **Minus** — Cross-cloud latency (~30-50 ms p50 Supabase
  us-west-2 ↔ Cloud Run us-central1). Acceptable pre-launch; D235's
  150 ms p95 gate is the explicit migration trigger.
- **Minus** — Supabase Free terms allow the platform to pause idle
  projects after 7 days; we mitigate via a heartbeat (any request
  keeps it warm). At soft-launch volume the heartbeat is automatic.
- **Minus** — Region choice locked to us-west-2 (only free region
  available at create time). Sub-optimal but acceptable given a
  cross-cloud hop is unavoidable.

## Follow-ups (tracked in FOUNDER-FOLLOWUPS.md)

- **RLS deny-all-to-anon migration `0026`** — defense in depth in case
  Data API gets toggled on later. Cloud Run connects as `postgres`
  role and bypasses RLS, so this is a no-op for the runtime path; only
  closes the hypothetical "what if anon key leaks + Data API gets
  enabled" hole. Tracked separately.
- **Daily Supabase heartbeat** — to prevent 7-day pause on the free
  tier, a tiny `curl` from Cloud Scheduler or a GH Actions cron every
  6 h. Defer until we see a pause happen (probably never, since both
  Cloud Run worker + dev usage keeps it warm).
- **Cloud SQL trigger watch** — once monthly, review
  `pg_stat_statements` + `mail_messages` row count vs the migration
  trigger thresholds above. When any fires, schedule the cutover.

## Related

- `docs/runbooks/prod-infra-bootstrap.md` — Step 4 secret values
- `docs/runbooks/secrets-inventory.md` — Postgres row updated to
  reflect real Supabase DSN
- `packages/db/atlas.hcl` — Atlas config (storage-engine-agnostic;
  unchanged by this ADR)
