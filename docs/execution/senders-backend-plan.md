# Senders Backend — Build Plan

> **Status:** PR-A merged-pending (#13). PR-B–F specified below, not yet built.
> **Owner:** founder + AI agents. **Created:** 2026-05-21.
> **Supersedes:** the "wire Senders to a backend" line item in the
> post-#12 handoff.

This is the execution plan for replacing the Senders screen's `data.ts`
fixture with a real Gmail-backed data path. It was settled in a planning
interview; the decisions below are **locked** — do not re-litigate them,
build against them.

---

## 1. Locked decisions

Seven forks were resolved in the planning session. All locked:

| #   | Fork            | Decision                                                                         |
| --- | --------------- | -------------------------------------------------------------------------------- |
| 1   | Data layer      | Build the **real backend** — not a swappable mock seam.                          |
| 2   | Backend depth   | **Full** — schema + sync + API + frontend rewire.                                |
| 3   | Fill the tables | **Build Gmail sync now** (not a seed script).                                    |
| 4   | Sync scope      | **Full** — initial backfill **and** the incremental Pub/Sub webhook.             |
| 5   | Sync depth      | **Full mailbox, metadata-only** backfill (every message, oldest→newest).         |
| 6   | Aggregation     | **Materialized** via the `building_sender_index` sync stage (plan-locked, D224). |
| 7   | PR cadence      | **6 fine-grained PRs** (A–F), each independently reviewable.                     |

Plan-locked, confirmed not re-decided:

- OAuth scopes — `gmail.modify` + `gmail.metadata`, CASA Tier 2 already
  approved, carried from V1 (**D4**).
- `sender_key = sha256("v1|" + normalized_email)`, hex (**D12 / ADR-0011**).

---

## 2. PR sequence

| PR    | Title                                        | Status                                                               | Gates                                           | Hard blockers                                |
| ----- | -------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| **A** | messages + senders schema                    | **Open — [#13](https://github.com/CT2689-Tech/DeclutrMail/pull/13)** | privacy-auditor, schema-migration-reviewer      | —                                            |
| **B** | Gmail OAuth connect + token storage          | spec'd                                                               | architecture-guardian                           | ⚠️ token-encryption decision (§4); GCP creds |
| **C** | Initial sync — BullMQ + InitialSyncWorker    | spec'd                                                               | architecture-guardian                           | PR-A, PR-B; Upstash Redis                    |
| **D** | Incremental sync — watch() + Pub/Sub webhook | spec'd                                                               | webhook-security-auditor, architecture-guardian | PR-C; Pub/Sub topic                          |
| **E** | Senders module + aggregate API               | spec'd                                                               | architecture-guardian, privacy-auditor          | PR-A, PR-C                                   |
| **F** | Frontend data layer — kill data.ts           | spec'd                                                               | design-system-agent                             | PR-E                                         |

Then the **depth layer** (separate, post-F): Sender Detail screen (D39),
Gmail deep-links (D41/D231), undo journal wiring (D232).

> **Why B–F are specified, not yet coded.** Three of them touch CLAUDE.md
> §9 stop-conditions (OAuth scopes, token encryption, webhook auth) and
> all of them depend on infrastructure that does not exist yet (GCP OAuth
> client, Upstash Redis, a Pub/Sub topic). CLAUDE.md §10 forbids stubbing
> security verification or shipping unverifiable PRs as "done." Each PR
> below is specified to the file level so a session can execute it fast
> once its blockers clear.

---

## 3. PR-A — messages + senders schema ✅

**Shipped in [#13](https://github.com/CT2689-Tech/DeclutrMail/pull/13).**
Six tables in `packages/db/src/schema/`: `mail_messages`, `senders`,
`sender_timeseries`, `sender_policies`, `activity_log`,
`provider_sync_state`. Migration `0001`, additive + reversible. Both
gates passed (0 blocking).

D-candidate raised: `sender_timeseries.read_count` (plan draft said
`opens`; Gmail exposes no opens) — see FOUNDER-FOLLOWUPS.

---

## 4. PR-B — Gmail OAuth connect + token storage

**Goal.** A user connects a Gmail account; DeclutrMail stores the
encrypted OAuth refresh token and links it to a `mailbox_accounts` row.

**Scaffolds `apps/api`** (currently a stub `src/index.ts`). Establish the
NestJS module layout per D201 here.

**Files (new):**

- `apps/api/src/main.ts`, `app.module.ts` — NestJS bootstrap.
- `apps/api/src/auth/google-oauth.module.ts` / `.controller.ts` / `.service.ts`
  — `GET /api/auth/google/start` → consent URL; `GET /api/auth/google/callback`
  → exchange code, persist account.
- `apps/api/src/auth/token-crypto.service.ts` — refresh-token encrypt/decrypt.
- `packages/db` migration `0002` — `mailbox_accounts` gains
  `encrypted_refresh_token bytea`, `token_key_version int`, `connected_at`.

**⚠️ OPEN DECISION — token encryption (founder sign-off required, §9 stop-condition).**
Pick the encryption scheme before PR-B is built:

- **Option 1 — app-level AES-256-GCM.** 256-bit key in GCP Secret
  Manager, injected as env var; `token_key_version` supports rotation.
  Simplest; key is in app memory.
- **Option 2 — GCP Cloud KMS envelope encryption.** A per-token DEK
  encrypted by a KMS key; app never holds the master key. More robust,
  more moving parts, one more GCP API.
- Recommendation: **Option 1** for launch (rotation-ready), revisit KMS
  if a threat review calls for it. **Founder must confirm.**

**Gate:** architecture-guardian (D201 module structure).
**Stop-conditions touched:** OAuth scopes (settled by D4), token
encryption (decision above).

---

## 5. PR-C — Initial sync (BullMQ + InitialSyncWorker)

**Goal.** On connect, backfill the entire mailbox's message metadata into
`mail_messages` and materialize `senders` + `sender_timeseries`.

**Files (new):**

- `packages/workers` — `BaseDeclutrWorker` (D157/D225), BullMQ setup on
  Upstash Redis.
- `packages/workers/src/initial-sync.worker.ts` — stages, in D224 order:
  `queued → fetching_metadata → building_sender_index →
computing_recommendations → finalizing → ready`. Updates
  `provider_sync_state.current_stage` + `progress_pct` on each transition.
- `apps/api/src/gmail/gmail-client.service.ts` — `messages.list` (paged)
  - `messages.get?format=metadata`. **`format=metadata` only — never
    `full`/`raw`.** This is the D7 "bodies fetched: 0" guarantee.
- Sender-key derivation: `sha256("v1|" + lowercased+trimmed email)` (D12).
- `building_sender_index` stage: GROUP BY `mail_messages` → upsert
  `senders` (first/last seen, dominant `gmail_category`) and
  `sender_timeseries` (per-month volume + read_count).

**Decisions baked in:**

- Full-mailbox backfill (fork #5). Paginate `messages.list`; throttle per
  D5. Mailboxes run 50k–250k messages.
- `gmail_category` from Gmail's own `CATEGORY_*` labels — never predicted
  (D222).

**Gate:** architecture-guardian (worker policy — `perMailboxPolicy`, D203/D225).
**Blockers:** PR-A, PR-B, Upstash Redis instance.

---

## 6. PR-D — Incremental sync (watch + Pub/Sub webhook)

**Goal.** Keep `mail_messages` fresh after the backfill.

**Files (new):**

- `apps/api/src/webhooks/gmail-webhook.controller.ts` — `POST /api/webhooks/gmail`.
  **Full D229 8-step OIDC verification** (JWKS sig → iss → aud → email →
  exp → messageId dedup → historyId monotonic). Never
  `x-goog-authenticated-user-email`.
- `packages/workers/src/history-sync.worker.ts` — applies a Gmail
  `history.list` delta; advances `provider_sync_state.last_history_id`
  (monotonic guard).
- `packages/workers/src/watch-renewal.worker.ts` — cron; re-arms Gmail
  `watch()` before its 7-day expiry.
- `apps/api/src/gmail/gmail-watch.service.ts` — register/stop `watch()`.

**Gate:** webhook-security-auditor (D229), architecture-guardian.
**Stop-condition touched:** webhook authentication (D229) — implement the
checklist fully; `messageId` dedup + `historyId` monotonic are mandatory.
**Blockers:** PR-C; a Pub/Sub topic + push subscription + OIDC service
account.

> Note: when `apps/api` lands, confirm whether it uses `apps/api/src/` —
> the existing FOUNDER-FOLLOWUP about `subagent-gate.yml`'s `privacy`
> filter glob applies here.

---

## 7. PR-E — Senders module + aggregate API

**Goal.** Serve the Senders screen from real data.

**Files (new):** `apps/api/src/senders/senders.module.ts` / `.controller.ts`
/ `.service.ts`, read-only (D204), responses in the D202 envelope.

**Endpoints:**

- `GET /api/senders?mailbox_account_id=` — the list aggregate (per-sender:
  monthly cadence, read rate, 4-week spark, last-seen, unread count,
  category, policy flags). Server-side pagination.
- `GET /api/senders/:sender_key/detail` — the D39 Sender Detail DTO
  (header, recommendation, recent messages paginated 10/page, stats,
  charts, history 25/page).
- `GET /api/senders/:sender_key/timeseries?months=12` — chart data.

**Decision:** the list aggregate reads materialized `senders` +
`sender_timeseries` rows (no GROUP-BY-per-request) — fork #6. Recent
messages on Detail come from `mail_messages` ordered by `internal_date`.

**Gate:** architecture-guardian (D201/D202/D204), privacy-auditor (any
Gmail-data response path).
**Blockers:** PR-A, PR-C.

---

## 8. PR-F — Frontend data layer

**Goal.** Delete `apps/web/src/features/senders/data.ts`'s fixture;
the screen reads PR-E's API.

**Files:**

- `apps/web/src/features/senders/api/` — TanStack Query hooks
  (`useSenders`, `useSenderDetail`, `useSenderTimeseries`) — D200 locks
  TanStack for server state.
- Loading / skeleton / error states on the Senders screen (none today).
- Server-driven pagination (table renders all rows today; a real mailbox
  is thousands).
- Keep the pure helpers from `data.ts` (`fmtCompact`, `relTime`, verb
  maps); drop only the `SENDERS` fixture + selectors that move server-side.

**Gate:** design-system-agent (D200 state boundaries, D211/D212 edge states).
**Blockers:** PR-E.

---

## 9. Infrastructure checklist

These block PR-B onward. Tracked as Open items in `FOUNDER-FOLLOWUPS.md`
(2026-05-21 entries). Code can be written against env-var placeholders;
it cannot run until these exist.

- [ ] Confirm the V1 GCP project + OAuth client are reused for V2 (D4).
- [ ] Provision Upstash Redis (BullMQ backend) — `REDIS_URL`.
- [ ] Create a Pub/Sub topic + push subscription + OIDC service account (D229).
- [ ] Decide the PR-B token-encryption scheme (§4).

All secrets land as placeholders in `.env.example`; real values go in GCP
Secret Manager / GitHub Actions secrets — never committed (CLAUDE.md §10).

---

## 10. Attachment feature — resolution

The founder asked: fetch attachment size / has-attachment, and add a
"find larger attachments" feature.

**Finding — this brushes the D7 / §2.1 hard guardrail:**

- **"Has attachment"** (boolean) — _feasible body-free._ Gmail's
  `q=has:attachment` search returns matching message IDs without fetching
  any body.
- **Per-attachment size** — _not feasible without a violation._ It
  requires `messages.get?format=full`, which fetches the message body /
  MIME tree. That breaks the "Full bodies fetched: 0" trust artifact.
- **Whole-message `sizeEstimate`** — body-free (returned with
  `format=metadata`); a coarse proxy for "this message is large."

**Both `has_attachment` and `size_estimate` are new fields beyond the D7
storage allowlist.** Adding to what DeclutrMail stores is a privacy-posture
change — a §9 stop-condition, and D4 notes storage changes are
CASA-relevant. It is **not** an agent's call.

**Decision:** not built. PR-A's `mail_messages` ships the D7 allowlist
only — no attachment columns. Filed as a D-candidate in
`FOUNDER-FOLLOWUPS.md` (2026-05-21) for the founder to ratify or reject.
If ratified, it slots into PR-C's sync as a `q=has:attachment` pass plus
new allowlisted columns.

---

## 11. Plan-drift / D-candidates raised by this work

- **`sender_timeseries.opens` → `read_count`** — Gmail exposes no open
  events. Shipped as `read_count`. Ratify or amend the plan.
- **Attachment metadata storage** — see §10.
- **D187 sequencing** — this work builds the Senders backend (PR2 + PR4
  territory) ahead of the locked PR-3 golden-screens / PR-4 sync order.
  Founder-approved detour; logged with the existing 2026-05-20
  reconciliation FOUNDER-FOLLOWUP.
