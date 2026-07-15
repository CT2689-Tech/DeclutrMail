# ADR-0013: Async destructive-action pipeline (Archive slice)

**Status:** Accepted
**Date:** 2026-05-28
**Deciders:** Founder
**D-refs:** D226 (action lifecycle), D207 (Discover→Decide→Automate→Audit→Undo), D34/D35/D58 (sheet/tray/undo), D81/D232 (undo windows), D5/D156 (quota/rate-limit), D201/D203/D204/D225 (module/worker/event architecture), D7/D228 (privacy)

## Context

DeclutrMail performed **zero destructive Gmail actions**. The K/A/U/L verbs rendered in
the UI but had no backend. The Gmail mutation primitive (`batchModify`) landed on
`feat/d005-gmail-modify-primitive`; the undo journal + `UndoService` shipped (#33); the
transactional outbox (table 0008 + `OutboxPublisher` + dispatcher) was built; the FE
action sheet→preview shipped (#44). The executor tying them together did not exist.

This ADR records the pipeline that the redesigned Sender Detail "Archive all from this
sender" button calls — and that every future label verb (Trash) and Undo reuse.

## Decision

A **single async pipeline**: `POST /api/actions/archive` resolves + validates + persists
an `action_jobs` row and enqueues a BullMQ job; a `LabelActionWorker` mutates Gmail, then
in **one terminal transaction** issues the undo token + writes `activity_log` + publishes
the `actions.label_action_applied` outbox event + updates the local `mail_messages` label
mirror + flips the job to `done`. The FE polls `GET /api/actions/:id`.

The verb varies only in its `LabelChange` (`VERB_LABEL_CHANGES`); archive is the only
populated entry. Undo is a `direction='reverse'` `action_jobs` row that re-applies the
inverse change — so it reuses the whole lifecycle (and the `failed` state) for free.

## Options Considered

### Option A: Synchronous (mutate inside the request)

| Dimension   | Assessment                                                                              |
| ----------- | --------------------------------------------------------------------------------------- |
| Complexity  | Low                                                                                     |
| Scale       | **Fails** — a 10k-message sender = multi-second `batchModify` chain → gateway timeout   |
| Consistency | Diverges from the autopilot "action-consumer worker" → duplicate mutate+undo+event code |

**Rejected:** capping the set defeats the cluttered-inbox job; the divergence is permanent debt.

### Option B: Async pipeline (CHOSEN)

| Dimension   | Assessment                                                         |
| ----------- | ------------------------------------------------------------------ |
| Complexity  | Medium (status surface + durable set)                              |
| Scale       | Any size — chunked `batchModify`, BullMQ retry/backoff/dead-letter |
| Consistency | One pipeline for user + autopilot + trash + unsubscribe + undo     |

The undo-during-flight race (issue token early → user undoes → worker re-mutates) is
**designed away** by D226's own ordering: the undo token is issued by the worker _after_
the mutation commits. In-flight shows progress (D224 pattern), never a premature Undo.

## Selector model

Discriminated union, both resolved server-side:

- `{ type:'sender', senderId }` — resolves `senderId → sender_key` (ownership), worker
  resolves "in INBOX now" at execute (TOCTOU-tolerant; archive is reversible). Any size.
- `{ type:'messages', messageIds }` — API resolves `ids ∩ mailbox` (forged/cross-mailbox
  ids dropped), **≤500/request** (bulk → use the sender selector). Frozen set.

External API takes `senderId` (the uuid Sender Detail has), never the sha256 `sender_key`.

## Correctness invariants (Codex review 2026-05-28)

1. **Durable execution set.** `provider_message_id`s are resolved once and persisted to
   `action_jobs.resolved_message_ids` **before** the Gmail mutation. A retry after a
   post-mutation crash reuses the persisted set — re-resolving "in INBOX now" would be
   empty after a successful archive, issuing no undo token for work that happened.
2. **Idempotent mutation.** remove-INBOX (and re-add on undo) are Gmail no-ops when
   already applied, so a BullMQ retry is safe.
3. **Client idempotency key.** The `Idempotency-Key` header (one per click) is the dedup
   key — NOT derived from the selector ("archive this sender" today vs next week are two
   actions). UNIQUE on `action_jobs`; BullMQ `jobId` is the second layer.
4. **Async undo without stranding.** The old sync `claimForRevert` set `executed_at`
   before the revert succeeded, stranding tokens whose async revert failed. The async path
   uses `findRevertable` (read-only) + a reverse job whose idempotency is
   `UPDATE undo_journal SET reverted_at=now() WHERE reverted_at IS NULL` + `jobId=revert:<token>`.
5. **Per-mailbox serialization.** `perMailboxPolicy` is a label, not real serialization
   (BullMQ runs `concurrency` jobs across mailboxes). Destructive mutations run inside a
   `pg_advisory_lock(hashtext(mailbox))` (reserved connection) spanning resolve→mutate→commit.
6. **Local label mirror.** The terminal tx updates `mail_messages.label_ids` so the UI +
   the next sender-selector resolve don't see stale INBOX membership via webhook lag.
7. **Backend protection gate.** A Protected sender → 409 `PROTECTED_SENDER` unless the
   request carries `override:true` (defense-in-depth, not FE-hide-only).
8. **Retry config.** Enqueue sets `attempts`/`backoff`/`removeOnComplete`/`removeOnFail`
   (`BaseDeclutrWorker` only _interprets_ attempts; the enqueue must set them).
9. **User recovery is not a blind retry.** A failed Archive, Later, or Delete row
   first creates an expiring, read-only provider-state preview. Confirmation appends
   a new lineage attempt over the provider-existing frozen IDs; it never rewrites or
   reuses the failed row. One-click unsubscribe has no generic retry because delivery
   is not an idempotent Gmail label mutation.
10. **Four idempotency boundaries.** The exact confirmation payload is fingerprinted;
    database lineage allows one direct child per failed attempt; BullMQ uses a stable
    job id and request replay heals an unconfirmed enqueue; Gmail label application
    safely converges when the provider already reflects some or all of the target state.

## Failure-mode table

| Failure point                         | Behavior                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Enqueue fails (Redis down)            | `action_jobs` row marked `failed`; POST 503. No orphan job.                                               |
| `batchModify` chunk fails (transient) | worker throws → BullMQ retry → re-run uses persisted ids → idempotent re-mutate.                          |
| Post-mutation tx fails                | retry reads persisted ids (not re-resolve) → issues correct undo token; Gmail re-mutate is a no-op.       |
| Worker crash mid-job                  | advisory lock auto-released on connection loss; BullMQ retry; persisted ids keep it consistent.           |
| Attempts exhausted                    | `onTerminalFailure` → `status='failed', error_code`; FE shows failed.                                     |
| Duplicate POST (same Idempotency-Key) | `onConflictDoNothing` → existing `actionId`; BullMQ `jobId` dedups.                                       |
| Undo enqueue fails                    | reverse row `failed`; POST 503; user retries.                                                             |
| Double undo POST                      | reverse row keyed `revert:<token>` is idempotent; `reverted_at IS NULL` guard.                            |
| Activity recovery review              | label-only Gmail reads classify not-applied / partial / already-applied / missing before confirmation.    |
| Recovery enqueue acknowledgement lost | child remains `queued`; the same confirmation key re-adds the stable BullMQ job id and returns one child. |
| Recovery confirmation double-click    | request fingerprint + preview row lock + lineage unique indexes return the same child attempt.            |

## Privacy (D7 / D228)

`action_jobs.selector` + `resolved_message_ids` + the undo payload + the outbox event carry
ONLY ids + the sha256 `sender_key` — never body, snippet, subject, or any header. The
`LabelActionSelector` `$type` union cannot represent a body field; `GmailMutationClient`
mutates labels only; the outbox PII-key denylist is the third gate. Recovery verification
uses `format=minimal` with an `id,labelIds` field mask, and Later label lookup lists label
metadata without creating a label during review.

## Consequences

- **Easier:** Trash later = one `VERB_LABEL_CHANGES` entry + one enum value — no new worker.
  Autopilot's future action-consumer reuses this exact pipeline.
- **Harder / to revisit:** the FE must handle an async in-flight state (poll status), not a
  single round-trip. Unsubscribe (network POST, not-undoable) and Later (db-only) need
  different _execute strategies_ on the same pipeline — documented seams, not built here.
- **#33 plan-drift:** the undo controller's `claimForRevert`→immediate-success stub is
  replaced by validate→enqueue-reverse. `claimForRevert`/`recordRevertSuccess` remain for
  the journal lifecycle + tests; the worker now calls the reverse path. Surfaced in the PR.
- **Deferred (D-candidates, not built):** an `action_jobs` TTL/prune sweep (append-heavy
  terminal rows); a real-time status transport (polling for now); the network/db-only verb
  strategies.

## Action Items

1. [x] `action_jobs` schema + migration 0015 + rollback + golden-list test.
2. [x] `actions` module (POST archive + GET status) + `LabelActionWorker` (forward+reverse) + advisory lock.
3. [x] Undo controller → async reverse-job enqueue.
4. [x] `actions.label_action_applied` event + outbox publish.
5. [ ] **Live smoke on the two Gmail accounts (founder hands).** See PR body runbook.
6. [ ] Merge `feat/d005-gmail-modify-primitive` first (or together) — this stacks on it.
