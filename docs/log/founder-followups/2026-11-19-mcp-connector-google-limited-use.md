### 2026-11-19 — Settle Limited Use and the /privacy transfer sentence before the connector leaves `false`

**Source:** PR https://github.com/CT2689-Tech/DeclutrMail/pull/1209 (MCP connector), production-readiness pass.

**Why:** With the connector on, DeclutrMail sends Gmail-derived data to an
assistant the person connects themself, at that assistant's request:
sender names and addresses and per-sender counts (`list_senders`,
`get_sender`), and the subjects and dates of a sender's five most recent
emails (`get_sender`, `apps/api/src/mcp/mcp-tool-contract.ts`). Two things
follow, and both are legal calls, not code:

1. **Our own published sentence becomes false.** `/privacy` §4
   (`apps/web/src/app/(marketing)/privacy/page.tsx`, "Google API Services —
   Limited Use disclosure") says today: "We do not transfer Gmail data to
   third parties except the subprocessors needed to run the service
   (Section 8), as required by law, or as part of a merger or acquisition
   with notice to you." A person's own Claude or ChatGPT is not a
   subprocessor. Checked in the repo on 2026-11-19; no other published
   page makes a transfer claim (`llms-source.ts` only links `/privacy`).
2. **Google's policy for restricted scopes** (`gmail.modify` is one) limits
   transfers of Gmail data and its use for AI. **Not verified against the
   policy text:** developers.google.com did not resolve from the build
   container on 2026-11-19, so nothing here quotes it. A web-search
   summary that day said transfers are allowed to provide user-facing
   features with the user's consent, for security, for legal compliance,
   or in a merger, and that the data may not be used to train AI models
   beyond that user's own. Read the pages; do not rely on that summary.
   - Google API Services User Data Policy:
     https://developers.google.com/terms/api-services-user-data-policy
   - Google Workspace API user data and developer policy:
     https://developers.google.com/workspace/workspace-api-user-data-developer-policy

**How:**

1. Read both policy pages above, Limited Use section. Decide:
   a. Is "send to an assistant the person connected and approved, when it
   asks" a transfer to provide a user-facing feature with consent? The
   consent page names the app, its return address and what it may do.
   b. Are we answerable for what the assistant's provider then does with
   it (its own retention and training terms), and does the consent page
   or `/privacy` need to say so?
   c. Does the restricted-scope verification or the annual security
   assessment need to be told about the connector before it is on?
2. If (a) is yes, approve a replacement for the §4 transfer bullet. Draft:
   "We do not transfer Gmail data to third parties except the subprocessors
   needed to run the service (Section 8), an app you connect yourself in
   Settings → Connected apps (only what it asks for while connected, after
   you approve it, and you can disconnect it at any time), as required by
   law, or as part of a merger or acquisition with notice to you."
   A session ships it as a marketing-page PR with the legal-pages test
   updated.
3. If you want less to leave: dropping subject lines from `get_sender` is
   a one-tool change (the tool still says how much a sender sends and how
   old it is). Say so and a session makes it.
4. Until 1–2 are done: keep `MCP_ENABLED=false`, or `beta` with only your
   own user id (your data, your assistant) once the security review has
   passed (beta serves the same public sign-in routes as `true`).

**Verifies by:** `/privacy` §4 names connected apps (or the connector stays
off), and this entry records the decision on 1a–1c.

**Status:** Skipped — founder decision 2026-11-20: launch without asking Google; /privacy §4 updated in this PR
