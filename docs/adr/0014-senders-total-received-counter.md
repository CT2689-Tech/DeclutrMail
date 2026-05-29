# ADR-0014: `senders.total_received` denormalized counter

- **Status:** Proposed
- **Date:** 2026-05-29
- **Deciders:** founder, Claude (design session), Codex (review rounds 1–3)
- **Related D-decisions:** D7/D228 (privacy allowlist), D12 + ADR-0011 (sender_key), D202 (cursor pagination), D222 (no prediction), D235 (partitioning ceiling), D159 (observability), ADR-0013 (destructive-action pipeline — sibling, unrelated)

## Context

The Senders screen redesign makes **"total received"** the headline, sortable
metric ("who floods me"). The only total the product ever showed was a
synthesized `monthly × months × 0.85`, removed in PR #52 for being untrustworthy.
A real total must be a true count.

At 5,000+ senders the list is sorted server-side (the client must not accumulate
pages — see the request-storm in `senders-policies-screen.tsx`). Sorting by a
count therefore needs the count to be an **orderable column**, not a per-query
aggregate: a correlated `COUNT` subquery in `ORDER BY` across 5k rows risks the
D235 p95 ceiling.

The two existing write paths into `senders` and `mail_messages`:

1. **Full-mailbox rebuild** — [`InitialSyncWorker.buildSenderIndex`
   ](../../packages/workers/src/initial-sync.worker.ts) — does an authoritative
   atomic rebuild: `DELETE senderTimeseries WHERE mailbox; DELETE senders WHERE
mailbox; INSERT senders+timeseries from recomputed aggregate.` This was made
   authoritative (Codex review 2026-05-22 iter 3) precisely because incremental
   "survivor patches" left rollup drift forever. As a consequence, **`senders.id`
   churns on every rebuild.**
2. **Incremental ingest** — message inserts use `INSERT ... ON CONFLICT (mailbox,
provider_message_id) DO UPDATE SET ...` (re-delivered Pub/Sub may carry updated
   read/unread state, so `DO NOTHING` would drop legitimate updates).

The risk a denormalized counter introduces is **drift**. The maintenance contract
below must fit _both_ write paths and survive id churn, or the headline metric
silently becomes a lie.

## Decision

We will add **`senders.total_received` (bigint, not null, default 0)**, defined as
**the count of inbound (`is_outbound = false`) messages synced from this sender,
lifetime within retention**. It is maintained authoritatively on rebuild and
idempotently on incremental ingest, never decremented by user actions, and
periodically reconciled.

### Exact semantics

- **Counts:** inbound (`is_outbound = false`) messages retained for this
  `(mailbox_account_id, sender_key)`.
