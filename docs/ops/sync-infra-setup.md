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

DeclutrMail V1 already has a Google Cloud project with the
`gmail.modify` scope and CASA Tier 2 approval. V2 **reuses it** — a
_new_ project would lose that approval.

1. Open <https://console.cloud.google.com> → top project picker → select
   the **V1 DeclutrMail project**. Copy its **Project ID** (not the
   display name) → `GOOGLE_CLOUD_PROJECT_ID`.
2. **APIs & Services → Library** → search "Gmail API" → confirm
   **Enabled** (enable if not).
3. **APIs & Services → OAuth consent screen** → confirm:
   - Publishing status is **In production** (not "Testing").
   - Scopes include `.../auth/gmail.modify`. **That single scope is all
     DeclutrMail needs** — `gmail.modify` is a superset of `gmail.metadata`
     for reads (and `gmail.metadata` would actually _block_ the `q` search
     the sync uses). Do **not** add `gmail.metadata`. The no-body-storage
     guarantee (D7) is upheld by the app only ever calling
     `messages.get?format=metadata` — a code rule the `privacy-auditor`
     gate enforces — not by the scope ceiling.
4. **APIs & Services → Credentials** → open the existing **Web
   application** OAuth client (or create one: _Create credentials → OAuth
   client ID → Web application_, name `declutrmail-v2-web`).
5. In that client, add the **Authorized redirect URI** for local dev
   (the API serves the callback; it runs on port **4000** locally):
   - `http://localhost:4000/api/auth/google/callback`

   Save. The staging/prod redirect URIs are added **later**, when
   `apps/api` is first deployed to Cloud Run and its URL exists — see §7.
   Authorized redirect URIs are editable any time; local is enough to
   build and test PR-B now.

6. Copy **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** →
   `GOOGLE_CLIENT_SECRET`. The redirect URI the API sends at runtime is
   `GOOGLE_REDIRECT_URI` — locally
   `http://localhost:4000/api/auth/google/callback` (already the value in
   `.env.example`). It must exactly match a registered URI above.

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
4. Create the API's **runtime service account** — the non-human identity
   the `apps/api` service will run as. **IAM & Admin → Service Accounts →
   Create service account**:
   - Name: `declutrmail-api`
   - No keys, no project-level roles needed here.

   Copy its email → `declutrmail-api@<project>.iam.gserviceaccount.com`.
   (This is _not_ the `gmail-webhook-oidc` SA from Step 4 — that one is
   Pub/Sub's identity; this one is the app's.)

5. Grant that SA permission to use the key. On the `oauth-token-kek` key
   → **Permissions** → **Grant access** → principal = the
   `declutrmail-api` SA email → role **Cloud KMS CryptoKey
   Encrypter/Decrypter** (`roles/cloudkms.cryptoKeyEncrypterDecrypter`)
   → Save. Scoping the role to this one key (not the whole project) is
   least-privilege — the app can encrypt/decrypt with `oauth-token-kek`
   and nothing else.
6. Record the full key resource name as `KMS_KEY_RESOURCE`. Get it from
   **Security → Key Management** → click the `declutrmail` key ring → on
   the `oauth-token-kek` row, open the **⋮ (three-dot) menu → Copy
   resource name**. The value looks like:
   `projects/<GOOGLE_CLOUD_PROJECT_ID>/locations/us-central1/keyRings/declutrmail/cryptoKeys/oauth-token-kek`
   It must end at `cryptoKeys/oauth-token-kek` — **not**
   `.../cryptoKeyVersions/1`. Envelope encryption targets the key (KMS
   uses its primary version automatically), not a single version.
7. **Local dev:** KMS is _not_ used locally — devs don't need KMS access
   or the SA. D14 sanctions a local-dev fallback key. Generate one:
   ```sh
   openssl rand -hex 32
   ```
   That 64-char hex string is `ENCRYPTION_LOCAL_KEY` — set it in
   `.env.local` only. The app uses KMS when `KMS_KEY_RESOURCE` is set and
   falls back to `ENCRYPTION_LOCAL_KEY` when it is not.

> **Deploy-time (§7):** when `apps/api` first deploys to Cloud Run, set
> the service's **runtime service account** to `declutrmail-api` (Cloud
> Run → service → Security → Service account). That is how the running
> app inherits the KMS permission granted in step 5 — Cloud Run gives the
> container that SA's identity automatically, no key file. Until then the
> SA simply exists, unused; local dev never touches it.

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

Items 1–4 above can be done now. The **push subscription** (step 5)
needs the deployed API URL — complete it when `apps/api` first deploys
to Cloud Run (§7).

5. _(after `apps/api` is deployed)_ **Pub/Sub → Subscriptions → Create
   subscription**:
   - ID: `gmail-push-sub`
   - Topic: `gmail-push`
   - Delivery type: **Push**
   - Endpoint URL: `https://<staging-api-domain>/api/webhooks/gmail`
     (the real Cloud Run URL — §7)
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

## Step 7 — Deployed API domains (staging / prod) — filled in at deploy time

`<staging-api-domain>` / `<prod-api-domain>` are the public URLs of the
`apps/api` service. The API deploys to **Google Cloud Run** (D158/D160);
`apps/api` is not built or deployed yet, so these URLs do not exist
today.

Three items are completed at deploy time:

- the staging/prod **Authorized redirect URIs** (Step 1.5)
- the Pub/Sub **push subscription endpoint** (Step 4.5)
- assigning the **`declutrmail-api` runtime service account** (Step 2.4)
  to the Cloud Run service, so the app inherits the KMS permission

The domain will be one of:

- **Cloud Run's auto-assigned URL** — `https://<service>-<hash>.<region>.run.app`
  (e.g. `https://declutrmail-api-abc123-uc.a.run.app`). Zero setup;
  fine for staging.
- **A custom subdomain** mapped to the Cloud Run service —
  `api-staging.declutrmail.com` / `api.declutrmail.com`. Needs a
  registered domain + a Cloud Run domain mapping.

Recommendation: auto-assigned Cloud Run URL for staging; pick a custom
domain for prod at launch. **Nothing here blocks PR-B local dev** —
`http://localhost:4000/api/auth/google/callback` is enough to build and
test PR-B. Add the deployed redirect URI + create the push subscription
when `apps/api` first ships to Cloud Run.

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
