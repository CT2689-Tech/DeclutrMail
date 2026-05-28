# D155 session auth — smoke runbook

Verify the auth + account-switcher + sign-out flow end-to-end.

## Prerequisites

```bash
# .env.local must carry:
# - DATABASE_URL                 (local Postgres)
# - REDIS_URL                    (docker compose up -d redis)
# - GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI
# - JWT_ACCESS_SECRET            (32+ bytes; openssl rand -base64 48)
# - JWT_REFRESH_SECRET           (32+ bytes; MUST differ from access)
# - ENCRYPTION_LOCAL_KEY         (or KMS_KEY_RESOURCE)
# - WEB_URL=http://localhost:3000

./scripts/db-migrate.sh           # apply 0014_active_sessions
./scripts/dev-up.sh               # redis + api(:4000) + worker
pnpm --filter @declutrmail/web dev   # web(:3000), foreground
```

## Flow

1. **Cold start.** Open `http://localhost:3000/triage`. Expect:
   - 401 from `GET /api/auth/me`
   - browser redirected to `http://localhost:4000/api/auth/google/start`
   - Google consent screen renders

2. **Connect first Gmail account.** Approve the scopes. Expect:
   - Google → `GET /api/auth/google/callback`
   - response sets three cookies: `dm_access` (HttpOnly), `dm_refresh` (HttpOnly), `dm_csrf` (NOT HttpOnly)
   - 302 → `/onboarding` (first-time) or `/triage` (returning)

3. **`me` returns the session.**
   - `GET /api/auth/me` returns `{ user, mailboxes: [...], activeMailboxId }`
   - account menu in topbar shows the connected email

4. **Triage data loads.**
   - `GET /api/triage/queue` returns the active mailbox's decisions
   - `GET /api/triage/stats` returns the daily counters

5. **Switch active mailbox.** Click "Connect another Gmail account".
   - new OAuth start → consent → callback
   - now 2 mailboxes in the dropdown; second one not active yet
   - click the second mailbox → `PATCH /api/mailboxes/:id/active`
   - account menu's chip flips, screen refetches with new mailbox's data

6. **Disconnect.** Open menu → "Disconnect" on first mailbox → confirm.
   - `DELETE /api/mailboxes/:id` runs Google revoke + nullifies row
   - menu now shows it as "disconnected"
   - if it was active, the BE falls back to the second mailbox automatically

7. **Sign out.** Account menu → "Sign out".
   - `POST /api/auth/logout` revokes the session row, clears cookies
   - browser bounces to `/` → AuthProvider triggers redirect to OAuth start

8. **Sign back in with a different account.** Complete OAuth with the other Google account. Expect the previously-disconnected mailbox to come back as active again (re-connect = re-create with the same `(provider, providerAccountId)` row).

## DB verification

```sql
-- Sessions
SELECT id, user_id, jti, is_revoked, ip_address, user_agent
FROM active_sessions
ORDER BY created_at DESC LIMIT 5;

-- After logout, the row's is_revoked flips true:
SELECT id, is_revoked, revoked_at FROM active_sessions ORDER BY revoked_at DESC NULLS LAST LIMIT 5;

-- Mailbox accounts
SELECT id, provider_account_id, status, connected_at, encrypted_refresh_token IS NULL AS token_nuked
FROM mailbox_accounts ORDER BY connected_at DESC;
```

## Failure modes to watch

- **401 → loop.** Bad cookie domain + cross-origin (api on `:4000`, web on `:3000`) — the browser must accept third-party cookies. Chrome's "Block third-party cookies" toggle has to be off in dev. Use Firefox or Safari if Chrome blocks.
- **CSRF 403 on mutations.** `dm_csrf` not present or not echoed in `X-CSRF-Token` header. Check `document.cookie` in DevTools.
- **OAuth state mismatch.** `oauth_state` cookie scoped to `/api/auth/google` only; using a different origin for /start vs /callback drops it. Both must hit the same API origin.
- **Google revoke failure on disconnect.** Look at API logs; the local nullify proceeds regardless so the dropdown still flips to "disconnected".
