# ADR-0048: The MCP connector is a second client of the action pipeline, never a new authority

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** founder (2026-11-17), Claude
- **Related:** ADR-0020 (composite actions), ADR-0028 (Delete reach),
  `gmail-data-inventory.ts`, `pricing.config.ts`. D-decisions were
  retired on 2026-11-17, so each rule below states its own reason.

## Context

People already clean their inboxes by talking to Claude, ChatGPT and
coding agents. Two cleanup products in our category publish hosted MCP
connectors on their own sites (Clean Email at `app.clean.email/mcp`,
Leave Me Alone at `leavemealone.com/mcp`, both read 2026-11-17). Postiz
shows the distribution shape: an official listing in Claude's connector
directory with OAuth sign-in and no API key (`postiz.com/claude`, read
2026-11-17).

The raw Gmail connector an assistant would otherwise use works one
thread at a time. In this session (2026-11-17) its tools were search,
get, label, trash, spam, send and draft — no unsubscribe, no notion of a
sender, no Protected list, no undo. DeclutrMail already has all four,
precomputed per sender. An MCP server lets the assistant be the
interface while our pipeline stays the engine.

That same move hands our mutation pipeline to a caller that reads
attacker-written text. Subject lines are written by senders, and they
would sit in the context of a model holding archive and delete tools.
The web app's preview step is enforced in the client
(by the action sheet and design review); `POST /api/actions` and the
intent routes accept a mutation with no preview attached. An LLM client
would skip it. Tool annotations
(`destructiveHint`) do not close the gap: clients let a user choose
"always allow", after which no human sees the call.

Google's Workspace User Data and Developer Policy (read 2026-11-17)
names MCPs explicitly, allows transfers only for user-facing features
with the user's consent, says apps must "granularly require users to
confirm the MCP, tool, skill, or other agentic behavior invocation", and
requires protection against prompt injection.

## Decision

We will ship an MCP server inside `apps/api` that calls the existing
services directly and adds no mail behavior of its own. Every verb,
selector cap, quota, Protected rule, undo window and rate limit is the
one the web app already enforces. Six rules bind it:

1. **No mutation without a human-confirmed preview the model cannot
   forge.** `preview_cleanup` writes a durable, expiring preview row.
   `apply_cleanup(preview_id)` runs only after the person confirms that
   preview through MCP elicitation, or — when the client does not
   support elicitation — on DeclutrMail's own confirm page opened from a
   link. A tool annotation is required on every tool and is never the
   confirmation.
2. **The connector can add safety, never remove it.** It can Protect a
   sender; it cannot Unprotect one. Delete is `inbox_only` reach
   (ADR-0028); `all_mail` is not offered. Autopilot rules are not
   exposed. Reason: subject lines can instruct the model, and people
   who confirm many previews stop reading them. Protected is the one
   setting that still holds after a careless confirm. `all_mail` also
   deletes mail the person archived on purpose. Autopilot acts with no
   per-action confirmation, which the Google clause above requires.
3. **Minimum fields.** Tool results carry sender name, address and
   domain, counts, dates, Gmail tab, read rate, Protected state,
   unsubscribe method, and subject lines. Never snippets. Every field a
   tool returns maps to a dataset in `gmail-data-inventory.ts` marked
   with a new export format, `ai-assistant`. Adding a field to a tool
   result updates the registry in the same change, the rule the Gmail
   adapter already follows. Reason: the public storage list and trust
   badge are generated from that registry, so an unregistered field
   would make a published claim false.
4. **OAuth only, owned by us.** MCP clients get audience-bound bearer
   tokens through an OAuth 2.1 flow (PKCE S256 required). Tokens are
   opaque, stored hashed, and revocable per app from Settings. No API
   keys.
5. **Unsubscribe keeps its two paths.** One-click senders execute
   through the existing worker. Mailto senders return a Gmail compose
   link for the person to send; the connector never sends mail. This
   matches today's bulk path, which already skips mailto senders and
   returns their link. Reason: the mailto address is written by the
   sender, and sending mail from the person's account to it on a
   model's word is the only outward-writing action we could expose.
6. **Request path only.** Every tool call is a request, so
   `CapabilityGuard` and the cleanup quota apply unchanged. The
   connector adds no scheduled producer. Reason: a capability guard
   only runs on a request; a cron that produces data skips tier checks
   unless it filters on its own (CLAUDE.md §2.6).

## Alternatives considered

- **Build nothing; let assistants use the Gmail connector:** rejected —
  no unsubscribe, no Protected, no undo, and a large inbox costs
  hundreds of per-thread tool calls.
- **Public REST API with API keys (Postiz's older path):** rejected for
  this release — a long-lived key pasted into a tool is a credential we
  cannot scope or see, and the Claude directory expects OAuth.
- **Annotations alone as the confirmation:** rejected — "always allow"
  removes the human, which skips the preview the web app shows and
  breaks the Google confirmation clause.
- **Proxy the existing HTTP routes:** rejected — they authenticate by
  cookie plus CSRF token. Calling the services keeps one authority and
  one set of invariants.
- **Hosted authorization server (a third-party auth vendor):** rejected
  (founder, 2026-11-17). It would mean less protocol code for us, but a
  second login system to keep in sync with our Google sign-in, a new
  processor of identity data, and a new bill. We build on a maintained
  open-source OAuth library inside the API instead, never from scratch.
- **Read-only connector first:** rejected (founder, 2026-11-17). Every
  change already needs a human confirm, so holding back the cleanup tools
  gives up the product's pitch without adding much safety.

## Consequences

### Positive

- A distribution channel (directory listings) at no ad cost.
- The assistant's reasoning runs on the person's own subscription; we
  pay nothing for it.
- The server-side preview row closes a gap the web app also has:
  preview becomes enforceable at the API, not only in the client.

### Negative

- A new authentication surface (Tier 1) that needs an independent
  adversarial review before merge.
- A new place Gmail-derived data leaves our system: subject lines reach
  the person's chosen assistant. The privacy page and registry say so.
- A migration (OAuth clients, grants, tokens, previews) — production
  migration approval applies.
- Confirmation through a link is slower than a native prompt on clients
  without elicitation.

### Neutral

- Assistants will group senders themselves ("archive the newsletters").
  DeclutrMail neither predicts nor stores a category; the person
  directs and confirms each preview.

## Implementation notes

See `docs/spec/mcp-connector.md` for tools, flows, schema, states and
the test plan. Module: `apps/api/src/mcp/`. Guard: a bearer-token guard
replaces `JwtGuard` + `CsrfGuard` on `/mcp` only; the cookie routes are
unchanged.

## References

- Google Workspace User Data and Developer Policy:
  https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Claude connector submission: https://claude.com/docs/connectors/building/submission
- Postiz × Claude: https://postiz.com/claude
- Clean Email AI assistants: https://clean.email/help/tools/connect-ai-assistants
- Leave Me Alone MCP: https://leavemealone.com/mcp