- **Does NOT track inbox state.** Archiving, reading, or labelling a message does
  **not** change it — those are not "un-receiving." This keeps the metric stable
  and preserves the "flood" meaning. (Explicitly rejects the "current non-trash
  inbox count" interpretation.)
- **Wire type:** stored as `bigint` (PG `int8`), serialized to JSON as a **number**
  (not a string). Counts are bounded _far_ below `Number.MAX_SAFE_INTEGER` (2^53);
  a sender at ~9 quadrillion messages is not a real concern. If a per-mailbox
  ceiling is ever needed it lives in the API layer, not the column.
- **Sender identity** is the existing `sender_key` rule (D12 / ADR-0011,
  [`packages/workers/src/sender-key.ts`](../../packages/workers/src/sender-key.ts)):
  `sha256("v1|" + normalizeEmail(addr))`, where `normalizeEmail` = trim +
  lowercase + strip a single `+suffix` alias from the local part; **no** Gmail
  dotless folding; `From` parsed by `parseFromHeader` (messages with no
  extractable address are skipped, never keyed). The counter inherits this
  identity definition verbatim — it does not introduce its own.

### Maintenance — two paths

**Path A — full rebuild (authoritative).** `buildSenderIndex` computes
`total_received = COUNT(*) FILTER (WHERE is_outbound = false) GROUP BY sender_key`
over the rebuilt `mail_messages` set in the same transaction that re-inserts
`senders` and `sender_timeseries`. The rebuild _is_ the reconciliation — any drift
that the incremental path accumulated since the last rebuild is closed atomically.
**Consequence:** `senders.id` changes for every sender on every rebuild (existing
behavior). Cursors that use `id` as a tiebreaker MUST be invalidated on
`sync.completed` — see the API contract.

**Path B — incremental ingest (idempotent increment).** The Pub/Sub message-ingest
upsert is amended to return, per row, whether it was an actual insert or an
update — the standard Postgres idiom:

```sql
INSERT INTO mail_messages (...) VALUES (...)
ON CONFLICT (mailbox_account_id, provider_message_id) DO UPDATE
  SET is_unread = excluded.is_unread, ...
RETURNING sender_key, is_outbound, (xmax = 0) AS inserted;
```

Rows with `inserted = true AND is_outbound = false` are grouped by `sender_key`
and applied as `senders.total_received = total_received + n` **in the same
transaction**. A redelivered Pub/Sub message hits the conflict path (`inserted =
false`) → contributes 0 → counter stays correct. Anchored on the existing
`mail_messages_account_provider_message_uniq` index.

This is a **required implementation change** to the current incremental path — it
preserves the existing `DO UPDATE` (so read/unread updates still land) while
adding the inserted-row signal the counter needs.

### Reconciliation & drift

- Full rebuilds are the primary reconciliation — they restore authoritative
  counts atomically.
- Between rebuilds, a periodic recount job emits a `senders.counter_drift` metric
  (count of corrected senders + max delta) to the D159 observability seam, so
  drift is **measured and visible**, not assumed away. Frequency: nightly is the
  default; tighter if drift trends above a TBD threshold.
- **Retention-driven message deletion** is not real-time-decremented on the hot
  path. It is reconciled by the next rebuild + the nightly drift job. If a future
  product surface needs tighter freshness on prune, we add an explicit decrement
  on the prune path; until then we accept bounded drift, visible via the metric.

### Reset / delete

- Mailbox disconnect/delete cascades the counter away (`senders` already
  `onDelete: cascade` from `mailbox_accounts`). A resync re-seeds via Path A.
- Account deletion continues to follow D232 windows — this ADR adds no new
  deletion behavior.

## Alternatives considered

- **Correlated `COUNT` subquery per query (no column):** rejected — `ORDER BY` over
  it across 5k senders risks the D235 p95 ceiling.
- **`DO NOTHING RETURNING` on incremental ingest:** rejected — would drop the
  legitimate `read/unread/labels` updates that re-delivered Pub/Sub messages
  carry. The `xmax = 0` signal preserves both update and inserted-row count.
- **Materialized view refreshed on a schedule:** rejected for the hot count —
  staleness would visibly lag new mail.
- **`current_inbox_count` semantics:** rejected — mutates on every archive/read,
  churns the counter, breaks the "how much has this sender sent me" meaning.
- **`sender_key` as cursor tiebreaker** (survives id churn): viable, but `id` is
  cheaper and `sync.completed` already invalidates cursors. Revisit if cursors
  need to survive a rebuild.

## Consequences

### Positive

- Fast, indexed `ORDER BY total_received` → sort-by-flood within the <200ms budget.
- Honest, stable metric with an explicit, documented meaning.
- Rebuilds reconcile authoritatively; incremental drift is bounded and measured.

### Negative

- A write-path field with a maintenance contract on **two** paths. Either path
  drifting silently is the failure mode the drift metric exists to catch.
- One migration (counter column + backfill + index) → schema-migration-reviewer
  gate.
- The incremental upsert grows a `RETURNING` clause + a follow-on update — small
  perf cost on the ingest hot path, well within the existing transaction budget.

### Neutral

- `total_received` is "within retention," not "all-time in Gmail." UI copy says
  "received," never "all-time," consistent with the no-body privacy posture.

## Implementation notes

- Migration: add `total_received bigint not null default 0` to `senders`; backfill
  from `mail_messages` grouped by `sender_key` (inbound only). Add index
  `(mailbox_account_id, total_received DESC, id DESC)` — keyset cursors compare
  in matching direction with `NULLS LAST`. Sister indexes for other sortable
  columns (`read_rate`, `last_seen_at`, `first_seen_at`) added per-slice as needed,
  not upfront.
- Touch points: `buildSenderIndex` (Path A), the incremental message-ingest
  upsert (Path B), a new nightly `senders-counter-reconciliation` worker, and
  `SendersReadService.listSenders` (expose + `ORDER BY`).
- Tests: idempotent redelivery (0 increment, read/unread update still lands);
  backfill seed correctness; cross-mailbox `sender_key` collision (tenant
  boundary, per PR #47); rebuild authoritatively restores after a deliberately-
  skewed counter; `sync.completed` cursor invalidation covers id churn.

## References

- ADR-0011 (sender_key) · ADR-0013 (destructive-action pipeline, sibling) · D12 · PR #52 (synthesized-total removal) · D235 · D159
- `packages/workers/src/sender-key.ts`, `packages/workers/src/initial-sync.worker.ts`, `apps/api/src/senders/senders.read-service.ts`
- Companion: [docs/api/senders-list-contract.md](../api/senders-list-contract.md)
