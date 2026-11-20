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

In `beta`, an account not on the list can open the consent page, but
Approve answers 403 `CONNECT_NOT_AVAILABLE` ("Connecting apps is not
available for your account yet."). If it connected earlier (under `true`,
or while listed), its access token gets 401 `invalid_token` at `/mcp` and
its refresh token 400 `invalid_grant`, so the app starts over and meets
that refusal; the confirm page and Settings → Connected apps answer 404.
Removing someone from the list cuts them off on their next request. Their
connection stays stored, unusable, and works again if the mode later goes
to `true` before its refresh token expires.

**Beta is not a smaller attack surface.** Registration, authorize, token
and the discovery documents are public in `beta` exactly as in `true`: the
list only decides who can approve and use. Beta needs the same security
review as `true`.

Production sets `MCP_ENABLED=true` (since 2026-11-20) in `.github/workflows/deploy-cloud-run.yml`
(`API_ENV_BASE`). That line is the only place to change it: the deploy's
`--set-env-vars` is a full replace, so a `gcloud run services update`
lasts until the next deploy.

## Before the first switch-on

1. The independent security review the spec requires (§9) has passed.
   This applies to `beta` too (above).
2. PR merged, and **Migration apply (Atlas → Supabase)** green on `main` for
   `0101_mcp_connector` (CI applies it; never from a laptop).
3. `API_URL=https://api.declutrmail.com` is in `API_ENV_BASE` (it is the
   OAuth issuer; the API refuses to boot with the connector on without it).
4. `/privacy` §4 names apps the person connects among the parties Gmail
   data may go to (done 2026-11-20, PR #1222). Without that sentence a
   connected assistant contradicts the published policy.

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
| `kind: "mcp.client_profile"`                  | API logs          | Per tool call: client family, protocol, whether it can confirm in chat    |

The funnel, last 7 days (read-only):

```sql
select event, count(*), count(distinct props->>'preview_id') as requests
from product_events
where event::text like 'connector\_%' and occurred_at > now() - interval '7 days'
group by 1 order by 1;
```

Ask-to-start conversion is `connector_request_started` over
`connector_request_prepared`, counted by distinct `preview_id`. Started
counts a request applied to at least one sender; refused counts a press
that was spent. `connector_request_refused` with `reason =
'QUOTA_EXHAUSTED'` or `'UPGRADE_REQUIRED'` is someone who wanted more than
their plan allows. `client` (which assistant) is on connected, tool-called
and prepared; join viewed, started and refused to prepared on
`preview_id` for it. Connected minus disconnected is not the number of
live connections (a connection replaced by a reconnect, a denial after
Approve and account deletion write no disconnect): count
`oauth_grants where revoked_at is null` for that.
Event definitions: `docs/observability/event-taxonomy.md`.

Why tool calls fail, last 7 days. `error_class` is the tool's error code
in PascalCase (`PREVIEW_EXPIRED` → `PreviewExpired`); it is absent on
calls that succeeded:

```sql
select props->>'tool' as tool, props->>'error_class' as error, count(*)
from product_events
where event = 'connector_tool_called' and props->>'outcome' = 'error'
  and occurred_at > now() - interval '7 days'
group by 1, 2 order by 3 desc;
```

Which clients could confirm a preview in the chat (MCP elicitation)
instead of opening the confirm link. Logs Explorer, last 7 days:

```
resource.type="cloud_run_revision"
resource.labels.service_name="declutrmail-api"
jsonPayload.kind="mcp.client_profile"
```

Each line carries `jsonPayload.client`, `.protocol` and `.elicitation`. Only clients on
protocol `2026-07-28` send their capabilities with every call, so only
they read `yes` or `no`. A 2025-era client reads `unknown`: it declared
them once, on a request this stateless server does not keep. In-chat
confirmation could only reach clients on the 2026 protocol with
`elicitation: yes`.

## Roll back

In this order. Each step is enough on its own for most incidents.

1. Turn off (above).
2. Roll the API back to the previous image
   (`gcloud run services update declutrmail-api --region us-central1 --image=<sha>`).
3. Only if the tables themselves must go: `0102_activity_origins.rollback`,
   then `0101_mcp_connector.rollback`, through the same CI path as a
   migration (0102's foreign keys point at 0101's tables). Together they
   drop the eight connector tables (every connection, every waiting
   request, every "via <app>" in Activity) and must run **after** step 2:
   account deletion and the retention worker touch these tables whatever
   `MCP_ENABLED` says. `product_events` keeps the connector event names
   and the wider CHECK; Postgres cannot drop an enum label.

## Local development

`.env.local`: `MCP_ENABLED=true`, `API_URL=http://localhost:4000`. The
MCP URL is `http://localhost:4000/mcp`. A dev database that applied an
earlier draft of 0101 or 0102 keeps that draft (Atlas tracks the version,
not the content). Rebuild it with `./scripts/dev-auth.sh` (drops the dev
database), or keep its other data: run
`psql -f packages/db/migrations/0102_activity_origins.rollback`, then
`psql -f packages/db/migrations/0101_mcp_connector.rollback` (both skip a
table a draft never made), delete the `0101` and `0102` rows from
`atlas_schema_revisions`, and migrate again.

### What does not work locally (checked 2026-11-19)

- **The Claude desktop app** refuses the local sign-in: "Refused to open
  sign-in URL for declutrmail: must be https".
- **A tunnel** (`API_URL` set to an `https://…trycloudflare.com` host)
  gets as far as the consent page, which then says the request is no
  longer available. The authorize step sets the pending request's cookie
  on the tunnel host, while the consent page at `localhost:3000` calls
  the API at `localhost:4000`, which never receives that cookie
  (`GET …/details` answers 410 `CONNECT_REQUEST_GONE`). The client's
  configured URL must also match the issuer exactly, or it stops before
  sign-in ("Protected resource … does not match expected …").

Test a real client against production in beta instead ("Turn on for
yourself"). Locally, drive the flow by hand:

### Drive the flow by hand

With the API on `:4000` and the web app on `:3000`, sign in with the dev
login (CLAUDE.md §8.7), then register a client and make a PKCE pair:

```bash
curl -s -X POST http://localhost:4000/oauth/register -H 'content-type: application/json' -d '{"client_name":"Local test","redirect_uris":["http://127.0.0.1:53682/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"]}'
```

```bash
VERIFIER=local-test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
```

Open this in the signed-in browser, with the `client_id` from the
registration:

```
http://localhost:4000/oauth/authorize?client_id=<client_id>&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback&code_challenge=<CHALLENGE>&code_challenge_method=S256&scope=read+cleanup&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&state=x
```

Approve. The browser then fails to load `127.0.0.1:53682/callback`;
copy `code` from its address bar and exchange it within 60 seconds:

```bash
curl -s -X POST http://localhost:4000/oauth/token -d grant_type=authorization_code --data-urlencode code=<code> --data-urlencode redirect_uri=http://127.0.0.1:53682/callback --data-urlencode client_id=<client_id> --data-urlencode code_verifier="$VERIFIER" --data-urlencode resource=http://localhost:4000/mcp
```

Call a tool with the `access_token`:

```bash
curl -s -X POST http://localhost:4000/mcp -H "authorization: Bearer <access_token>" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_senders","arguments":{"limit":5}}}'
```

To see the consent page as an account outside the beta, restart the API
with an override; nothing in `.env.local` changes:

```bash
MCP_ENABLED=beta MCP_BETA_USER_IDS=00000000-0000-0000-0000-000000000000 pnpm --filter @declutrmail/api start
```
