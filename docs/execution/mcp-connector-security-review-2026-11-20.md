# MCP connector — security review before `MCP_ENABLED=true`

- **Date:** 2026-11-20
- **Gate:** `docs/spec/mcp-connector.md` §9 ("independent adversarial review"), ADR-0048
- **Scope:** `apps/api/src/oauth/**`, `apps/api/src/mcp/**`, the consent and confirm
  pages (`apps/web/src/features/connected-apps/`, `apps/web/src/middleware.ts` for
  their headers), and every gate keyed on `MCP_ENABLED` / `MCP_BETA_USER_IDS`.
  Code at `39d38cc6` (main, 2026-11-20).
- **Reviewer:** Claude, in a session separate from the one that wrote the connector.
  Read from the code and tests, not from the author's notes.
- **Verdict:** **PASS WITH NOTES.** One defect found and fixed in this PR (Medium,
  API-wide, not specific to the connector). Nothing found that `true` exposes beyond
  letting every account in. The notes below are accepted risks or follow-ups, none
  blocking.

## How it was checked

1. Read every production file in scope, then the existing suites (16 files, 355
   tests, all green at `39d38cc6`).
2. Wrote probes for the doors those suites did not try:
   `apps/api/src/mcp/mcp-security-review.http.spec.ts` (12 tests, real Nest app over
   HTTP, PGlite, `MCP_ENABLED=true`).
3. Ran this worktree's API alone on :4011 against the dev Postgres and probed it with
   `curl` (metadata, registration policy, `/mcp` challenge and headers, oversized and
   mis-encoded bodies). The dev database has not had the OAuth migration applied, so
   the full connect flow was not repeated there; another session's stack shares that
   database, and the flow runs end to end over HTTP in the suites and in production
   beta.

The OAuth test harness sets `MCP_ENABLED=true` (`oauth-test-harness.ts:117`), so every
existing connector test already runs in the mode this review clears.

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                        |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| F1  | Medium   | A request body the parser refuses for size or encoding (`entity.too.large`, `encoding.unsupported`, `request.aborted`, …) reached `AllExceptionsFilter` as a plain `http-errors` object and was answered **500**, logged as `exception.5xx` and sent to Sentry. Body parsing runs before every guard and limiter, so anyone could produce unlimited 500s and Sentry events on `/mcp`, `/oauth/*` or any API route. | Fixed: answered 413 / 415 / 400, not reported |

**F1 — before / after.** Before: `POST /mcp` with a 300 KB body, no token → `500
INTERNAL_ERROR`, one Sentry event per request. After: `413 "Request body is too
large."`, no Sentry event (verified on :4011 and in tests). Fix:
`apps/api/src/common/all-exceptions.filter.ts` maps the parser's own rejection types to
their 4xx with a fixed message. Negative control: with the fix reverted, the unit test in
`all-exceptions.filter.spec.ts` and two probes in `mcp-security-review.http.spec.ts` go
red; restored, green. Malformed JSON was already a 400 (Nest maps `SyntaxError` itself),
so it is not in the table. Sibling sweep: the only other non-`HttpException` client error
Express raises before routing is `URIError`, which Nest also maps to 400.

## Checklist

### OAuth

