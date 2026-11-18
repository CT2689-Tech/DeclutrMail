# MCP connector — spec

- **Status:** Approved by founder, 2026-11-17 (decisions in §11)
- **Rules:** [ADR-0048](../adr/0048-mcp-connector-is-a-second-client.md). Where this spec and the ADR disagree, the ADR wins.
- **Tier:** Tier 1 throughout (new auth surface, new Gmail-data recipient, destructive actions, migration). Nothing ships until the independent security review in §9 passes.

## 1. Goal

A person connects DeclutrMail to Claude, ChatGPT, Grok, Claude Code,
Codex or Cursor — any client that speaks remote MCP over Streamable HTTP
with OAuth; one server serves them all — then cleans their inbox by
asking: "who emails me most and do I
ever read them?", "unsubscribe from the store ones", "undo that". The
assistant reasons; DeclutrMail previews, executes, and undoes.

**Done means:**

- A person can connect from Claude's directory, list senders, preview
  and apply all five verbs, check progress, and undo — on both
  connected test mailboxes.
- No mail changes unless a human confirmed that exact preview, proven
  by a test whose assistant ignores every instruction it was given.
- Every field the connector returns is in `gmail-data-inventory.ts`.

## 2. Tools

Ten tools. Every tool has a `title` and an annotation (Claude directory
requirement). "Calls" names the existing service the tool wraps; no tool
has logic of its own beyond validation and shaping.

| Tool                  | Annotation                                   | Calls                                                                                                     | Returns                                                                                                                    |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `list_mailboxes`      | read-only                                    | `MailboxAccountsService` list                                                                             | address, status, sync state, which one is active                                                                           |
| `list_senders`        | read-only                                    | senders list (`sort` = `total` \| `last_seen`, `q`, Gmail tab, `protected_only`, `limit` ≤ 100, `cursor`) | one row per sender (fields in §5)                                                                                          |
| `get_sender`          | read-only                                    | `ActionsService.previewComposite` + sender detail                                                         | counts by window (all / 30 / 90 / 180 / 365 days), 5 most recent subjects with dates, Protected state, unsubscribe method  |
| `get_usage`           | read-only                                    | `EntitlementsService`                                                                                     | tier, cleanup actions used / limit, reset date                                                                             |
| `preview_cleanup`     | read-only (writes a preview row, never mail) | `previewComposite` (one sender) / `previewBulkComposite` (2+), then inserts `action_previews`             | `preview_id`, expiry, sender count, email count, where the email goes, how to undo, senders skipped and why, `confirm_url` |
| `apply_cleanup`       | destructive, idempotent                      | confirmation (§3), then the route the web app uses for that verb and sender count (table below)           | action or batch id + status, or `needs_confirmation`                                                                       |
| `get_action_status`   | read-only                                    | `getStatus` / `getBatchStatus`                                                                            | queued / running / done / failed, counts, undo availability                                                                |
| `list_recent_actions` | read-only                                    | `UndoService.listActiveDecisions`                                                                         | undoable decisions, newest first, with expiry                                                                              |
| `undo`                | write, idempotent                            | `UndoService` revert by decision                                                                          | reverse action id + status                                                                                                 |
| `protect_sender`      | write, idempotent                            | `SendersPolicyService.setPolicy` with `{ isProtected: true }`                                             | new Protected state                                                                                                        |

**Which existing method `apply_cleanup` calls** (all on `ActionsService`;
the composite selector takes 2+ senders, so one sender uses the
single-sender path, as the web app does):

| Verb                     | One sender                | 2–1,000 senders               |
| ------------------------ | ------------------------- | ----------------------------- |
| Archive · Later · Delete | `enqueueComposite`        | `enqueueBulkComposite`        |
| Unsubscribe              | `recordUnsubscribeIntent` | `enqueueBulkUnsubscribe`      |
| Keep                     | `recordKeepIntent`        | `recordKeepIntent` per sender |

**Arguments shared by every tool:** optional `mailbox` (an address).
Absent → the active mailbox, resolved exactly as `CurrentMailboxGuard`
does (`users.preferences.activeMailboxId`, then the first active).
Ownership is checked; an address outside the workspace is
`MAILBOX_NOT_FOUND`. Every result names the mailbox it acted on.

