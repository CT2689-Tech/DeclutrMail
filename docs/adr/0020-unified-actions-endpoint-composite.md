# ADR-0020: Unified `POST /api/actions` endpoint + composite action shape

- **Status:** Accepted
- **Date:** 2026-06-03
- **Accepted:** 2026-06-03 (founder signed senders-v2 spec v1.2)
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D202 (API envelope contract), D203 (worker policies), D204 (cross-feature events), D205 (orchestrator boundaries), D225 (worker idempotency), D226 (mandatory action preview), D232 (undo journal retention), D156 (rate limiting), D159 (observability events)
- **Related ADRs:** ADR-0008 (API envelope + module template), ADR-0013 (destructive action pipeline), ADR-0015 (Action Registry), ADR-0019 (Verb Registry + K/A/U/L/D)
- **Related spec:** docs/spec/senders-v2.md v1.2 — Decision 15

## Context

The senders-v2 spec (Decision 15) introduces a **composite action modal**: user picks a primary verb (Keep · Archive · Unsubscribe · Later · Delete) and may optionally compose a **secondary historic action** (Archive or Delete past emails) when the primary is Unsubscribe or Later. Both primary and secondary support a **time-window selector** ("Older than 6 months", custom days).

Existing BE shape:

```
POST /api/actions/archive
POST /api/actions/later
POST /api/actions/unsubscribe
POST /api/actions/keep
```

Per-verb endpoints. Body shape varies per verb. To add Delete: open a new `POST /api/actions/delete` endpoint. To support composite (`Unsubscribe + Delete past`): open a new endpoint OR thread two requests from the FE.

Both approaches drift:

- Per-verb endpoints = N endpoints, N rate-limit policies, N controller methods, N test files. Each new verb ships ~200 LOC of boilerplate.
- Two-request composite from FE = race conditions (primary succeeds + FE network drops before secondary fires); BE has no atomic linkage; observability per D159 fires two unrelated events instead of one composite event.

Founder explicitly asked for the **long-term correct shape**. Pre-launch state has no production traffic — backward compatibility is free.

## Decision

We collapse the per-verb action endpoints into a **single `POST /api/actions` endpoint** accepting a **composite action shape**, backed by **Option A** persistence (two linked DB records via `composite_id`).

### Request shape

```ts
POST /api/actions
Content-Type: application/json

{
  // 1-N senders. Single-sender flow passes `[senderId]`. Bulk-by-
  // filter flow passes the resolved sender ids OR a filter object
  // (see "Bulk variant" below).
  senderIds: string[];

  // Primary verb — derived from FE Verb Registry. Always required.
  primary: {
    type: 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';
    // Time-window filter. Applies to Archive + Delete. null = no
    // time filter (acts on all matching mail). Capped by client +
    // server at 1–3650 days.
    olderThanDays?: number | null;
  };

  // Optional secondary historic action. ONLY valid when primary is
  // 'unsubscribe' or 'later' (the verbs that don't already act on
  // past mail). Server enforces this; an invalid combination 400s.
  secondary?: {
    type: 'archive' | 'delete';
    olderThanDays?: number | null;
  };

  // Future fields (not in scope here):
  // - idempotencyKey: string  (client retry safety, D225)
  // - dryRun: boolean         (preview-only; no enqueue)
}
```

### Response shape (D202 envelope)

```ts
{
  data: {
    actionId: string; // primary's row id
    compositeId: string; // same as actionId when standalone
    secondaryId: string | null;
    status: 'queued';
    estimatedCount: {
      primary: number; // 0 for keep/unsub/later one-time ops
      secondary: number | null;
    }
    undoToken: string; // composite undo token — reverts both
    undoExpiresAt: string; // ISO timestamp; 7d for non-delete, 30d for delete
  }
  meta: {
    requestId: string;
  }
}
```

### Persistence — Option A (two linked records)

