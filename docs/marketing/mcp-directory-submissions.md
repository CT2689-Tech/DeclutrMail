# MCP connector — directory submission drafts

Ready-to-paste listing copy for the two assistant directories, plus a checklist of each
directory's requirements against what DeclutrMail does today. **Submitting is the founder's job.**
Nothing here has been submitted.

- **Requirements last read:** 2026-11-20, from each vendor's own pages (linked per line). The
  pages were read through an automated fetch; reopen each link before submitting and check the
  exact field names and limits by eye. Where a vendor page did not say, the line says
  `UNVERIFIED`.
- **Product facts sourced from:** `apps/api/src/mcp/mcp-tool-contract.ts` (tools, `ask` lines,
  annotations), `apps/api/src/oauth/` (auth), `docs/spec/mcp-connector.md` (behaviour, §11 founder
  decisions), `packages/shared/src/copy/privacy.ts` (trust line). If any of those change, re-derive
  this file.
- **Do not submit before:** (1) the connector is on for everyone (`MCP_ENABLED=true`,
  `docs/runbooks/mcp-connector.md` "Turn on for everyone"), and (2) Google has answered the
  verification question in
  `docs/log/founder-followups/2026-11-17-mcp-connector-google-verification.md` (spec §11 decision
  6: "the directory listing waits for the answer"). That entry is **Open** today.

---

## 1. Shared facts

| Field                     | Value                                                                                                                                        | Source                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Server URL                | `https://api.declutrmail.com/mcp`                                                                                                            | `docs/runbooks/mcp-connector.md`                                         |
| Transport                 | Streamable HTTP                                                                                                                              | spec §2                                                                  |
| Auth                      | OAuth 2.1, authorization code + PKCE (S256, required), dynamic client registration (RFC 7591), public clients only                           | `apps/api/src/oauth/oauth-provider.service.ts`, `oauth-client-policy.ts` |
| Redirect URIs accepted    | any `https` URI, or `http` on `localhost` / `127.0.0.1` / `[::1]` (any port)                                                                 | `oauth-client-policy.ts`                                                 |
| Refresh tokens            | issued to clients registered for `refresh_token`; rotated on every use                                                                       | `oauth-provider.service.ts` (`issueRefreshToken`, `rotateRefreshToken`)  |
| Unauthenticated `/mcp`    | `401` with `WWW-Authenticate` naming the protected-resource metadata                                                                         | `apps/api/src/mcp/mcp-token.guard.ts`                                    |
| Scopes a person can grant | `read` (see senders and subject lines) and `cleanup` (Keep, Archive, Unsubscribe, Later, Delete with confirmation; Protect and Undo without) | `apps/web/src/features/connected-apps/scope-copy.ts`                     |
| Plans                     | every DeclutrMail plan; Free's monthly cleanup limit applies unchanged                                                                       | spec §11 decision 3                                                      |
| Privacy policy            | https://declutrmail.com/privacy                                                                                                              | route exists                                                             |
| Terms                     | https://declutrmail.com/terms                                                                                                                | route exists                                                             |
| Docs / setup page         | https://declutrmail.com/connect                                                                                                              | this PR                                                                  |
| Website                   | https://declutrmail.com                                                                                                                      |                                                                          |
| Support contact           | support@declutrmail.com                                                                                                                      | `/contact`, `llms.txt`                                                   |
| Security contact          | the address published on https://declutrmail.com/security#report                                                                             | `security/page.tsx`                                                      |
| Disconnect                | Settings → Connected apps → Disconnect                                                                                                       | `connected-apps-section.tsx`                                             |

**Claims you may make** (each sourced above): the five verbs; every change waits for the person to
confirm a preview on DeclutrMail; Protected senders are skipped; Undo puts back an Archive, Later
or Delete; a sent unsubscribe request cannot be taken back; "Through DeclutrMail, your assistant
sees sender names and subject lines — never full emails." (true of our tools only — never imply
the assistant cannot read mail through other connectors); the trust line verbatim, "We never fetch
or store full email contents."