**`preview_cleanup` arguments:** `verb` (`keep` \| `archive` \|
`unsubscribe` \| `later` \| `delete`), `sender_ids` (1–1,000, the
existing multi-sender cap), optional `older_than_days` (30 / 90 / 180 /
365), `wake_at` for Later. One verb per preview. Delete is `inbox_only`
reach (ADR-0028); the connector never sends `all_mail`.

**Not exposed:** Unprotect, Autopilot rules, Screener, Brief,
Follow-ups, composite secondary verbs. Unprotect is excluded on
purpose (ADR-0048 rule 2): a subject line that talks the assistant into
unprotecting a sender is the attack that turns Protected into a
suggestion.

## 3. Confirmation flow

The model can call `apply_cleanup`; it cannot confirm it.

```
preview_cleanup ─▶ action_previews row  (state: pending, expires in 15 min)
apply_cleanup(preview_id)
  ├─ row missing / other user / other mailbox ─▶ PREVIEW_NOT_FOUND
  ├─ expired ─────────────────────────────────▶ PREVIEW_EXPIRED
  ├─ applied ─────────────────────────────────▶ same action id (idempotent)
  ├─ client supports elicitation
  │    └─ send elicitation: the preview text + Confirm / Cancel
  │         ├─ Confirm ─▶ state confirmed ─▶ enqueue ─▶ state applied
  │         └─ Cancel / no answer ─▶ NOT_APPLIED (row stays pending)
  └─ no elicitation ─▶ needs_confirmation + confirm_url
        person opens confirm_url in DeclutrMail (session cookie, same user)
        ─▶ sees the web app's preview ─▶ presses the verb button
        ─▶ state confirmed ─▶ enqueue ─▶ applied
        model calls apply_cleanup again ─▶ returns the action id
```

- **Idempotency key** for the enqueue is `mcp-preview:<preview_id>`,
  so a retried apply, a double page click, and an apply after the page
  click all resolve to one action.
- **Re-checks at enqueue**, not at preview: Protected (a sender
  protected since the preview is skipped and named), quota (existing
  serialized check), mailbox still connected. The preview froze the
  sender set; the email count is re-resolved when the worker runs, so
  `get_action_status` reports the count actually moved.
- **Elicitation text** is the preview's own copy: count, where it goes,
  how to undo — once each (CLAUDE.md §2.3). It is generated by the
  server, not by the model.
- **Confirm page** is a new web route `/confirm/[previewId]` that
  renders the existing preview sheet for the stored preview. Signed-out
  → sign in → back to the page. A different user → not found.
- Verify at build time whether Claude and ChatGPT support elicitation
  on remote servers. If neither does, the link is the only path, and
  that is acceptable: it is still a human pressing our button.

## 4. Authentication

The MCP authorization spec makes `/mcp` an OAuth resource server and
DeclutrMail its authorization server. Check endpoint details against the
current MCP spec at build time; the shape below is the target.

| Endpoint                                      | Purpose                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource`   | Points clients at our authorization server (RFC 9728)                                                   |
| `GET /.well-known/oauth-authorization-server` | Server metadata (RFC 8414)                                                                              |
| `POST /oauth/register`                        | Dynamic client registration (RFC 7591); add Client ID Metadata Documents if the target clients use them |
| `GET /oauth/authorize`                        | Redirects to the web consent page                                                                       |
| `POST /oauth/token`                           | `authorization_code` with PKCE S256 (required), `refresh_token`                                         |
| `POST /oauth/revoke`                          | Token revocation                                                                                        |
| `POST /mcp`                                   | Streamable HTTP, stateless (Cloud Run runs several instances)                                           |

- **Consent page** (`/connect/authorize`, web): signed-out → existing
  Google sign-in → back. Shows the app's name, the redirect host, what
  it can do (read senders; clean up with your confirmation), and which
  mailboxes it reaches. Approve / Deny.
- **Scopes:** `read` (the six read-only tools) and `cleanup` (preview,
  apply, undo, protect). The consent page lists only what was requested.
- **Tokens:** opaque, random 256-bit, stored as SHA-256 hashes. Access 1
  hour; refresh 30 days, rotated on every use, reuse of a rotated
  refresh token revokes the whole family. Audience-bound to the `/mcp`
  resource (RFC 8707). Redirect URIs match exactly; `https` only, plus
  loopback for desktop clients (RFC 8252).
- **Guard:** `McpTokenGuard` on `/mcp` only. Bearer tokens are not sent
  by browsers on their own, so no CSRF guard; `/mcp` gets no CORS
  allowance because MCP clients call it server to server or from native
  apps. Existing cookie routes, CORS and CSP are unchanged.
- **Settings → Connected apps:** each grant with app name, connected
  date, last used, and Disconnect (revokes the grant and every token).
- **Claude's hosted callback** is `https://claude.ai/api/mcp/auth_callback`
  per Claude's connector docs; confirm at build time.

