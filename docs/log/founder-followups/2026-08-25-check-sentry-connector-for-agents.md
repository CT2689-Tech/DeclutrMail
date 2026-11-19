### 2026-08-25 — Reconnect the Sentry connector if agents still cannot read it

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-25.
**Why:** On 2026-08-25 the connector said the connection was invalidated, so agents could not read captured frontend errors and had to fall back to Cloud Run logs, which show status codes only. A non-interactive session cannot run the OAuth flow.
**How:**
1. Verify first: in a new agent session, ask it to run the Sentry connector's `find_organizations`.
2. If that returns the organization, mark this Done.
3. If it reports an invalidated connection, reconnect Sentry in claude.ai → Settings → Connectors and repeat step 1.
**Verifies by:** `find_organizations` returns the organization instead of the invalidated-connection error.
**Who:** Founder
**Status:** Open
