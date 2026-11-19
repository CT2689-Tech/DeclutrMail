# MCP connector

Operating the connector that lets an assistant (Claude, ChatGPT, a local
MCP client) read a person's senders and _ask_ for a cleanup the person
confirms in DeclutrMail. Design: [ADR-0048](../adr/0048-mcp-connector-is-a-second-client.md),
[spec](../spec/mcp-connector.md). Code: `apps/api/src/{mcp,oauth}/`,
`apps/web/src/features/connected-apps/`.

## Modes

One variable, `MCP_ENABLED`, read on every request.

| `MCP_ENABLED`     | Routes¹ | Who can connect and use an app                                    |
| ----------------- | ------- | ----------------------------------------------------------------- |
| unset, `false`, … | 404     | nobody                                                            |
| `beta`            | served  | only the `users.id` values in `MCP_BETA_USER_IDS` (empty: nobody) |
| `true`            | served  | everyone                                                          |

¹ `/.well-known/oauth-*`, `/oauth/*`, `/mcp`, `/api/oauth/*`,
`/api/action-previews/*`.

In `beta`, an account not on the list meets the connector as if it were
off: Approve answers 403 `CONNECT_NOT_AVAILABLE` ("Connecting apps is not
available for your account yet."), `/mcp` answers 401 `invalid_token` (the
app asks the person to connect again), and the confirm page and
Settings → Connected apps answer 404. Removing someone from the list cuts
them off on their next request.

Production sets `MCP_ENABLED=false` in `.github/workflows/deploy-cloud-run.yml`
(`API_ENV_BASE`). That line is the only place to change it: the deploy's
`--set-env-vars` is a full replace, so a `gcloud run services update`
lasts until the next deploy.

## Before the first switch-on

1. PR merged, and **Migration apply (Atlas → Supabase)** green on `main` for
   `0101_mcp_connector` (CI applies it; never from a laptop).
2. `API_URL=https://api.declutrmail.com` is in `API_ENV_BASE` (it is the
   OAuth issuer; the API refuses to boot with the connector on without it).
3. The founder follow-up on Google's Limited Use policy
   (`docs/log/founder-followups/2026-11-19-mcp-connector-google-limited-use.md`)
   is decided. Until then `/privacy` §4 says Gmail data goes to no third
   party but subprocessors, which a connected assistant is not: stay at
   `false`, or `beta` with only your own id.

## Turn on for yourself (beta)

1. Find your user id, read-only, in the Supabase SQL editor:
   `select id from users where email = '<your address>';`
2. One-line PR to `deploy-cloud-run.yml`, in `API_ENV_BASE`:
   `MCP_ENABLED=false` → `MCP_ENABLED=beta,MCP_BETA_USER_IDS=<id>`.
   Several ids are space-separated (the list itself is comma-delimited).
   Update the pin in `scripts/deploy-api-safely.test.mjs` in the same PR.
3. After the deploy, check the routes are served:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://api.declutrmail.com/.well-known/oauth-authorization-server
   ```

   `200` is on; `404` is off.

4. In the assistant, add a custom connector with the URL
   `https://api.declutrmail.com/mcp`, approve on DeclutrMail's consent
   page, and ask it what it can do. Then ask for an Archive of one small
   sender, open the link it gives, press Archive, and check Activity says
   which app asked.

## Turn on for everyone

The same line: `MCP_ENABLED=true`, and drop `MCP_BETA_USER_IDS`. Beta
users' connections carry over.

## Turn off (kill switch)

1. Fastest, for an incident:

   ```bash
   gcloud run services update declutrmail-api --region us-central1 --update-env-vars MCP_ENABLED=false
   ```

   A new revision serves within about a minute. Every connector route
   then answers 404; no tool runs and no confirm page loads.

2. In the same hour, land `MCP_ENABLED=false` in `deploy-cloud-run.yml`.
   Otherwise the next deploy turns it back on.

Off keeps every connection in the database. Switching back on revives
the ones whose tokens have not expired. To make everyone connect again,
revoke every grant: that is a mass write on production and a founder
decision, not a step of this runbook.

## What to watch

| Signal                                        | Where             | Means                                                                     |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `kind: "mcp.error"`, Sentry tag `mcp_tool`    | API logs, Sentry  | A tool hit an unexpected error; the app was told "try again"              |
| `kind: "oauth.refresh_grace_used"`            | API logs (warn)   | A client re-sent a refresh token within 30 s (a retry, or a stolen token) |
| `kind: "action_preview.refusal_not_recorded"` | API logs, Sentry  | A refused start could not be recorded; the press is not spent             |
| `kind: "action_preview.claim_not_released"`   | API logs, Sentry  | A failed start held its claim; a retry waits up to 2 minutes              |
| `connected_app.connected` / `.disconnected`   | `security_events` | Connect and disconnect, per grant                                         |
| `connector_*` events                          | `product_events`  | The funnel (below)                                                        |

The funnel, last 7 days (read-only):

```sql
select event, props->>'client' as client, count(*),
       count(distinct props->>'preview_id') as requests
from product_events
where event::text like 'connector\_%' and occurred_at > now() - interval '7 days'
group by 1, 2 order by 1, 2;
```

Ask-to-start conversion is `connector_request_started` over
`connector_request_prepared`, counted by distinct `preview_id`.
`connector_request_refused` with `reason = 'QUOTA_EXHAUSTED'` or
`'UPGRADE_REQUIRED'` is someone who wanted more than their plan allows.
Event definitions: `docs/observability/event-taxonomy.md`.

## Roll back

In this order. Each step is enough on its own for most incidents.

1. Turn off (above).
2. Roll the API back to the previous image
   (`gcloud run services update declutrmail-api --region us-central1 --image=<sha>`).
3. Only if the tables themselves must go: `0101_mcp_connector.rollback`,
   through the same CI path as a migration. It drops the seven connector
   tables (every connection, every waiting request) and must run **after**
   step 2: account deletion and the retention worker touch these tables
   whatever `MCP_ENABLED` says. `product_events` keeps the connector event
   names and the wider CHECK; Postgres cannot drop an enum label.

## Local development

`.env.local`: `MCP_ENABLED=true`, `API_URL=http://localhost:4000`. The
MCP URL is `http://localhost:4000/mcp`. A dev database that applied an
earlier draft of 0101 keeps that draft (Atlas tracks the version, not
the content): run `psql -f packages/db/migrations/0101_mcp_connector.rollback`
against it, remove the `0101` row from `atlas_schema_revisions`, and
migrate again — or rebuild it with `./scripts/dev-auth.sh` (drops the dev
database).