**Do not claim:** "metadata only", "never reads your email", any counter ("0 bodies read"), any
user count or rating, "Google-verified", or anything about how another product handles mail.

### Tools (all ten)

Every tool sets all four annotations explicitly (`openWorldHint: false` on every tool).

| Tool                  | Title                           | What it does (`ask` line)                                                                                                                                                                  | Scope   | readOnly | destructive |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------- | ----------- |
| `list_mailboxes`      | List Gmail accounts             | See which Gmail accounts are connected and which one is active.                                                                                                                            | read    | true     | false       |
| `list_senders`        | List senders                    | List who sends you email, biggest first, with read rates and how to unsubscribe.                                                                                                           | read    | true     | false       |
| `get_sender`          | Get one sender                  | Look closer at one sender: how much is in your inbox, and their recent subject lines.                                                                                                      | read    | true     | false       |
| `get_usage`           | Get plan usage                  | Check your plan and how much of its monthly limit is used.                                                                                                                                 | read    | true     | false       |
| `preview_cleanup`     | Preview a cleanup               | Prepare Keep, Archive, Unsubscribe, Later or Delete for one sender or many. Unsubscribe can also archive or delete their existing email. Nothing changes until you confirm on DeclutrMail. | cleanup | true     | false       |
| `apply_cleanup`       | Apply a confirmed cleanup       | Find out whether you confirmed a prepared change, and what it did.                                                                                                                         | cleanup | false    | true        |
| `get_action_status`   | Get action status               | Check how far a change has got.                                                                                                                                                            | read    | true     | false       |
| `list_recent_actions` | List actions that can be undone | List recent changes that can still be undone.                                                                                                                                              | read    | true     | false       |
| `undo`                | Undo a cleanup                  | Undo an Archive, Later or Delete.                                                                                                                                                          | cleanup | false    | false       |
| `protect_sender`      | Protect a sender                | Protect a sender, so cleanups skip it.                                                                                                                                                     | cleanup | false    | false       |

### Example prompts (both directories ask for these)

1. "Who sends me the most email?"
2. "Show me newsletters I never open and prepare an Unsubscribe for the top five."
3. "What did my last cleanup do, and can I still undo it?"
4. "Protect everything from my bank's domain."
5. "Archive everything older than a year from the three biggest senders."

### Test account (founder fills in; never paste credentials into either portal)

```
Reviewer test account
- Google account: <TEST GMAIL ADDRESS — founder>
- Password: <shared out-of-band only when the reviewer asks>
- MFA / 2-step: <must be OFF for OpenAI; see 3.3>
- Sample data: <how many senders/emails the mailbox holds; seed it with newsletters + a few
  personal senders so every tool returns something>
- Steps: sign in at https://declutrmail.com/sign-in with the Google account, approve Gmail access,
  wait for the first scan, then add the connector with https://api.declutrmail.com/mcp and approve
  both scopes on DeclutrMail's consent page.
- Plan: <Free is enough; note the monthly cleanup limit>
```

---

## 2. Claude Connectors Directory (Anthropic)

