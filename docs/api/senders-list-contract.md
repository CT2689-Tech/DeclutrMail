# API contract — `GET /api/senders` (list)

Lean contract for the Senders redesign. Scope: enough to unblock **Slice 0**
(bounded `protected=`) and **Slice 1** (server count/sort/keyset). Search-DSL and
advanced-filter detail (Slices 2–3) are sketched, not frozen.

- **Status:** Proposed · 2026-05-29
- **Companion:** [ADR-0014](../adr/0014-senders-total-received-counter.md) (`total_received` counter semantics)
- **Extends:** ADR-0008 (API envelope), D202 (cursor pagination)
- **Privacy:** D7/D228 — response carries only allowlisted sender fields; **never**
  body/attachment/non-allowlisted headers. Search keys on sender fields only.

## Request

`GET /api/senders` — mailbox resolved server-side from session via
`CurrentMailboxGuard` (a `409 SELECT_MAILBOX` / `NO_ACTIVE_MAILBOX` is a **designed
state**, not an error to retry — FE renders the gate; reads do not retry 4xx).

| Param       | Type         | Default | Notes                                                                                                                         |
| ----------- | ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `limit`     | int          | 50      | server-clamped to max 100                                                                                                     |
| `cursor`    | string\|null | null    | opaque keyset cursor (see below); omit for page 1                                                                             |
| `sort`      | enum         | `total` | `total` \| `read` \| `last_seen` \| `first_seen` \| `name` \| `recommended`                                                   |
| `direction` | enum         | `desc`  | `asc` \| `desc`; server applies a sane default per `sort` if omitted                                                          |
| `protected` | bool         | —       | **Slice 0.** `true` → only `is_protected` senders                                                                             |
| `category`  | enum         | —       | existing Gmail-category filter (kept)                                                                                         |
| `search`    | string       | —       | **Slice 2.** sender name/domain prefix + DSL (`vol:>500 read:never`); bad query degrades to plain text, never errors the list |
| `filters`   | repeated     | —       | **Slice 3.** predicate chips (`unopened`, `dormant`, `has_mailto`, `vip`, …); compose with `search` + `sort`                  |

Cursor is **bound to `(sort, direction, filters, search)`** — changing any of them
**resets to page 1** (cursor must be discarded client-side on any criteria change).

## Response — `PaginatedEnvelope<SenderListRow>` + query meta

Extends the existing envelope. `data` = rows; `meta.pagination` unchanged
(`nextCursor`). **New:** `meta.query`, returned on **every page**:

```jsonc
{
  "data": [
    /* SenderListRow[] */
  ],
  "meta": {
    "pagination": { "limit": 50, "nextCursor": "…|null" },
    "query": {
      "totalMatching": 1852, // rows matching this filter+search (query-wide)
      "globalMaxTotal": 2030, // MAX(total_received) for the ACTIVE MAILBOX,
      //   UNFILTERED — the magnitude-bar denominator.
      //   Mailbox-wide so bars stay comparable across
      //   filtered views (a filtered view does not
      //   rescale to its own max).
      "counts": {
        /* optional per-chip counts for the filter UI */
      },
      "asOf": "2026-05-29T12:34:56Z", // server timestamp this meta was computed
    },
  },
}
```

**Freshness honesty (no snapshot isolation).** **Page 1's `meta.query` is the
authoritative value for the scroll.** Later pages still return `meta.query`, but
the server recomputes it per request; on a long scroll during active ingest it
may drift from page-1. The client **preserves page-1 `meta.query` through the
scroll** and does **not** animate/replace counts on subsequent pages. The
`asOf` timestamp makes the drift inspectable, not a guarantee of equality.

**`SenderListRow` (Slice 1 shape)** — allowlisted fields only:
`id, displayName, email, domain, gmailCategory, totalReceived, monthlyVolume,
readRate (→ bucketed client-side), volumeTrend, lastSeenAt, firstSeenAt,
unsubscribeMethod, isVip, isProtected, lastReview{at,verdict,generatedBy,confidence}`.

