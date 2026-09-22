# Isolated launch journeys

This harness never inherits the repository `.env.local`. Stack-backed suites require an explicit local PostgreSQL database named `declutrmail_e2e` (or `declutrmail_e2e_<suffix>`), local Redis database 12, `E2E_ISOLATED=1`, and loopback API/web URLs. Login is restricted to `chintan.e2e.billing@synthetic.test`. Seeding additionally rejects databases containing any non-synthetic mailbox. No real Google tokens or worker are needed.

## Local preparation (no browser automation)

Use new disposable containers; do not reuse the normal development stack. These example names and ports are dedicated to this harness. If occupied, choose other unused names/ports rather than stopping or deleting somebody else's services.

```sh
docker run --name declutrmail-e2e-postgres -e POSTGRES_PASSWORD=e2e_local -e POSTGRES_DB=declutrmail_e2e -p 127.0.0.1:5404:5432 -d postgres:16
docker run --name declutrmail-e2e-redis -p 127.0.0.1:6404:6379 -d redis:8-alpine
export E2E_ISOLATED=1
export DATABASE_URL=postgresql://postgres:e2e_local@127.0.0.1:5404/declutrmail_e2e
export REDIS_URL=redis://127.0.0.1:6404/12
export E2E_WEB_URL=http://127.0.0.1:3104
export E2E_API_URL=http://127.0.0.1:4104
export E2E_LOGIN_EMAIL=chintan.e2e.billing@synthetic.test
export E2E_BILLING_LOGIN_EMAIL=chintan.e2e.billing@synthetic.test
for migration in packages/db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" || break; done
pnpm --filter @declutrmail/e2e seed
```

Apply migrations only to a newly created database; do not replay all migrations against an existing one. A migration failure is a blocker, not permission to continue seeding. The seed is idempotent and resets fixed synthetic fixture state, including the billing ledger. Do not run it during another suite.

With the same exports, start the dedicated launcher:

```sh
pnpm --filter @declutrmail/e2e stack
```

The launcher validates the isolated URLs before starting anything, supplies fixed test JWT/Google/encryption/webhook settings, and excludes inherited credentials, environment preloads and proxies. It copies API/web source into a temporary workspace without any `.env*` files; both Nest and Next therefore discover no local credentials. Next's build output stays in that temporary workspace, leaving any normal development server untouched. Dependency links reuse installed packages. Source is a snapshot: restart after editing the app. Ctrl-C stops both servers and removes the temporary files. It starts no worker and performs no migration or seed automatically.

Optional analytics are off in this manual stack. For the consent suite only, start it with `E2E_POSTHOG=1 pnpm --filter @declutrmail/e2e stack`; the suite must also receive `E2E_POSTHOG=1` and intercepts all dummy-key PostHog traffic. Do not use the ordinary API `start` or web `dev` scripts for this harness: they load local environment files. Do not start a worker, sync real mailboxes, provide Google tokens, or use real payment keys.

For manual CUA verification, visit the isolated API `/api/auth/dev/login?email=chintan.e2e.billing%40synthetic.test`, then open the isolated web URL. All visible names/messages are synthetic. Seed includes a two-message newsletter, a protected sender, a Triage recommendation and today's UTC Brief. The dismissal spec seeds its own five-day follow-up row.

## CI coverage and limits

The workflow provisions disposable Postgres/Redis services; no worker or real credentials. It retains the existing accessibility, responsive, hydration, paint and billing lanes, and adds `e2e:journeys`:

| Journey | Evidence asserted |
| --- | --- |
| Triage Keep | Archive preview cancelled; Keep removes queue row; durable activity plus atomic outbox event; excluded after reload |
| Sender protection | Real policy write; reload persists state; toggle back |
| Protected senders | Evidence reason; real in-place unprotect; durable policy |
| Follow-up dismissal | Real dismissal + audit; absent after reload |
| Brief | Seeded yesterday count versus real current-inbox preview; cancel issues no action POST and keeps inbox count |
| Search (3 cases) | Complete keystrokes, suggestion debounce cancellation, clear |
| Public journeys (2) | Connected guide/privacy/pricing/demo cleanup and Undo; comparison/sources/refunds/signup ref at intercepted OAuth boundary |
| Consent (2) | Decline remains silent; accept produces intercepted dummy-key PostHog traffic |

`contracts/assert-journeys.mjs` requires every named file and its expected minimum case count; skips, failed cases and flaky retries fail the lane. `test:harness` runs safety and report-contract checks without a browser. `typecheck` validates all specs.

**Unrun boundary:** no browser suite was executed during this coding pass because browser automation is restricted to CUA. The CI configuration and specs are prepared, not a claim that they have passed in Chromium. Manual CUA verification and the actual CI result are required before claiming readiness.

The [September 22 launch audit](../../docs/execution/launch-readiness-audit-2026-09-22.md) records manual CUA checks on the isolated stack and their limits. Those observations do not replace the complete CI browser suite.

**Provider boundary:** `undo.spec.ts` and `brief-noise-archive.spec.ts` are preserved outside the default project. `E2E_PROVIDER_HARNESS=1` exposes a separate `provider-contract` project, still constrained to isolated synthetic services. They require an isolated mock-provider worker harness that is not yet supplied, so they are NOT part of launch CI and must not be run against real Gmail. Preview cancellation and the public demo Undo do not prove authenticated worker restoration. Keep's worker projection is likewise not exercised here; this lane verifies its committed outbox contract. Existing API/worker tests remain the separate evidence for those mechanics.
