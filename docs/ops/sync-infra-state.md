# Sync Infrastructure — As-Built Record

> **What this is.** The current state of every external resource the Gmail
> sync depends on — what exists, its concrete identifiers, and where each
> value is configured. A reference so the founder never has to re-discover
> "where is X" or "what did I name Y".
>
> **What this is NOT.** Not a runbook. Setup _instructions_ live in
> `sync-infra-setup.md` (step-by-step, frozen the day it was written).
> This file is the _state_ — update it whenever infra changes.
>
> **No secret values here.** This file records identifiers (project IDs,
> service-account emails, resource paths, hostnames) — those are
> infrastructure addresses, public by design. Actual credentials (OAuth
> client secret, Redis password, JWT secrets, encryption key) live in
> `.env.local` + 1Password; this file only says _where_ they are.
>
> **Last updated:** 2026-05-22 · provisioned for PR-B/C/D.

---

## At a glance

| Resource                    | Status         | Provider          |
| --------------------------- | -------------- | ----------------- |
| GCP project                 | ✅ Provisioned | Google Cloud      |
| OAuth Web client            | ✅ Provisioned | Google Cloud      |
| Cloud KMS key (token KEK)    | ✅ Provisioned | Google Cloud      |
| API runtime service account | ✅ Created      | Google Cloud      |
| Upstash Redis (BullMQ)       | ✅ Provisioned | Upstash           |
| Pub/Sub topic                | ✅ Provisioned | Google Cloud      |
| Pub/Sub OIDC service account | ✅ Created      | Google Cloud      |
| Pub/Sub push subscription    | ⏳ Deferred     | — needs Cloud Run |
| Cloud Run deploy             | ⏳ Deferred     | — `apps/api` unbuilt |

---

## 1 — Google Cloud project

| Field            | Value                                          |
| ---------------- | ---------------------------------------------- |
| **Project ID**   | `declutrmail-ai-prod`                          |
| **Organization** | `declutrmail.ai` (org ID `630332136083`)       |
| **Region**       | `us-central1` (KMS + future Cloud Run)         |
| **APIs enabled** | Gmail API · Cloud KMS API · Cloud Pub/Sub API  |
| **Reused from**  | V1 — keeps the CASA Tier 2 approval (D4)        |

`GOOGLE_CLOUD_PROJECT_ID` = `declutrmail-ai-prod`.

---

## 2 — OAuth Web client (D4)

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| **Type**               | Web application                                             |
| **Client ID**          | `387835380133-34lfqvcgmk5d017dd264tkjmme8as8ml.apps.googleusercontent.com` |
| **Client secret**      | _credential_ — `.env.local` `GOOGLE_CLIENT_SECRET` + 1Password |
| **Scope**              | `https://www.googleapis.com/auth/gmail.modify` (single scope) |
| **Consent screen**     | In production                                               |
| **Redirect URIs**      | `http://localhost:4000/api/auth/google/callback` (local only)|

- Only `gmail.modify` is granted. `gmail.metadata` is **not** added — it
  would block the `q` search the sync uses. No-body-storage (D7) is a code
  rule (`format=metadata` calls), not a scope ceiling.
- Staging/prod redirect URIs are **not yet added** — done at Cloud Run
  deploy time (see §8).

---

## 3 — Cloud KMS — OAuth-token encryption key (D14)

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| **Key ring**           | `declutrmail`                                               |
| **Key**                | `oauth-token-kek`                                           |
| **Location**           | `us-central1`                                               |
| **Purpose**            | Symmetric encrypt/decrypt                                   |
| **Protection level**   | Software                                                    |
| **Rotation**           | 90 days (D14 — quarterly)                                   |
| **Resource name**      | `projects/declutrmail-ai-prod/locations/us-central1/keyRings/declutrmail/cryptoKeys/oauth-token-kek` |
| **Key access**         | `declutrmail-api` SA → `roles/cloudkms.cryptoKeyEncrypterDecrypter`, scoped to this key |

- The resource name above is `KMS_KEY_RESOURCE`. It ends at
  `cryptoKeys/oauth-token-kek` — not a `cryptoKeyVersions/N`.
- **Local dev does not use KMS.** `KMS_KEY_RESOURCE` is left blank in
  `.env.local`; the app falls back to `ENCRYPTION_LOCAL_KEY` when it is empty.

---

## 4 — Service accounts

| SA                  | Email                                                       | Role / purpose |
| ------------------- | ----------------------------------------------------------- | -------------- |
| **API runtime**     | `declutrmail-api@declutrmail-ai-prod.iam.gserviceaccount.com` | Identity the `apps/api` Cloud Run service runs as. Has `cryptoKeyEncrypterDecrypter` on `oauth-token-kek` (§3). No keys, no project roles. |
| **Pub/Sub OIDC**    | `gmail-webhook-oidc@declutrmail-ai-prod.iam.gserviceaccount.com` | Identity Pub/Sub signs push-webhook OIDC tokens as (D229). No keys, no roles. |
| **Gmail publisher** | `gmail-api-push@system.gserviceaccount.com`                 | Google's fixed system account. Granted `Pub/Sub Publisher` on the `gmail-push` topic (§6). |

`declutrmail-api` exists but is **unused** until `apps/api` deploys to
Cloud Run and the service's runtime SA is set to it (§8).

---

## 5 — Upstash Redis (BullMQ backend, D157)