**Submit at:** https://claude.ai/directory/manage → Submit new → MCP connector
([submission guide](https://claude.com/docs/connectors/building/submission)).

### 2.1 Listing copy

- **Server name** (≤100): `DeclutrMail`
- **One-liner** (≤200):
  `Clean up Gmail by sender: see who fills your inbox, then Keep, Archive, Unsubscribe, Later or Delete after you confirm a preview on DeclutrMail.`
- **Description** (≤2,000):

  > DeclutrMail groups Gmail by sender so one decision can handle years of email. Connect it and
  > ask Claude who sends you the most, which senders you never read, or what is waiting in a
  > sender's history. Claude can then prepare Keep, Archive, Unsubscribe, Later or Delete for one
  > sender or many.
  >
  > Nothing changes until you confirm. Claude prepares a change and gives you a link; you see the
  > preview — how many emails, where they go — and confirm it on DeclutrMail. Protected senders
  > are skipped. Undo puts back an Archive, Later or Delete; a sent unsubscribe request cannot be
  > taken back. Disconnect Claude any time in DeclutrMail's Settings → Connected apps.
  >
  > Through DeclutrMail, Claude sees sender names and subject lines — never full emails. It also
  > sees counts, dates and how to unsubscribe. We never fetch or store full email contents.
  >
  > Works with Gmail and Google Workspace on every DeclutrMail plan, including Free. You need a
  > DeclutrMail account with Gmail connected.

- **Categories** (1–5): pick from the portal's list — productivity / email fits. `UNVERIFIED`
  which names the portal offers.
- **Documentation URL:** https://declutrmail.com/connect
- **Privacy policy URL:** https://declutrmail.com/privacy
- **Support contact:** support@declutrmail.com
- **Icon:** the DeclutrMail logo. Size/format spec not published — `UNVERIFIED`.
- **URL slug:** `declutrmail` (permanent once published).
- **Use cases step:** prerequisite = a DeclutrMail account with Gmail connected and the first scan
  finished; the connector **reads and writes**.
- **Company:** name, website, primary contact — founder.
- **Authentication:** OAuth 2.0 with dynamic client registration. No Anthropic-held client needed.
- **Data handling:** first-party API (DeclutrMail's own). No health data, no sponsored content.
- **Screenshots:** none — required only for MCP Apps with UI; this server returns no UI
  ([submission guide](https://claude.com/docs/connectors/building/submission)).

### 2.2 Requirements checklist

| #   | Requirement                                                                                             | Status           | Evidence / gap                                                                                                                                                                                                                                                                              | Source                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| C1  | Submitter is on a paid Claude plan                                                                      | **Founder**      | Unknown which plan the founder's account is on                                                                                                                                                                                                                                              | [submission](https://claude.com/docs/connectors/building/submission), [publish](https://claude.com/docs/directory/publish) |
| C2  | Remote server on a public `https://` URL                                                                | Met              | `https://api.declutrmail.com/mcp`                                                                                                                                                                                                                                                           | [submission](https://claude.com/docs/connectors/building/submission)                                                       |
| C3  | Streamable HTTP transport                                                                               | Met              | spec §2                                                                                                                                                                                                                                                                                     | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C4  | Every tool has a `title`                                                                                | Met              | all ten in `mcp-tool-contract.ts`                                                                                                                                                                                                                                                           | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C5  | Every tool sets `readOnlyHint: true` or `destructiveHint: true`                                         | **Not met**      | `undo` and `protect_sender` are `readOnlyHint: false, destructiveHint: false`. Both change state, so either mark them `destructiveHint: true` (Claude will then prompt per call) or ask review whether non-destructive writes are accepted. Tier 1 (connector behaviour) — founder decides. | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C6  | Reads and writes are separate tools; no catch-all tool                                                  | Met              | ten single-purpose tools                                                                                                                                                                                                                                                                    | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C7  | Tool names ≤64 chars; narrow, accurate descriptions; no prompt-injection patterns                       | Met              | longest name `list_recent_actions`; descriptions never tell the model to call other tools                                                                                                                                                                                                   | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C8  | Actionable errors (no bare "Internal Server Error")                                                     | Met              | typed codes with next steps in `mcp-tool-errors.ts` (`QUOTA_EXHAUSTED`, `PREVIEW_EXPIRED`, …)                                                                                                                                                                                               | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C9  | No collection of conversation data; no reading Claude's memory or files                                 | Met              | tools take only their own parameters                                                                                                                                                                                                                                                        | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C10 | First-party API; server domain matches the service                                                      | Met              | `api.declutrmail.com`                                                                                                                                                                                                                                                                       | [review criteria](https://claude.com/docs/connectors/building/review-criteria)                                             |
| C11 | OAuth 2.0 with DCR or CIMD                                                                              | Met (DCR)        | CIMD not supported; Anthropic recommends CIMD over DCR for high traffic only                                                                                                                                                                                                                | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C12 | Accept redirect `https://claude.ai/api/mcp/auth_callback`                                               | Met              | any `https` redirect is accepted at registration                                                                                                                                                                                                                                            | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C13 | Claude Code: loopback redirect on any port (`localhost` and `127.0.0.1`)                                | Met              | `oauth-client-policy.ts` marks loopback clients native; port ignored                                                                                                                                                                                                                        | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C14 | PKCE S256; metadata advertises `code_challenge_methods_supported: ["S256"]`                             | Met (verify)     | PKCE required in config; confirm the advertised field with `curl https://api.declutrmail.com/.well-known/oauth-authorization-server` once on                                                                                                                                                | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C15 | `401` + `WWW-Authenticate: Bearer resource_metadata=…`; `resource` equals the server URL                | Met              | `mcp-token.guard.ts`; resource indicators enforced                                                                                                                                                                                                                                          | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C16 | Token endpoint accepts form-urlencoded; rotating refresh tokens; `invalid_grant` on a bad refresh       | Met              | `oidc-provider`, `rotateRefreshToken: true`                                                                                                                                                                                                                                                 | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C17 | Discovery/registration/token answer within 10 s (refresh 30 s)                                          | Met (unmeasured) | not load-tested; verify in the founder's smoke                                                                                                                                                                                                                                              | [authentication](https://claude.com/docs/connectors/building/authentication)                                               |
| C18 | Privacy policy link that covers the connector                                                           | **In progress**  | a parallel session is updating `/privacy` for the connector; submit after it merges                                                                                                                                                                                                         | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C19 | Standard test account with sample data + at least three working example prompts                         | **Not met**      | prompts drafted in §1; the test Gmail account does not exist yet                                                                                                                                                                                                                            | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C20 | You ran every tool yourself (MCP Inspector or a custom connector)                                       | **Founder**      | the founder's beta run covers this once all ten are exercised; tick only then                                                                                                                                                                                                               | [submission](https://claude.com/docs/connectors/building/submission)                                                       |
| C21 | Verified support and security contacts                                                                  | Met              | support@declutrmail.com; security contact on `/security#report`                                                                                                                                                                                                                             | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C22 | Seven compliance acknowledgments (incl. financial transactions, prompt injection, public documentation) | Met (to tick)    | no money movement; subjects returned as structured fields, never as instructions (spec §5); public docs at `/connect`                                                                                                                                                                       | [submission](https://claude.com/docs/connectors/building/submission)                                                       |
| C23 | Collect only necessary data; respect third-party privacy                                                | Met              | subjects only, no snippets (spec §11 decision 4); bodies never fetched                                                                                                                                                                                                                      | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C24 | Notify Anthropic of material changes                                                                    | Ongoing          | adding a tool or scope is a material change                                                                                                                                                                                                                                                 | [policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)                              |
| C25 | Google's answer on OAuth verification (our own gate)                                                    | **Not met**      | founder follow-up is Open                                                                                                                                                                                                                                                                   | spec §11 decision 6                                                                                                        |

Review: every submission is scanned and listed as a Community connector by default; some are
escalated to Verified review, where a reviewer emails for test access. No published timeline.
Escalations: mcp-review@anthropic.com
([submission guide](https://claude.com/docs/connectors/building/submission)).

---

## 3. ChatGPT app directory (OpenAI)

**Submit at:** https://platform.openai.com/plugins → "Upload new or existing plugin"
([submission](https://developers.openai.com/apps-sdk/deploy/submission)). Submissions are now
called plugins and are uploaded as a ZIP with `plugin.json` and `mcp.json` (no secrets;
`clientSecret` is rejected). A plain MCP server with no UI is accepted
([MCP server](https://developers.openai.com/plugins/build/mcp-server)).

### 3.1 Listing copy

- **displayName** (≤30): `DeclutrMail`
- **shortDescription** (≤30): `Clean up Gmail by sender` (24)
- **developerName** (≤80): the verified organization name — founder.
- **category:** pick from the dashboard list (productivity) — `UNVERIFIED` which names exist.
- **longDescription** (≤4,000; no pricing, promotions or comparisons):

  > DeclutrMail groups Gmail by sender so one decision can handle years of email. Ask ChatGPT who
  > sends you the most, which senders you never read, or what a sender has sent lately. ChatGPT
  > can then prepare Keep, Archive, Unsubscribe, Later or Delete for one sender or many.
  >
  > Nothing changes until you confirm. ChatGPT prepares a change and gives you a link; you see the
  > preview and confirm it on DeclutrMail. Protected senders are skipped. Undo puts back an
  > Archive, Later or Delete; a sent unsubscribe request cannot be taken back. Disconnect ChatGPT
  > any time in DeclutrMail's Settings → Connected apps.
  >
  > Through DeclutrMail, ChatGPT sees sender names and subject lines — never full emails. It also
  > sees counts, dates and how to unsubscribe. We never fetch or store full email contents.
  >
  > Works with Gmail and Google Workspace. You need a DeclutrMail account with Gmail connected.

- **defaultPrompt** (≤3, ≤128 each): prompts 1–3 from §1.
- **websiteURL:** https://declutrmail.com · **supportURL:** https://declutrmail.com/contact ·
  **privacyPolicyURL:** https://declutrmail.com/privacy · **termsOfServiceURL:**
  https://declutrmail.com/terms
- **Icons:** logo + composer icon; PNG/JPEG/WebP/SVG, square, ≥48×48, ≤5 MiB.
- **Screenshots:** no requirement found — `UNVERIFIED`. A **demo recording URL is required**
  (see O9).

### 3.2 Test cases (exactly 5 positive, 3 negative)

Positive (`tools_triggered` → `expected_behavior`):

1. "Who sends me the most email?" → `list_senders` → a ranked list of senders with counts.
2. "Tell me about emails from <sender>." → `get_sender` → inbox counts by age and five recent
   subjects with dates.
3. "Archive everything from <sender>." → `preview_cleanup` → a preview with the count and a
   confirm link; nothing has moved.
4. "Did that go through?" (after confirming) → `apply_cleanup`, `get_action_status` → the result:
   emails changed, undo available.
5. "Undo that." → `list_recent_actions`, `undo` → the email is back; the result says so.

Negative (should NOT change mail, or should not trigger):

1. "Delete everything from <sender>" with no confirmation on DeclutrMail → `apply_cleanup` returns
   `needs_confirmation` and the link; nothing is deleted.
2. "Read me the full text of my latest email from <sender>." → no tool returns bodies; the
   assistant says DeclutrMail only has subjects.
3. "Unprotect <sender>." → no tool does this; the assistant points to DeclutrMail.

### 3.3 Requirements checklist

| #   | Requirement                                                                                                                                         | Status          | Evidence / gap                                                                                                                                                                                                   | Source                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | Individual or business verification of the OpenAI organization; submitter is owner or has Apps Management Write                                     | **Founder**     | not done as far as the repo knows                                                                                                                                                                                | [submission](https://developers.openai.com/apps-sdk/deploy/submission)                                                                                 |
| O2  | Domain verification: token served as plain text at `/.well-known/openai-apps-challenge`                                                             | **Not met**     | no such route on `api.declutrmail.com`; needs a small API change once OpenAI issues the token                                                                                                                    | [submission](https://developers.openai.com/apps-sdk/deploy/submission)                                                                                 |
| O3  | Streamable HTTP MCP server; UI optional                                                                                                             | Met             | spec §2                                                                                                                                                                                                          | [MCP server](https://developers.openai.com/plugins/build/mcp-server)                                                                                   |
| O4  | OAuth 2.1 for private data; S256 PKCE; DCR or CIMD; no client_credentials                                                                           | Met (DCR)       | `oauth-provider.service.ts`                                                                                                                                                                                      | [auth](https://developers.openai.com/plugins/build/auth)                                                                                               |
| O5  | Redirect URI: `https://chatgpt.com/connector_platform_oauth_redirect` with RFC 9207 `iss`, else `https://chatgpt.com/connector/oauth/{callback_id}` | Met (fallback)  | any `https` redirect registers; RFC 9207 `iss` in the authorization response is not enabled, so ChatGPT uses the per-connector callback                                                                          | [auth](https://developers.openai.com/plugins/build/auth)                                                                                               |
| O6  | `resource` in token audience; validate `iss`, `exp`, `aud` per request                                                                              | Met             | resource indicators enforced; opaque tokens checked server-side in `mcp-token.guard.ts`                                                                                                                          | [auth](https://developers.openai.com/plugins/build/auth)                                                                                               |
| O7  | `readOnlyHint`, `destructiveHint`, `openWorldHint` explicit on every tool; previews read-only; deletes destructive                                  | Met             | table in §1. Note OpenAI: "undo alone does not justify `destructiveHint: false`" — `apply_cleanup` is already `true`; `undo` restores mail rather than removing it                                               | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O8  | Five positive + three negative test cases                                                                                                           | Drafted         | §3.2                                                                                                                                                                                                             | [submission](https://developers.openai.com/apps-sdk/deploy/submission)                                                                                 |
| O9  | `demo_recording_url`: reviewer-accessible video                                                                                                     | **Not met**     | record a full run (connect → list → preview → confirm on DeclutrMail → undo) with the test account                                                                                                               | [submission](https://developers.openai.com/apps-sdk/deploy/submission)                                                                                 |
| O10 | Test account with sample data, login URL and steps; **no MFA, codes or magic links**                                                                | **Not met**     | sign-in is Google OAuth into a Gmail account: the reviewer must get through Google's sign-in, which may challenge an unfamiliar device. Needs a dedicated test Google account with 2-step off — founder decision | [submission](https://developers.openai.com/apps-sdk/deploy/submission), [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) |
| O11 | website, support, privacy policy and terms URLs, all HTTPS                                                                                          | Met             | §3.1 (privacy page update in flight — see C18)                                                                                                                                                                   | [submission](https://developers.openai.com/apps-sdk/deploy/submission)                                                                                 |
| O12 | Privacy policy covers data categories, purposes, recipients, retention, user controls                                                               | **In progress** | same as C18                                                                                                                                                                                                      | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O13 | No selling subscriptions, upsells, or links to checkout/upgrade pages; an informational plan page is allowed                                        | **Not met**     | `QUOTA_EXHAUSTED` and `UPGRADE_REQUIRED` return `upgrade_url` = `/billing` (`mcp-tool-errors.ts`). Point it at `/pricing`, or omit it for ChatGPT                                                                | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O14 | Not primarily an "unofficial connector to a third-party service"                                                                                    | **Risk**        | DeclutrMail is its own product over the user's own Google OAuth grant, but reviewers may read it as a Gmail connector. Lead the description with DeclutrMail's sender view, as drafted                           | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O15 | Not a trial or demo app; works on desktop and mobile                                                                                                | Met (verify)    | full product; confirm pages (`/confirm/*`) render on mobile in the founder's smoke                                                                                                                               | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O16 | Name not generic, no "MCP"/"Plugin" suffix; no comparisons, pricing or promotions in descriptions                                                   | Met             | §3.1                                                                                                                                                                                                             | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O17 | Minimum data; no reconstructing chat history; no PCI/PHI/government IDs/passwords                                                                   | Met             | spec §5, §11 decision 4                                                                                                                                                                                          | [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)                                                                         |
| O18 | Google's answer on OAuth verification (our own gate)                                                                                                | **Not met**     | same as C25                                                                                                                                                                                                      | spec §11 decision 6                                                                                                                                    |

Review: one active review per plugin; feedback by email, appeal by replying; tools are rescanned
daily and new tools are held until approved. No published timeline
([submission](https://developers.openai.com/apps-sdk/deploy/submission)).

Plan note for the `/connect` page and support replies: OpenAI's help center lists full MCP
(write tools) for Business, Enterprise and Edu, and read/fetch only on Pro
([help center](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)).
A directory listing may change which plans can use it — re-check after approval.

---

## 4. Not submitted, and why

- **Grok:** xAI documents custom connectors at https://docs.x.ai/grok/connectors, but the pages do
  not say whether a custom connector can complete an OAuth sign-in, or which plans allow one. Left
  off `/connect` until that is documented.