| Check                       | Result | Evidence                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| redirect_uri exact match    | ✅     | `oauth-flow` "never redirects to an unregistered redirect URI", "does not let an https client vary its port"; probe "a code is redeemable only by its own client, with its own redirect URI"                                                                                              |
| Registration abuse          | ✅     | `oauth-client-policy.ts`: public clients only, metadata allowlist (no fetched URLs), https or loopback http only, ≤10 URIs ≤255 chars, name stripped of invisible/bidi characters; 60/min per address; unapproved clients swept after 30 days. Live: custom scheme and plain http refused |
| PKCE required, S256 only    | ✅     | `pkce.required: () => true`; adapter refuses to store a code without S256; metadata advertises `["S256"]` (live); "requires PKCE", "refuses the plain PKCE method"                                                                                                                        |
| Code reuse                  | ✅     | Atomic consume; replay revokes the grant ("a replayed authorization code revokes the grant it minted"); 60-second codes                                                                                                                                                                   |
| Refresh rotation and reuse  | ✅     | Rotated every use, one live token per family, reuse after the 30-second grace revokes the grant (tests in `oauth-flow` and `oauth-hardening`). See N1                                                                                                                                     |
| Token lifetime              | ✅     | Access 1 h, refresh 30 d, code 60 s, interaction 15 min (`mcp-config.ts`)                                                                                                                                                                                                                 |
| Revocation on disconnect    | ✅     | Settings → Disconnect, the app's own RFC 7009 revoke, and account deletion all revoke the grant; every token lookup joins the grant                                                                                                                                                       |
| Resource / audience binding | ✅     | One resource; any other `resource` is `invalid_target`; guard checks audience ("refuses a token issued for another audience"); probe "a refresh cannot move the token to another resource"                                                                                                |
| Issuer metadata             | ✅     | Issuer from `API_URL`, never from `Host` / `X-Forwarded-*`; OIDC-only fields removed (`jwks_uri` absent, live)                                                                                                                                                                            |
| Scope downgrade / upgrade   | ✅     | Probe "a refresh cannot add a scope the grant does not hold"; read-only token refused every cleanup tool with a 403 scope challenge, and the handler re-checks scope itself                                                                                                               |
| Consent CSRF                | ✅     | Approve / Deny need session + CSRF token; the request is bound to the browser's signed interaction cookie; the code is released only to a browser still holding the approver's session                                                                                                    |
| Clickjacking                | ✅     | Web: `frame-ancestors 'none'` + `X-Frame-Options: DENY` on every document route (`middleware.ts`, matcher excludes only static assets). API: same pair on every response (live on `/mcp`)                                                                                                 |
| Interaction cookies         | ✅     | HttpOnly, SameSite=Lax, signed with a key derived from `JWT_ACCESS_SECRET`; Secure follows the configured https issuer; the library keeps no login session (`NoSessionStore`)                                                                                                             |
| Open redirects              | ✅     | Interaction hop redirects only to `WEB_URL`; consent page follows only an API `/oauth/authorize/<id>` URL (`isApiResumeUrl`); library redirects only to registered URIs; errors render as plain text with the error code only                                                             |
| Account switch              | ✅     | Switch logs out and returns to sign-in; Approve records the new session's user; resume checks that same user's session                                                                                                                                                                    |
| Token only in the header    | ✅     | Probe "accepts the token only in the Authorization header, never in the URL"                                                                                                                                                                                                              |

### What `true` turns on

Every gate: `McpEnabledGuard` (protocol, consent, grants, previews, `/mcp`),
`McpUserAllowedGuard` (grants, confirm page), `mcpAllowedFor` in `findAccount`,
consent `details` / `approve`, and `McpTokenGuard`. With `true`, `mcpAllowedFor`
returns true and nothing else changes: no route, scope, tool or limit is keyed on the
mode. Deletion-pending accounts are refused independently of the flag (consent
details/approve, `findAuthorizableUser` on code exchange and refresh, the token
lookup's `NOT EXISTS`, the confirm page's `findOwned`), all tested under `true`.
Probe: with `MCP_BETA_USER_IDS` naming someone else, an unlisted account connects and
uses the tools.

### Authorization in tools