`totalReceived` and `monthlyVolume` are stored as `bigint` and serialized as JSON
**numbers** (safe integers — well below `Number.MAX_SAFE_INTEGER`); the API layer
asserts the bound. No JS `bigint` on the wire (JSON cannot carry it).

## Cursor contract (keyset, eventually-consistent)

- **Encoding:** opaque base64 of `(sortValue, id)` for the active `sort`; `id` is the
  **stable tiebreaker** appended to every sort key (guarantees total ordering
  even when `sortValue` ties, e.g. many senders with equal `total_received`).
- **Index + comparison direction (exact, per column):**

  | `sort`            | Index                                                | Cursor comparison                                  |
  | ----------------- | ---------------------------------------------------- | -------------------------------------------------- |
  | `total` (default) | `(mailbox_account_id, total_received DESC, id DESC)` | `(total_received, id) < (cursor.total, cursor.id)` |
  | `read`            | `(mailbox_account_id, read_rate, id)` NULLS LAST     | matching direction                                 |
  | `last_seen`       | `(mailbox_account_id, last_seen_at DESC, id DESC)`   | matching direction                                 |
  | `first_seen`      | `(mailbox_account_id, first_seen_at DESC, id DESC)`  | matching direction                                 |
  | `name`            | `(mailbox_account_id, display_name ASC, id ASC)`     | matching direction                                 |

  Cursor comparison MUST match the index's column order and direction (otherwise the planner falls off the index).

- **Null handling:** nullable sort columns (`monthlyVolume`, `readRate`,
  `volumeTrend`) sort **NULLS LAST** in both directions; the cursor records the
  null boundary explicitly.
- **Mutation tolerance:** `total_received` only moves on **new mail** (minutes–
  hours), not during a scroll. We accept **eventual consistency** — a sender may
  rarely shift across a page boundary during active ingest (a duplicate or a
  skip). We do **not** build snapshot/MVCC cursors (overkill for a slow-churn
  list).
- **Sender-id churn on rebuild.** `InitialSyncWorker.buildSenderIndex` does an
  authoritative `DELETE senders WHERE mailbox + reinsert` (existing behavior,
  Codex 2026-05-22 iter 3) → **`senders.id` changes for every sender on every
  rebuild.** Cursors that embed `id` are therefore valid **only between rebuilds**.
- **Refetch trigger:** on the `sync.completed` event, **invalidate the mailbox's
  sender queries → refetch page 1 + meta, clear stale cursor state.** This is the
  single contract point that covers (a) drift accumulated during ingest, (b)
  rebuild-driven id churn, and (c) `meta.query` re-anchoring to a fresh page-1.

## Error states

| Condition                              | Response                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ |
| no active mailbox                      | `409 NO_ACTIVE_MAILBOX` — designed gate, FE renders picker, **no retry** |
| mailbox not owned by session           | `403`                                                                    |
| malformed `cursor`                     | `400 INVALID_CURSOR` — FE drops cursor, refetches page 1                 |
| malformed `sort`/`direction`/`filters` | `400` with field detail                                                  |
| malformed `search` DSL                 | **never 400** — degrade to plain-text search, return results             |

## Observability acceptance checklist (per Codex P2 — every slice asserts these)

- endpoint p95 latency (target < 200ms) · rows returned · `nextCursor` issued/consumed
- `INVALID_CURSOR` rate · DSL parse-failure rate (shape only — **never log raw query
  values**, they are PII) · aborted in-flight search count
- `senders.counter_drift` (from ADR-0013 reconciliation)

## Surface by slice

- **Slice 0:** `protected=true` + `limit` + `cursor` only. Query key includes
  `{category, limit, isProtected}` (fixes the shell/policies collision Codex
  flagged). Mailbox-scope is handled by the existing `resetMailboxScopedCache`
  on mailbox switch (§8 invariant) — promoting mailbox into the key itself is a
  later cleanup, not Slice 0 scope. Remove the policies-screen auto-pagination
  effect; surface a manual "Show more" when `hasNextPage`.
- **Slice 1:** `sort`/`direction` (incl. `total`), `meta.query`, counter column.
- **Slice 2:** `search` (typeahead + DSL). **Slice 3:** `filters` + saved views.