## 5. Data that leaves through the connector

Tool results carry only these, each already a registry dataset:

| Returned                                       | Registry id                     |
| ---------------------------------------------- | ------------------------------- |
| Sender display name, address, domain           | `sender-identity`               |
| Message counts, first / last seen, read rate   | `sender-profile-and-stats`      |
| Subject lines                                  | `subject`                       |
| Message dates                                  | `received-date`                 |
| Gmail tab                                      | `gmail-labels`                  |
| Unsubscribe method (one-click / mailto / none) | `unsubscribe-channels`          |
| Protected state                                | `choices-rules-and-suggestions` |
| Recent actions and undo expiry                 | `actions-activity-and-undo`     |
| Sync state                                     | `gmail-sync-state`              |

**Never:** snippets (`gmail-preview`), bodies (we do not have them),
other headers, Gmail message or thread ids (`message-identifiers`).

Registry change: add `'ai-assistant'` to `GmailDataExportFormat`, list
it in `exportedIn` for each dataset above, add an `action-previews`
dataset (derived; sender ids and counts; retention as §7), and add a
contract test that walks every tool's output schema and fails if a
field maps to no dataset or to one without `ai-assistant`. The
generated storage list and privacy page pick it up from the registry. The person's
assistant is not our processor, so `GmailDataProcessor` does not change;
the privacy page says the person chooses that recipient.

Text inside results is data the model will read, so subjects are
returned as fields in structured content, never interpolated into
instructions or tool descriptions.

## 6. Limits

- Reads use the `triage-load` bucket, writes the `gmail-action` bucket,
  keyed by user as today. Add a per-grant ceiling on
  `preview_cleanup` (60 / minute) so a looping assistant cannot fill
  the previews table.
- Quota: Free's 50 cleanup actions a month (`pricing.config.ts`) apply
  exactly as in the web app. `QUOTA_EXHAUSTED` returns the reset date
  and an upgrade link; nothing is applied.
- Tier: every tier. All ten tools sit on Free capabilities (`senders`,
  `sender-detail`, `activity`, `cleanup-actions`). Founder decision 3.

## 7. Schema (one migration)

| Table              | Holds                                                                                                                | Retention         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `oauth_clients`    | client id, name, redirect URIs, registration type                                                                    | until deleted     |
| `oauth_grants`     | user, workspace, client, scopes, created, last used, revoked                                                         | revoked + 30 days |
| `oauth_tokens`     | grant, kind, token hash, family, expires, replaced by, revoked                                                       | expiry + 7 days   |
| `oauth_auth_codes` | code hash, grant, PKCE challenge, redirect URI, expires (60 s), used                                                 | expiry + 1 day    |
| `action_previews`  | workspace, mailbox, user, grant (null = web), verb, params, sender ids, counts, state, expires, confirmed, action id | expiry + 1 day    |

`action_previews` stores counts, never subjects. Account deletion
cascades through workspace. The deletion undo window is unchanged, but
grants are revoked when deletion starts, not when the window ends: an
account on its way out should not keep taking actions from an
assistant. Mailbox disconnect deletes that mailbox's previews.

Activity: actions applied through the connector appear like any other.
`activity_log` gains the originating grant id, the way Autopilot rows
already carry `rule_id`, so Activity can say "via Claude" — a person who
finds mail moved deserves to know who moved it.

## 8. States

