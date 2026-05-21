# External Services Setup — Founder Runbook

> **Who:** the founder (needs Google Cloud + Upstash console access).
> **Why:** PR-B (OAuth), PR-C (initial sync), PR-D (incremental webhook)
> need external infrastructure the codebase cannot create. The code is
> built against `.env.example` placeholders; these steps produce the
> real values.
> **Time:** ~45–60 min. **Order:** Step 1 first (everything else needs the
> GCP project); Steps 2–5 can be done in any order after.

This is the **single handoff file** for every external service the Gmail
sync needs. Work top to bottom; collect each value into the **Secrets
checklist** (§6). Then put each value where §6 says — the config file
is `.env.example` (copy it to `.env.local`).

Names of env vars below match `.env.example` exactly.

---

## Step 1 — GCP project + OAuth client (D4)

DeclutrMail V1 already has a Google Cloud project with `gmail.modify` +
`gmail.metadata` scopes and CASA Tier 2 approval. V2 **reuses it** — a
_new_ project would lose that approval.

1. Open <https://console.cloud.google.com> → top project picker → select
   the **V1 DeclutrMail project**. Copy its **Project ID** (not the
   display name) → `GOOGLE_CLOUD_PROJECT_ID`.
2. **APIs & Services → Library** → search "Gmail API" → confirm
   **Enabled** (enable if not).
3. **APIs & Services → OAuth consent screen** → confirm:
   - Publishing status is **In production** (not "Testing").
   - Scopes include `.../auth/gmail.modify` and `.../auth/gmail.metadata`.
4. **APIs & Services → Credentials** → open the existing **Web
   application** OAuth client (or create one: _Create credentials → OAuth
   client ID → Web application_, name `declutrmail-v2-web`).
5. In that client, add **Authorized redirect URIs** (the API serves the
   callback — it runs on port **4000** locally):
   - `http://localhost:4000/api/auth/google/callback`
   - `https://<staging-api-domain>/api/auth/google/callback`
   - `https://<prod-api-domain>/api/auth/google/callback`

   Save.

6. Copy **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** →
   `GOOGLE_CLIENT_SECRET`. The redirect URI used at runtime is
   `GOOGLE_REDIRECT_URI`.

> If V2 ends up on a _new_ GCP project, stop — re-verification + CASA
> re-assessment is needed. Reusing V1 avoids it.

---

## Step 2 — Cloud KMS key for OAuth-token encryption (D14)

D14 (locked) mandates **Google Cloud KMS envelope encryption** for Gmail
OAuth tokens — the key-encryption key (KEK) lives in KMS and never leaves
it. PR-B encrypts each token with a random per-record data key (DEK),
then has KMS wrap the DEK with the KEK.

In the **same GCP project** as Step 1:

1. **APIs & Services → Library** → enable **Cloud Key Management Service
   (KMS) API**.
2. **Security → Key Management → Create key ring**:
   - Name: `declutrmail`
   - Location: `us-central1` (match the Cloud Run region — D14 default).
3. In that key ring, **Create key**:
   - Name: `oauth-token-kek`
   - Protection level: Software
   - Purpose: **Symmetric encrypt/decrypt**
   - Rotation period: **90 days** (D14 — quarterly).
4. Grant the app's runtime service account permission to use the key.
   On the `oauth-token-kek` key → **Permissions** → add the Cloud Run
   runtime service account (the one the `apps/api` service runs as) →
   role **Cloud KMS CryptoKey Encrypter/Decrypter**
   (`roles/cloudkms.cryptoKeyEncrypterDecrypter`).
5. Record the full key resource name →
   `KMS_KEY_RESOURCE` =
   `projects/<GOOGLE_CLOUD_PROJECT_ID>/locations/us-central1/keyRings/declutrmail/cryptoKeys/oauth-token-kek`
6. **Local dev:** KMS is _not_ used locally — devs don't need KMS access.
   D14 sanctions a local-dev fallback key. Generate one:
   ```sh
   openssl rand -hex 32
   ```
   That 64-char hex string is `ENCRYPTION_LOCAL_KEY` — set it in
   `.env.local` only. The app uses KMS when `KMS_KEY_RESOURCE` is set and
   falls back to `ENCRYPTION_LOCAL_KEY` when it is not.

> Why KMS, not a plain app-held key (D14 rationale): an env-var-class key
> can't rotate without re-encrypting every row, and a leaked DB dump plus
> a leaked key = total compromise. With KMS the KEK never leaves Google;
> a DB dump alone is useless, and rotation is a KMS operation.

---

## Step 3 — Upstash Redis (BullMQ queue backend)

The sync workers (PR-C/D) run on BullMQ, which needs Redis.

1. Open <https://upstash.com> → sign in → **Create Database** → **Redis**.
2. Name: `declutrmail-v2-bullmq`. Region: closest to the Cloud Run region.
3. Leave **TLS** enabled (default).
4. **Eviction:** set the eviction policy to **`noeviction`** — BullMQ
   requires it; any eviction policy can silently drop queued jobs.
