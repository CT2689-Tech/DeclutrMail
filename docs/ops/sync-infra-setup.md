# Sync Infrastructure Setup — Founder Runbook

> **Who:** the founder (needs Google Cloud + Upstash console access).
> **Why:** PR-B (OAuth), PR-C (initial sync), PR-D (incremental webhook)
> need external infrastructure the codebase cannot create. Code is built
> against `.env.example` placeholders; these steps produce the real values.
> **Time:** ~30–45 min. **Order:** Step 1 first (everything depends on the
> GCP project); Steps 2–4 can be done in any order after.

When done, you will have collected the values in the **Secrets checklist**
at the bottom. Put them where §5 says — never commit them.

---

## Step 1 — GCP project + OAuth client (D4)

DeclutrMail V1 already has a Google Cloud project with `gmail.modify` +
`gmail.metadata` scopes and CASA Tier 2 approval. V2 reuses it — a _new_
project would lose that approval.

1. Open <https://console.cloud.google.com> → top project picker → select
   the **V1 DeclutrMail project**. Copy its **Project ID** (not the
   display name) → this is `GOOGLE_CLOUD_PROJECT_ID`.
2. **APIs & Services → Library** → search "Gmail API" → confirm it shows
   **Enabled** (enable it if not).
3. **APIs & Services → OAuth consent screen** → confirm:
   - Publishing status is **In production** (not "Testing").
   - Scopes list includes `.../auth/gmail.modify` and
     `.../auth/gmail.metadata`.
4. **APIs & Services → Credentials** → under "OAuth 2.0 Client IDs" open
   the existing **Web application** client (or create one: _Create
   credentials → OAuth client ID → Web application_, name
   `declutrmail-v2-web`).
5. In that client, add **Authorized redirect URIs**:
   - `http://localhost:3001/api/auth/google/callback` (local dev)
   - `https://<your-staging-api-domain>/api/auth/google/callback`
   - `https://<your-prod-api-domain>/api/auth/google/callback`
     Save.
6. Copy the **Client ID** → `GOOGLE_OAUTH_CLIENT_ID` and **Client secret**
   → `GOOGLE_OAUTH_CLIENT_SECRET`.

> If V2 ends up on a _new_ GCP project, stop — re-verification + CASA
> re-assessment is needed; that is a separate decision. Reusing V1 avoids it.

---

## Step 2 — Token encryption key (AES-256-GCM)

PR-B encrypts Gmail refresh tokens with app-level AES-256-GCM (founder
decision, 2026-05-21). It needs one 256-bit key.

1. Generate the key locally:
   ```sh
   openssl rand -base64 32
   ```
2. That 44-character base64 string is `TOKEN_ENCRYPTION_KEY`.
3. Store it in **GCP Secret Manager** (Security → Secret Manager →
   Create secret, name `token-encryption-key`) **and** in GitHub Actions
   secrets (§5). Do **not** put it in any committed file.

> Rotation later: add the new key, bump `token_key_version`, keep the old
> key available to decrypt existing rows. PR-B builds the column for this.

---

## Step 3 — Upstash Redis (BullMQ queue backend)

The sync workers (PR-C/D) run on BullMQ, which needs Redis.

1. Open <https://upstash.com> → sign in → **Create Database** → **Redis**.
2. Name: `declutrmail-v2-bullmq`. Region: pick the one closest to where
   the API/workers will run (the Cloud Run region).
3. Leave **TLS** enabled (default).
4. **Eviction:** set the eviction policy to **`noeviction`**. BullMQ
   requires this — any eviction policy can silently drop queued jobs.
5. After creation, open the database → copy the **connection string**
   (the `rediss://default:<password>@<host>:<port>` URL) →
   this is `REDIS_URL`.

---

## Step 4 — Pub/Sub topic + push subscription + OIDC service account (D229)