`action_jobs` table extended (already exists per ADR-0015 + earlier
schema work; this ADR adds two columns + extends the verb enum):

```sql
-- Migration: add composite linkage + time-window + delete verb

ALTER TYPE action_verb ADD VALUE IF NOT EXISTS 'delete';
-- (Atlas migration handles the enum extension safely.)

ALTER TABLE action_jobs
  ADD COLUMN composite_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN older_than_days integer NULL
    CHECK (older_than_days IS NULL OR (older_than_days >= 1 AND older_than_days <= 3650));

-- Self-FK so a composite secondary references its primary's id.
ALTER TABLE action_jobs
  ADD CONSTRAINT action_jobs_composite_fk
  FOREIGN KEY (composite_id) REFERENCES action_jobs(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX action_jobs_composite_id_idx ON action_jobs (composite_id);
```

Row semantics:

- **Single-verb action** (Archive, Delete, Keep alone): ONE row. `composite_id = id` (self-ref).
- **Composite action** (Unsub + Archive past, Unsub + Delete past, Later + Archive past, Later + Delete past): TWO rows. Both share `composite_id = primary.id`. Secondary row's `id != composite_id`.

### Worker policy (D203, D225)

Per existing `packages/workers/` patterns:

- Single-verb row enqueues via existing per-verb queues (`label-modify`, `policy-only`, `unsubscribe`, plus new `delete` queue routing to Gmail Trash worker)
- Composite secondary enqueues w/ a **`waitForCompositeId` DAG hint** — the BullMQ job waits for the primary's `status='done'` before starting. Implemented via `Job.opts.dependencies[]` or a small composite-orchestrator worker that polls primary state.
- **Failure cascade:** primary fails → secondary skipped (BullMQ dependency failure semantics). Toast: "Couldn't unsubscribe. Past emails untouched." Secondary remains in `queued` state and can be retried alone via `POST /api/actions/:secondaryId/retry` (future endpoint, not in this ADR).
- **Idempotency:** `idempotencyKey` (future client field) ensures retried requests don't double-enqueue. Existing D225 retry semantics apply.
- **Observability (D159):** TWO `worker.succeeded` events fire (primary + secondary), each tagged with `composite_id` so analytics can group them.

### Undo

Composite undo via the `undoToken` returned on the primary's response. The undo journal entry stores the `composite_id`; revert reads ALL rows w/ that `composite_id` and reverses each in REVERSE ORDER (secondary first, then primary). Idempotent — re-firing undo with the same token is a no-op.

`undoExpiresAt` = `max(primary.expires_at, secondary.expires_at)`. Delete = 30d (Gmail Trash recovery window), all other verbs = 7d (D232).

### Preview endpoint (separate, faster)

```
GET /api/actions/preview
  ?senderId={uuid}           // OR senderIds=...
  &primary[type]=archive     // OR delete / unsubscribe / later / keep
```

Returns:

```ts
{
  data: {
    sender: {
      id, name, domain,
      totalInbox: 47,           // count in inbox today
      totalAll: 247,            // count across all labels
      lastSeenDays: 2,
      repliedCount: 0,
      relationshipYears: 12,
    },
    counts: {
      all: 247,
      olderThan30d: 180,
      olderThan90d: 160,
      olderThan180d: 125,
      olderThan365d: 80,
    },
    custom: null,               // computed on-demand via separate query string
    unsubAvailable: true,       // true when sender has unsub-link header
    protected: false,
    oldestSubjects: [           // 5 oldest subjects within selected window
      { id, subject, snippet, receivedAt },
      // ...
    ];
  };
  meta: { requestId };
}
```

Custom days variant:

```
GET /api/actions/preview?senderId=...&primary[olderThanDays]=120
  → returns counts.olderThanCustom = 95
```

### Bulk variant

```
POST /api/actions/preview/bulk
  Body: { filter: { activity: 'active', has_unsubscribe: true }, primary: {...} }
```