| Field            | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| **Host**         | `coherent-jaybird-134126.upstash.io`                        |
| **Port**         | `6379` (TLS — `rediss://` scheme)                           |
| **Eviction**     | `noeviction` (BullMQ requirement)                           |
| **Plan**         | Free (256 MB data, 10 GB/mo bandwidth)                      |
| **Account**      | GitHub SSO — no separate Upstash password (see `services.md`)|
| **Password**     | _credential_ — `.env.local` `REDIS_URL` + 1Password         |

`REDIS_URL` = `rediss://default:<password>@coherent-jaybird-134126.upstash.io:6379`.

---

## 6 — Pub/Sub (incremental sync, D229)

| Field                | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| **Topic ID**         | `gmail-push`                                                |
| **Topic resource**   | `projects/declutrmail-ai-prod/topics/gmail-push`            |
| **Publisher binding**| `gmail-api-push@system.gserviceaccount.com` → `Pub/Sub Publisher` on the topic |
| **Push subscription**| ⏳ **Not yet created** — needs the deployed API URL (§8)     |

`GMAIL_PUBSUB_TOPIC` = `projects/declutrmail-ai-prod/topics/gmail-push`.

---

## 7 — Org-policy change made

Granting the Gmail system account publish access hit the
`iam.allowedPolicyMemberDomains` org policy (Domain Restricted Sharing,
enforced by default on new orgs).

| Change                  | Detail                                                      |
| ----------------------- | ----------------------------------------------------------- |
| **Org-policy override** | Constraint `iam.allowedPolicyMemberDomains` overridden to **Allow All** — scoped to project `declutrmail-ai-prod` only. |
| **Role grant**          | `roles/orgpolicy.policyAdmin` (Organization Policy Administrator) granted to `admin@declutrmail.ai` — required to edit the policy; Organization Administrator does **not** include it. |

The override only matters for new IAM writes; the existing Gmail binding
survives if the policy is later re-tightened.

---

## 8 — Deferred to Cloud Run deploy

`apps/api` is not built or deployed yet. These items wait for the first
Cloud Run deploy and the API URL it produces:

| Item                              | Blocked on             |
| --------------------------------- | ---------------------- |
| Staging/prod Authorized redirect URIs | Cloud Run API URL  |
| Pub/Sub push subscription `gmail-push-sub` + endpoint + OIDC audience | Cloud Run API URL |
| Cloud Run service runtime SA → `declutrmail-api` | Cloud Run service exists |
| `[gh]` / `[gcp]` secret population | CI + Cloud Run need them |

`PUBSUB_OIDC_AUDIENCE` stays blank until the push subscription is created.

---

## 9 — Env var state (`.env.local`)

Where each value is configured and its current fill state. Placement tags
(`[local]` / `[gh]` / `[gcp]`) carry their meaning from `sync-infra-setup.md` §6.

| Env var                       | Placement   | `.env.local` state          | Secret? |
| ----------------------------- | ----------- | --------------------------- | :-----: |
| `ANTHROPIC_API_KEY`           | local, gh   | ✅ filled                   |   yes   |
| `DATABASE_URL`                | local       | ✅ local Postgres            |   yes   |
| `GOOGLE_CLOUD_PROJECT_ID`     | local, gh   | ✅ `declutrmail-ai-prod`     |   no    |
| `GOOGLE_CLIENT_ID`            | local, gh   | ✅ filled                   |   no    |
| `GOOGLE_CLIENT_SECRET`        | local, gh, gcp | ✅ filled                |   yes   |
| `GOOGLE_REDIRECT_URI`         | local, gh   | ✅ localhost:4000 callback   |   no    |
| `KMS_KEY_RESOURCE`            | gh, gcp     | ⬜ blank (KMS off locally)   |   no    |
| `ENCRYPTION_LOCAL_KEY`        | local       | ✅ filled (local fallback)   |   yes   |
| `JWT_ACCESS_SECRET`           | local       | ✅ filled                   |   yes   |
| `JWT_REFRESH_SECRET`          | local       | ✅ filled                   |   yes   |
| `REDIS_URL`                   | local, gh, gcp | ✅ Upstash `rediss://`    |   yes   |
| `GMAIL_PUBSUB_TOPIC`          | local, gh   | ✅ `.../topics/gmail-push`   |   no    |
| `PUBSUB_OIDC_AUDIENCE`        | local, gh   | ⬜ blank (set at deploy)     |   no    |
| `PUBSUB_OIDC_SERVICE_ACCOUNT` | local, gh   | ✅ `gmail-webhook-oidc@...`  |   no    |
| `NEXT_PUBLIC_APP_URL`         | local       | ✅ localhost:3000            |   no    |
| `NEXT_PUBLIC_API_URL`         | local       | ✅ localhost:4000            |   no    |

- `.env.local` is gitignored — never committed. Secret _values_ are not
  recorded in this file or any committed file.
- `[gh]` (GitHub Actions secrets) and `[gcp]` (GCP Secret Manager) are
  **not populated yet** — deferred until PR-B CI and Cloud Run deploy.

---

## Keeping this current

Update this file whenever a sync-infra resource is created, renamed, or
its config changes — same PR as the change. Cross-references:

- **How to provision** → `sync-infra-setup.md`
- **Service tiers / cost / account ownership** → `services.md`
- **Founder action items** → `FOUNDER-FOLLOWUPS.md`
