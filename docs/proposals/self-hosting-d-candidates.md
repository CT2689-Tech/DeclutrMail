# Self-Hosting — D-Decision Candidates (for founder ratification)

> **Status:** CANDIDATE. Not yet ratified. Agents do not write D-decisions into
> the locked plan (CLAUDE.md §3) — this doc proposes candidates for the founder
> to accept, amend, or reject. Once ratified, the founder transcribes the
> accepted decisions into `docs/execution/Implementation-Plan.md` with their
> final D-numbers.
>
> **Source:** feasibility analysis in
> `~/.claude/plans/system-reminder-message-sent-at-sat-functional-moore.md`
> (session 2026-06-13). Branch: `claude/self-hosting-feature-planning-hqqd3y`.
>
> **Proposed numbering:** D236–D244 (next free after the locked D1–D235). Final
> numbers are the founder's to assign.

---

## Why these are needed before any code

Self-hosting touches three CLAUDE.md §9 "stop and ask the founder" surfaces —
Gmail OAuth scopes, token encryption, and billing — and has **zero** coverage in
the locked plan. No production code should land until the decisions below are
ratified. Each candidate states the decision, the realistic options, a
recommendation, the guardrail it touches, and a verifiable success criterion (so
it doubles as a pre-written spec per CLAUDE.md §1.4).

---

## D236 — Self-hosting product posture (the anchor decision)

**Decision:** What *is* self-hosting for DeclutrMail, and how is it monetized?

**Options:**
- **A — Open-core:** source-available, free personal self-host, paid license for
  teams (Plausible/Sentry pattern). Best funnel + community; adds a license
  server + ongoing support burden.
- **B — Enterprise-only paid:** self-host sold as "bring your own infra" to
  legal/health/finance who contractually can't use a third-party cloud. Highest
  $/deal, lowest volume, gated behind the existing `Enterprise: contact sales`
  row.
- **C — Trust/moat play (recommended):** source-available, free unmonetized
  self-host. Most who *could* self-host won't, but offering it kills the "I don't
  trust your cloud" objection on the SaaS sale and seeds goodwill. Monetize only
  the managed SaaS. Cheapest to build (no license server).

**Recommendation:** **C now, with the edition seam (D237) built so A or B remain
reachable without rework.** The seam is identical work for all three; only the
license server is deferred.

**Guardrail touched:** billing/pricing model (founder-only call).
**Success criterion:** a one-paragraph public posture statement exists and the
pricing page (or docs) reflects it.

---

## D237 — `DEPLOYMENT_EDITION` seam (the core engineering decision)

**Decision:** Introduce `DEPLOYMENT_EDITION = saas | self-host`. In `self-host`,
entitlements resolve to a fixed edition and billing 503/402 paths are bypassed
and hidden; in `saas`, behavior is unchanged.

**Why:** Tiers are currently baked into the `workspaces.tier` enum and resolved
against `TIER_MANIFEST` (`packages/shared/src/entitlements/manifest.ts`,
`resolve.ts`); gates return `402`/`503` when billing isn't provisioned. There is
no seam to run the app without a billing provider. This is the one genuine
code-architecture decision.

**Recommendation:** a single env-driven edition resolved at boot, defaulting to
`saas`. Self-host edition resolves all currently-shipping capabilities as
unlocked (single-workspace). Keep the manifest the source of truth; add an
edition layer above `resolve.ts` rather than forking it.

**Guardrail touched:** billing/entitlements (founder-only call on what self-host
unlocks).
**Success criterion:** boot with `DEPLOYMENT_EDITION=self-host` → a Pro-gated
route returns unlocked (not 402) and checkout is hidden (not 503); boot with
`=saas` → original gating intact; unit tests cover both editions in `resolve.ts`.

---

## D238 — Self-host Gmail OAuth posture

**Decision:** Self-hosters bring their own Google Cloud project + OAuth consent
screen. We document the restricted-scope reality; we do **not** ship our verified
client secret.

**Why:** Google policy, not code. `gmail.readonly`/modify are restricted scopes
requiring CASA verification (~$15k–75k) or self-certification under 100 users.
Testing-mode self-hosters are capped at 100 users with refresh tokens expiring
every 7 days. OAuth config is already env-driven
(`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`).

**Recommendation:** self-host ships the **same scopes** as SaaS; a preflight
check validates OAuth env at boot; docs state the 100-user / weekly-token reality
up front. Do not imply self-host is "easy."

**Guardrail touched:** Gmail OAuth scopes (founder-only call).
**Success criterion:** OAuth completes end-to-end against a fresh test Google
project using self-host env; preflight fails loudly on a missing
`GOOGLE_REDIRECT_URI`.

---

## D239 — Self-host packaging & tenancy