| State / transition             | Tool returns                                  | Person sees                  | Test        |
| ------------------------------ | --------------------------------------------- | ---------------------------- | ----------- |
| Not signed in at authorize     | —                                             | Google sign-in, then consent | e2e         |
| Consent denied                 | `access_denied` to client                     | client's error               | unit        |
| Access token expired           | 401 + `WWW-Authenticate`                      | nothing; client refreshes    | unit        |
| Grant disconnected in Settings | 401 `invalid_token`                           | client asks to reconnect     | integration |
| Refresh token reused           | 401; family revoked                           | reconnect                    | unit        |
| Zero mailboxes / none active   | `NO_ACTIVE_MAILBOX` + Settings link           | link                         | integration |
| Mailbox needs Gmail reconnect  | `MAILBOX_RECONNECT_REQUIRED` + link           | link                         | integration |
| Sync still running             | results carry sync state and "as of" time     | counts labelled as partial   | unit        |
| Preview expired                | `PREVIEW_EXPIRED`                             | assistant re-previews        | unit        |
| Elicitation cancelled          | `NOT_APPLIED`                                 | nothing moved                | unit        |
| No elicitation support         | `needs_confirmation` + link                   | DeclutrMail preview page     | e2e         |
| Confirm page, other user       | 404                                           | not found                    | e2e         |
| Sender protected after preview | applied minus that sender, named in `skipped` | named                        | integration |
| Quota exhausted                | `QUOTA_EXHAUSTED` + reset date                | upgrade link                 | integration |
| Unsubscribe, mailto sender     | `action_required` + Gmail compose link        | sends it themself            | integration |
| Unsubscribe, no method         | `unavailable`, named                          | told why                     | integration |
| Queue down                     | `QUEUE_UNAVAILABLE`; preview stays pending    | retry later                  | integration |
| Undo after window              | `UNDO_EXPIRED`                                | told so                      | unit        |
| Account deletion started       | 401 on every token                            | —                            | integration |

## 9. Test plan

- **Negative controls** (CLAUDE.md §8): revert each guard — preview
  required, confirmation required, Protected re-check, refresh-reuse
  revocation — and watch its test go red.
- **Injection fixture:** a sender whose subject reads as an instruction
  to unprotect and delete. A scripted client that calls `apply_cleanup`
  on every preview it can create, and answers no elicitation. Assert
  zero mail mutations and zero Protected changes.
- **Registry contract test** (§5), starved: a tool schema with an
  unregistered field must fail by name.
- **Smoke:** MCP Inspector and `claude mcp add --transport http` against
  local dev via the dev test login (`/api/auth/dev/login`); both test mailboxes; every row of
  §8 that a local run can reach. Claude.ai custom connector against
  staging for the hosted OAuth callback.
- **Review:** independent adversarial review (`/code-review ultra` or
  equivalent) on the auth PR and the apply path before merge.

## 10. Build order

One release, three PRs, off by default behind `MCP_ENABLED` until all
three land and the review passes. The flag goes into
`deploy-cloud-run.yml` (Cloud Run env is full-replace).

1. **Auth:** migration, OAuth endpoints, consent page, Settings →
   Connected apps, `McpTokenGuard`.
2. **Connector:** `apps/api/src/mcp/`, ten tools, `action_previews`,
   elicitation, confirm page, registry change, Activity origin.
3. **Listing:** privacy page wording, a `/connect` page with the server
   URL for Claude Code / Codex / Cursor, Claude directory submission,
   ChatGPT submission (OpenAI's Apps SDK builds on MCP; check its
   current rules then), and Grok custom-connector instructions (xAI
   documents custom remote MCP connectors at
   https://docs.x.ai/grok/connectors; at build time confirm it supports
   OAuth sign-in and which Grok plans allow custom connectors). Client
   approval prompts differ — some reportedly lack per-call approval —
   which is why confirmation lives on our server, not in the client.

Public claims (Tier 1b) for the listing: "Through DeclutrMail, your
assistant sees sender names and subject lines — never full emails." True
only for our tools; the copy must not imply the assistant cannot read
mail through other connectors.

## 11. Founder decisions (settled 2026-11-17)

| #   | Decision                                      | Decided                                                                                                                                                                       |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build it, and when                            | Build now, full connector (all ten tools), behind `MCP_ENABLED` until the §9 review passes. Read-only-first rejected: every change already needs a human confirm.             |
| 2   | Authorization server: ours or a hosted vendor | Ours, inside the API, built on a maintained open-source OAuth library (chosen at build time), never written from scratch. Reuses the existing session; one identity system.   |
| 3   | Which tiers                                   | All tiers. Free's existing monthly cleanup limit applies unchanged; no separate gate.                                                                                         |
| 4   | Snippets over the connector                   | No. Subjects only; adding previews later is a new decision.                                                                                                                   |
| 5   | Unprotect over the connector                  | No. The assistant links to DeclutrMail. A confirm-on-our-page variant can be added later if people ask.                                                                       |
| 6   | Google OAuth verification impact              | Build now; the founder asks Google in parallel; the directory listing waits for the answer. See `docs/log/founder-followups/2026-11-17-mcp-connector-google-verification.md`. |