Incremental sync (PR-D): Gmail pushes a notification to a Pub/Sub topic;
a push subscription forwards it to the webhook; the webhook verifies the
OIDC token.

In the **same GCP project** as Step 1:

1. **APIs & Services → Library** → enable **Cloud Pub/Sub API**.
2. **Pub/Sub → Topics → Create topic** → ID `gmail-push`. Leave defaults.
   Its full name is `projects/<GOOGLE_CLOUD_PROJECT_ID>/topics/gmail-push`
   → this is `GMAIL_PUBSUB_TOPIC`.
3. Grant Gmail permission to publish to it: open the `gmail-push` topic →
   **Permissions** tab → **Add principal** → principal
   `gmail-api-push@system.gserviceaccount.com` → role
   **Pub/Sub Publisher** → Save. (This is Google's fixed system account
   for Gmail push — the exact string above.)
4. Create the OIDC service account: **IAM & Admin → Service Accounts →
   Create service account** → name `gmail-webhook-oidc`. No keys, no
   roles needed. Copy its email →
   `<sa>@<project>.iam.gserviceaccount.com` = `PUBSUB_OIDC_SERVICE_ACCOUNT`.
5. Create the push subscription: **Pub/Sub → Subscriptions → Create
   subscription**:
   - ID: `gmail-push-sub`
   - Topic: `gmail-push`
   - Delivery type: **Push**
   - Endpoint URL: `https://<your-staging-api-domain>/api/webhooks/gmail`
   - **Enable authentication** → service account `gmail-webhook-oidc` →
     **Audience**: set it to the endpoint URL above (the webhook verifies
     this exact string) → record it as `PUBSUB_OIDC_AUDIENCE`.
   - Ack deadline: 60s. Leave the rest default.

> The webhook controller (PR-D) verifies the OIDC token against Google's
> JWKS, the issuer, this audience, and the service-account email — the
> full D229 8-step checklist. Never `x-goog-authenticated-user-email`.

---

## Step 5 — Where the values go

| Value                         | GitHub Actions secret | GCP Secret Manager |      Local `.env`      |
| ----------------------------- | :-------------------: | :----------------: | :--------------------: |
| `GOOGLE_CLOUD_PROJECT_ID`     |           ✓           |         —          |           ✓            |
| `GOOGLE_OAUTH_CLIENT_ID`      |           ✓           |         —          |           ✓            |
| `GOOGLE_OAUTH_CLIENT_SECRET`  |           ✓           |         ✓          |           ✓            |
| `TOKEN_ENCRYPTION_KEY`        |           ✓           |         ✓          | ✓ (dev key, different) |
| `REDIS_URL`                   |           ✓           |         ✓          |           ✓            |
| `GMAIL_PUBSUB_TOPIC`          |           ✓           |         —          |           ✓            |
| `PUBSUB_OIDC_AUDIENCE`        |           ✓           |         —          |           ✓            |
| `PUBSUB_OIDC_SERVICE_ACCOUNT` |           ✓           |         —          |           ✓            |

- GitHub Actions secrets:
  <https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions>
- GCP Secret Manager: console → Security → Secret Manager. Cloud Run reads
  these at runtime.
- Local `.env`: copy `.env.example` → `.env`. **Generate a _separate_
  `TOKEN_ENCRYPTION_KEY` for local dev** — never reuse the production key.
- `.env` is gitignored. `.env.example` carries placeholder names only,
  no real values (CLAUDE.md §10).

---

## Done — what unblocks

| Provided    | Unblocks                                             |
| ----------- | ---------------------------------------------------- |
| Steps 1 + 2 | PR-B — OAuth connect + token storage runs end-to-end |
| Step 3      | PR-C — initial sync workers run                      |
| Step 4      | PR-D — incremental webhook runs                      |

Code for PR-B can be written and unit-tested _before_ this runbook is
done (the AES crypto + the migration need no GCP). The OAuth flow itself
cannot be exercised until Steps 1–2 are complete.