**Decision:** Ship a `docker-compose.selfhost.yml` (Postgres + Redis + api +
worker + web) for **single-workspace** deploys. No k8s/Helm at launch.

**Recommendation:** reuse the existing single Docker image (already
command-switches `api`/`worker`), `scripts/db-migrate.sh`, and `.env.example`.
Migrate-on-boot. Multi-tenant-on-self-host is explicitly out of scope.

**Guardrail touched:** none directly (packaging).
**Success criterion:** `docker compose -f docker-compose.selfhost.yml up` on a
clean host → web reachable, migrations applied, worker emits a `succeeded` log.

---

## D240 — Pub/Sub optional; polling is the self-host default

**Decision:** Gmail Pub/Sub push is fully optional in self-host; the existing
5-minute drift-sweep / watch-renewal is the documented default sync transport.

**Why:** Pub/Sub OIDC push (D229) is GCP-specific and hard to stand up on
arbitrary infra. The reconciliation fallback already exists
(`PUBSUB_WEBHOOK_ENABLED` gate in `apps/api/src/app.module.ts`).

**Recommendation:** verify drift-sweep robustness with push disabled; document
the latency tradeoff (near-real-time push vs. ~5-min polling).
**Guardrail touched:** webhook auth (D229) — only in that we keep OIDC intact for
the SaaS/push path; self-host simply doesn't enable it.
**Success criterion:** with `PUBSUB_WEBHOOK_ENABLED=false`, connecting a mailbox
produces a full sync via drift-sweep with no worker/console errors.

---

## D241 — Token encryption in self-host

**Decision:** Self-host supports a local KEK (`ENCRYPTION_LOCAL_KEY`) instead of
Cloud KMS, with rotation guidance and a boot warning when the local key is in
use.

**Why:** Cloud KMS (`KMS_KEY_RESOURCE`) is GCP-specific; the local-key fallback
already exists in `apps/api/src/adapters/gcp-kms/gcp-kms.provider.ts` /
`TokenCryptoService`. The `key_version` field already tracks rotation.

**Recommendation:** keep envelope encryption (AES-256-GCM per-record DEK)
unchanged; only the KEK source differs. Warn (not fail) on local key; document
the operator's responsibility to protect it.
**Guardrail touched:** token encryption/decryption (CLAUDE.md §9 — founder-only).
**Success criterion:** boot with `ENCRYPTION_LOCAL_KEY` set → tokens
encrypt/decrypt across a worker job; boot logs a single clear warning; rotation
steps are documented.

---

## D242 — Source-available license & support boundary

**Decision:** Pick the license (e.g., a source-available license such as
BSL/Elastic-style, or a permissive one) and state the support boundary: free
self-host carries **no SLA**.

**Recommendation:** if Model C, a source-available license that permits personal/
internal use but reserves the right to monetize a hosted competitor; no support
commitment beyond docs + community. (If A/B, this is where the license server
and paid-support tiers attach.)
**Guardrail touched:** licensing (founder-only, legal).
**Success criterion:** a `LICENSE`-adjacent file + a one-line support-boundary
statement in the self-host docs.

---

## D243 — Privacy posture in self-host

**Decision:** The `Full bodies fetched: 0` claim (D228) remains a statement about
*our managed cloud*. A self-host operator's data behavior is theirs; our claim is
not transferable to forks.

**Recommendation:** marketing copy makes the distinction explicit — self-host is
sold on *control and the option to leave*, not as an extension of our auditable
privacy claim. Preserve the falsifiable-claim discipline of D228.
**Guardrail touched:** privacy/data-retention messaging (D7/D228 — founder-only).
**Success criterion:** self-host docs + marketing copy contain the distinction;
no copy implies our `0` claim covers self-hosted instances.

---

## D244 — Timing

**Decision:** Self-hosting is a **post-launch fast-follow**, additive to and
outside the locked launch sequence (D187).

**Recommendation:** it crosses three §9 guardrails and needs D236–D243 ratified
first; it must not compete with the locked V2 launch. (Founder selected "just
exploring feasibility" on 2026-06-13 — this candidate records that stance.)
**Guardrail touched:** none (sequencing).
**Success criterion:** D187 sequence unchanged; self-host work, if greenlit,
opens as its own PR track after launch.

---

## Ratification checklist (founder)

- [ ] D236 — posture/monetization model chosen
- [ ] D237 — edition seam approach approved
- [ ] D238 — OAuth posture confirmed (scopes + Testing-mode reality accepted)
- [ ] D239 — packaging/tenancy scope approved
- [ ] D240 — polling-default approved
- [ ] D241 — local-KEK approach approved
- [ ] D242 — license + support boundary chosen
- [ ] D243 — privacy messaging boundary approved
- [ ] D244 — timing confirmed
- [ ] Accepted decisions transcribed into `docs/execution/Implementation-Plan.md`
      with final D-numbers