| Check                                  | Result | Evidence                                                                                                                                                                                                             |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sender_id scoped to the mailbox        | ✅     | Every sender read and write filters by `mailbox_account_id`; probes: another person's sender is not found by `get_sender`, `protect_sender`, `preview_cleanup`; one mailbox's sender not reachable through the other |
| mailbox scoped to the workspace        | ✅     | `resolveMailbox` lists the token's workspace only; another address is `MAILBOX_NOT_FOUND`                                                                                                                            |
| preview_id scoped                      | ✅     | `findOwned` by user, live grant, connection epoch, no deletion; `apply` also requires the same grant and mailbox; probe: two people on one registered client stay apart                                              |
| action / batch id scoped               | ✅     | `getStatus` / `getBatchStatus` filter by mailbox ("cannot read another person's action")                                                                                                                             |
| undo limited to this app's own actions | ✅     | `startedByClient` (mailbox + undo token + forward job with this client's origin); "cannot list or undo a change the person made in DeclutrMail itself"                                                               |
| read scope cannot reach cleanup tools  | ✅     | SDK scope challenge plus a handler re-check                                                                                                                                                                          |
| confirm page: signed-in owner only     | ✅     | Session + CSRF; bearer token cannot use it; another user gets 404                                                                                                                                                    |
| no apply without a human press         | ✅     | `apply` never transitions a preview; only the cookie+CSRF `confirm` does. Stricter than spec §3: elicitation is not built, so the page is the only confirmation (N5)                                                 |
| Protected senders skipped              | ✅     | Re-checked at enqueue, `override: false` on every path, single-sender unsubscribe refused explicitly; injection fixture shows zero Protected changes                                                                 |

### Data leaving

Outputs are parsed through each tool's Zod output schema (unknown keys stripped), and
the registry contract test fails by name on a field with no `ai-assistant` dataset.
No snippet, body, Message-ID, Gmail id or token is in any output schema. Unexpected
errors become a fixed sentence; only codes written for people pass their message
through. Logs and product events carry ids, verbs, closed-list client labels and
buckets — no address, subject or name (`mcp-analytics.http.spec.ts`).

### Prompt injection

Sender-written text is returned only as structured fields; tool descriptions and
server instructions are static and say that names, subjects and links are data. No
tool acts on sender text, and no tool can change mail without the person's press on
DeclutrMail's page (`mcp-injection.http.spec.ts`: zero mail mutations, zero Protected
changes for a model that obeys the subject line).

### Abuse

Per-address limit before the token lookup (3,000/min on `/mcp`; 60/min registration;
30/min authorize; 600/min token); per-user read and write budgets inside the tools;
60 previews/min per grant; undo held to the web route's 30/min. Body limit 100 KB
(Nest), 8 KB on OAuth endpoints, 4 KB URLs (F1 makes the refusals 4xx).
`subscriptions/listen` refused (`maxSubscriptions: 0`, tested); `GET`/`DELETE` 405.
A JSON-RPC batch is answered without a server error (probe), and every tool call,
batched or not, goes through the one wrapper that checks scope and spends the budget
(`McpServerService.register`).

## Notes (accepted, not blocking)

- **N1 — refresh grace.** A refresh token reused within 30 s of its first use is
  honoured once more, so a thief racing the real client inside that window gets a
  working pair; the family is revoked at the next use of the retired token. Deliberate
  trade for clients that lose a response.
- **N2 — no ceiling across people.** Hosted clients share addresses, so the per-address
  limit is wide; the real bounds are per person. Database load from the connector grows
  with active people like the web app's does (each tool call is a token lookup plus a
  few indexed reads). Watch the pool alerts after the flip.
- **N3 — open registration means consent phishing is possible.** Anyone can register a
  client called "Claude". The consent page shows the redirect host and Settings lists
  every app's hosts, which is the standard mitigation. A follow-up could flag names that
  match a known assistant whose redirect host is not that assistant's.
- **N4 — malformed JSON echoes the caller's own bytes.** Nest's 400 message quotes a
  fragment of the body it could not parse, back to the sender only. Not a leak.
- **N5 — elicitation is not built.** `apply_cleanup` never starts anything; the confirm
  page is the only path. Spec §3's elicitation branch is unbuilt, which is the safer
  side.
- **N6 — turning the flag off does not revoke grants.** Tokens are refused while off;
  switching back on revives them. Settings → Connected apps is hidden while off.
- **N7 — the confirm page shows sender-written names.** Escaped, and the verb, counts
  and destination come from the server, so a name can mislead only alongside them.