5. Open the database → copy the connection string
   (`rediss://default:<password>@<host>:<port>`) → `REDIS_URL`.

---

## Step 4 — Pub/Sub topic + push subscription + OIDC service account (D229)

Incremental sync (PR-D): Gmail pushes a notification to a Pub/Sub topic;
a push subscription forwards it to the webhook; the webhook verifies the
OIDC token.

In the **same GCP project** as Step 1:

1. **APIs & Services → Library** → enable **Cloud Pub/Sub API**.
2. **Pub/Sub → Topics → Create topic** → ID `gmail-push`. Leave defaults.
   Full name → `GMAIL_PUBSUB_TOPIC` =
   `projects/<GOOGLE_CLOUD_PROJECT_ID>/topics/gmail-push`
3. Grant Gmail permission to publish: open the `gmail-push` topic →
   **Permissions** → **Add principal** →
   `gmail-api-push@system.gserviceaccount.com` → role
   **Pub/Sub Publisher** → Save. (Google's fixed system account for Gmail
   push — the exact string above.)
4. **IAM & Admin → Service Accounts → Create service account** → name
   `gmail-webhook-oidc`. No keys, no roles. Copy its email →
   `PUBSUB_OIDC_SERVICE_ACCOUNT` =
   `gmail-webhook-oidc@<project>.iam.gserviceaccount.com`
5. **Pub/Sub → Subscriptions → Create subscription**:
   - ID: `gmail-push-sub`
   - Topic: `gmail-push`
   - Delivery type: **Push**
   - Endpoint URL: `https://<staging-api-domain>/api/webhooks/gmail`
   - **Enable authentication** → service account `gmail-webhook-oidc` →
     **Audience**: the endpoint URL above → `PUBSUB_OIDC_AUDIENCE`
   - Ack deadline: 60s. Rest default.

> The webhook controller (PR-D) verifies the OIDC token against Google's
> JWKS, the issuer, this audience, and the service-account email — the
> full D229 8-step checklist. Never `x-goog-authenticated-user-email`.

---

## Step 5 — Atlas Cloud token (optional, already tracked)

Not new — see the existing FOUNDER-FOLLOWUPS item "Configure
ATLAS_CLOUD_TOKEN." Skip unless you want to upgrade Atlas past v0.37.

---

## Step 6 — Secrets checklist: where each value goes

Legend — where each value must be set:

- **`[local]`** — `.env.local` on the dev machine only.
- **`[gh]`** — GitHub Actions secret →
  <https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions>
- **`[gcp]`** — GCP Secret Manager (Cloud Run reads it at runtime) →
  console → Security → Secret Manager.

| Env var                       | Source | local | gh  | gcp |
| ----------------------------- | ------ | :---: | :-: | :-: |
| `GOOGLE_CLOUD_PROJECT_ID`     | Step 1 |   ✓   |  ✓  |  —  |
| `GOOGLE_CLIENT_ID`            | Step 1 |   ✓   |  ✓  |  —  |
| `GOOGLE_CLIENT_SECRET`        | Step 1 |   ✓   |  ✓  |  ✓  |
| `GOOGLE_REDIRECT_URI`         | Step 1 |   ✓   |  ✓  |  —  |
| `KMS_KEY_RESOURCE`            | Step 2 |   —   |  ✓  |  ✓  |
| `ENCRYPTION_LOCAL_KEY`        | Step 2 |   ✓   |  —  |  —  |
| `REDIS_URL`                   | Step 3 |   ✓   |  ✓  |  ✓  |
| `GMAIL_PUBSUB_TOPIC`          | Step 4 |   ✓   |  ✓  |  —  |
| `PUBSUB_OIDC_AUDIENCE`        | Step 4 |   ✓   |  ✓  |  —  |
| `PUBSUB_OIDC_SERVICE_ACCOUNT` | Step 4 |   ✓   |  ✓  |  —  |

- The config file is **`.env.example`** at the repo root — copy it to
  `.env.local` and fill in. `.env.local` is gitignored; never commit it.
- `.env.example` carries placeholder names only, no real values
  (CLAUDE.md §10).
- KMS auth on Cloud Run uses the runtime service account's identity (no
  key file). Locally there is no KMS — the `ENCRYPTION_LOCAL_KEY`
  fallback is used instead, so `KMS_KEY_RESOURCE` is left blank in
  `.env.local`.

---

## Done — what each step unblocks

| Provided    | Unblocks                                             |
| ----------- | ---------------------------------------------------- |
| Steps 1 + 2 | PR-B — OAuth connect + token storage runs end-to-end |
| Step 3      | PR-C — initial sync workers run                      |
| Step 4      | PR-D — incremental webhook runs                      |

PR-B's code can be written and unit-tested _before_ this runbook is done:
the KMS-vs-local-key crypto service is verifiable with the local fallback
key, and migration 0002 needs no GCP. Only the live OAuth flow needs
Steps 1–2 complete.
