# ADR-0002: PR-B ships an unauthenticated Gmail OAuth connect (pre-auth bootstrap)

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D4 (OAuth, CASA-approved), D14 (token encryption), D201 (API architecture), D109/D224 (onboarding + sync — the layer this defers to)

## Context

PR-B (`feat/d004-gmail-oauth-token-storage`, PR #16) implements the Gmail
OAuth connect flow + encrypted token storage — `senders-backend-plan.md`
§4. It runs ahead of the onboarding / session / auth layer, which is
D109/D224 territory (D187 PR-4).

With no auth layer, the OAuth callback has no authenticated principal to
bind a mailbox to. `mailbox_accounts.workspace_id` / `user_id` are
`NOT NULL` foreign keys, so `handleCallback` find-or-creates a workspace
and user keyed on the connected Gmail address — the "PR-B bootstrap."

Adversarial review (Codex, 4 rounds, 2026-05-22) repeatedly flags this:
the connect/callback routes are unauthenticated; anyone who completes
Google consent can mint `workspaces` / `users` / `mailbox_accounts` rows;
the reconnect upsert rotates token material without re-validating
ownership. **These findings are correct.** They are not bugs — they are
the absence of the auth layer. A code reviewer cannot clear them by
re-review; only the auth layer (D109/D224) or an explicit decision can.

The product is, at this time, **solo-developer, local-only, not deployed
to any network**. The attack surface the review assumes (an internet-
facing multi-tenant instance) does not exist.

## Decision

We **accept PR-B's unauthenticated email-bootstrap connect flow as a
deliberate, temporary pre-auth limitation.** The connect routes are off
by default — `GoogleOAuthModule` is not even loaded unless
`GMAIL_CONNECT_ENABLED=true`. The real fix — binding a mailbox connection
to an authenticated user/workspace — is deferred to D109/D224. PR-B
merges to the (non-deployed) `main` with this recorded.

**Hard rule:** the `apps/api` Gmail-connect flow MUST NOT be deployed or
exposed to a network before D109/D224 ships. Tracked in
`FOUNDER-FOLLOWUPS.md`.

## Alternatives considered

- **Build the D109/D224 auth layer now** — rejected: large (D187 PR-4
  scope), disproportionate effort purely to satisfy an adversarial
  reviewer on an app with zero deployment, and it would stall the locked
  PR-C→F senders-backend sequence.
- **Allowlist / band-aid guard on the callback** — rejected:
  configuration-as-security, not a real trust boundary; hides the gap
  instead of resolving it.
- **Remove the persist/bootstrap from PR-B** — rejected: it guts the
  feature (the end-to-end-tested connect-and-store flow _is_ PR-B's
  deliverable), PR-C needs a persisted `mailbox_account` to sync, and it
  merely relocates the identical code and the identical finding to a
  later PR.

## Consequences

### Positive

- PR-B ships — OAuth connect, D14 KMS envelope encryption, migration
  0002, the SWC runtime fix — and unblocks PR-C (initial sync).
- The limitation is an owned, documented decision, not a silent gap.
- Re-running adversarial review for this specific finding stops; it is
  closed by decision, not by code.

### Negative

- While `GMAIL_CONNECT_ENABLED=true`, the connect flow trusts anyone who
  completes Google consent. Acceptable **only** because the app is not
  deployed — hence the hard no-deploy-before-D109/D224 constraint.
- Reconnect (`onConflictDoUpdate` on `provider`+`provider_account_id`)
  rotates token material without re-validating `workspace_id`/`user_id`.
  Correct in the single-tenant bootstrap world; must change when
  D109/D224 introduces real multi-tenancy.

### Neutral

- The `GMAIL_CONNECT_ENABLED` env-gate + conditional module load remain
  until D109/D224 replaces them with a real authentication guard.

## Implementation notes

When D109/D224 lands:

- Replace `findOrCreateUser` in `apps/api/src/auth/google-oauth.service.ts`
  (commented `// PR-B bootstrap`) with a lookup of the authenticated
  principal.
- Add an authentication guard to the connect routes; retire the
  `GMAIL_CONNECT_ENABLED` gate in `app.module.ts`.
- Make reconnect verify `mailbox_accounts` ownership against the
  authenticated actor before the upsert.

## References

- `docs/execution/senders-backend-plan.md` §4 (PR-B spec)
- PR #16 (`feat/d004-gmail-oauth-token-storage`)
- Codex adversarial reviews — 4 rounds, 2026-05-22