Returns per-sender breakdown + aggregate counts. Bulk-action enqueue uses the same `POST /api/actions` endpoint w/ a resolved `senderIds[]` array — server caps at 1,000 (D-Q1) and rejects if filter resolves to more.

### Rate limiting (D156)

- `POST /api/actions` → per-user 60 req/min (already in `triage-load` policy or a new `actions` policy)
- Composite counts as 1 request for rate-limit purposes
- Worker-side Gmail quota throttling unchanged (per D5)

### Retiring per-verb endpoints (PRE-LAUNCH — no compat layer)

Per founder explicit "yank dead code pre-launch" guidance:

- `POST /api/actions/archive` → REMOVE
- `POST /api/actions/later` → REMOVE
- `POST /api/actions/unsubscribe` → REMOVE
- `POST /api/actions/keep` → REMOVE
- FE callers (`apps/web/src/features/senders/api/use-action.ts`, `apps/web/src/lib/api/actions.ts`) migrate to `POST /api/actions` in Phase 2 PR-FE3

Phase 5 dead-code sweep removes the controller files + tests.

## Alternatives considered

**A. Per-verb endpoints stay; add `POST /api/actions/composite` alongside.**

- Rejected: doubles the API surface. Future verbs still touch N endpoints.

**B. GraphQL mutation w/ a generic `applyAction` field.**

- Rejected: project is REST + Drizzle + Nest. GraphQL would be a stack departure.

**C. Single endpoint but Option B (one DB row w/ steps JSON array).**

- Rejected per ADR-0020 Q46 analysis — schema migration heavier, querying harder, atomicity vs partial-failure semantics complex.

**D. RPC-style `POST /api/actions/execute` with `body.action: { type, params }` (Tagged-union body).**

- Almost identical to chosen shape. Naming `applyAction` / `execute` adds noise vs RESTful `POST /api/actions` ("create an action"). Chosen for terseness.

## Consequences

### Positive

- ONE endpoint, ONE rate-limit policy, ONE controller, ONE auth check
- Composite actions atomic from BE perspective (linked via `composite_id`)
- Adding a future verb (Mute, MarkAsSpam) = enum extension + worker + Verb Registry entry; ZERO new endpoint
- Observability events grouped by `composite_id` for analytics
- Failure modes explicit (cascade on primary fail, secondary-retry alone)
- Type contract via Zod schema once; FE hooks share one type

### Negative

- Existing tests for per-verb endpoints need rewriting (acceptable — pre-launch, no compat)
- Single endpoint = bigger blast radius if a controller bug ships (mitigation: more aggressive integration test coverage)
- DAG-style worker dependency (composite secondary waits for primary done) is more complex than independent enqueues (mitigation: BullMQ `dependencies` already supported; small composite-orchestrator helper covers the cases BullMQ can't express directly)
- `composite_id = id` self-ref pattern feels redundant for single-verb actions (mitigation: NULL semantics worse — Option A's "both rows always have composite_id" simplifies cascade undo logic)

### Neutral

- Drizzle schema gains 2 columns (`composite_id`, `older_than_days`) + 1 enum value (`delete`); Atlas migration straightforward
- ADR-0008 envelope unchanged
- ADR-0013 destructive-action-pipeline unchanged; this ADR is the controller surface, that ADR is the worker contract

## Verification

- Integration tests covering all 5 single-verb compositions + 4 multi-verb compositions (unsub+archive / unsub+delete / later+archive / later+delete)
- Schema migration tested via Atlas dry-run + manual revert
- Composite undo restored end-to-end (cascade order verified)
- Failure mode: primary success + secondary fail → secondary retriable
- Rate-limit assertion: 60+ requests/min returns 429 envelope
- D7/D228 privacy review on `oldestSubjects` field of preview response (subjects + snippet only)
- `architecture-guardian` review on Phase 1 BE PR
- `schema-migration-reviewer` review on Atlas migration
