# ADR-0008: API response envelope, NestJS module template, read-service pattern

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D201 (Standard NestJS modules + Adapter pattern), D202 (API response envelope + cursor pagination), D204 (Read-only services per feature + events for cross-feature writes)

## Context

The Senders Detail UI (PR #30) shipped against fixture data. To wire
real Gmail data through to it — and to every feature module that
follows — three foundation decisions need a single canonical
expression in code:

1. **D202 envelope.** Every response is `{ data, meta? }`. Cursor
   pagination, not offset. Until this PR, the shape only existed
   inline on `UndoController` (PR #33) — every new controller would
   have copy-pasted it, with drift inevitable.
2. **D201 NestJS module template.** A feature module sits at
   `apps/api/src/<feature>/<feature>.module.ts` with a thin
   `<Feature>Controller` (input validation + delegation), a
   `<Feature>Service` (business logic), and — per D204 — a
   `<Feature>ReadService` that is the ONLY place that issues SELECTs
   for that feature's tables.
3. **D204 read-service rule.** Reads are owned by the feature that
   owns the schema; cross-feature reads happen by emitting domain
   events that another feature subscribes to and projects into its
   own table — never by one feature's service reaching into
   another's table. Cross-feature WRITES are the same pattern:
   events, never direct INSERT/UPDATE/DELETE across feature
   boundaries.

PR #30's Senders Detail FE is the immediate forcing function — without
the envelope contract and read-service rule landed, four planned
parallel worktrees (senders BE wire-up, senders FE wire-up, triage UI,
D224 sync transport) would each invent their own version of the same
contract.

## Decision

Land all three foundations in one PR.

### 1. D202 envelope — `packages/shared/src/contracts/envelope.ts`

Two shapes, expressed as TypeScript interfaces so BE controllers and FE
TanStack Query hooks compile against the same definition:

```ts
interface Envelope<TData, TMeta = undefined> {
  data: TData;
  meta?: TMeta;
}

interface PaginatedEnvelope<TItem>
  extends Envelope<TItem[], { pagination: PaginationMeta }> {
  meta: { pagination: PaginationMeta };
}

interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}
```

Helpers (`ok`, `paginated`, `withMeta`, `encodeCursor`,
`decodeCursor`, `clampLimit`) live in
`packages/shared/src/contracts/paginate.ts`. They are pure functions —
no NestJS imports — so the shared package stays framework-agnostic per
the existing `contracts/kms-provider.ts` pattern.

Cursor encoding: `base64url(JSON.stringify({ key, id }))`. Not signed
— the mailbox-scoped WHERE predicate handles isolation. A forged
cursor can at worst skip rows in the caller's own mailbox.

`decodeCursor()` returns `null` for every flavor of bad input
(malformed base64, valid base64 of non-JSON, valid JSON of wrong
shape). Controllers treat `null` as 400, not 500.

### 2. D201 module template

Every feature module follows the same skeleton — established by
`UndoModule`/`UndoController`/`UndoService` (PR #33):

```
apps/api/src/<feature>/
  <feature>.module.ts        // imports + providers + exports
  <feature>.controller.ts    // HTTP surface, thin
  <feature>.service.ts       // business logic
  <feature>.read-service.ts  // SELECT-only, owns schema reads
  <feature>.types.ts         // shared types if non-trivial
```

The controller:
- Validates input (Zod when non-trivial; type guards for tiny payloads
  per the existing `UndoController` pattern).
- Calls the service / read-service.
- Returns the D202 envelope (`ok()`, `paginated()`, `withMeta()`).
- Catches no exceptions — `AllExceptionsFilter`
  (`apps/api/src/common/all-exceptions.filter.ts`) handles the error
  envelope per D168.

The read service:
- Holds the SELECT queries against the feature's own tables.
- Returns plain data — no NestJS decorators, no exceptions for
  not-found (return null/empty array; let the controller decide the
  HTTP status).
- Is the ONLY place outside migrations that SELECTs from the feature's
  schema. Cross-feature reads consume domain events (D204) and
  project into the consuming feature's own table.

Authentication (until D109/D224 lands): controllers identify the
mailbox via the `x-mailbox-account-id` header — established by
`UndoController` and `OAuth callback` flows. When the session layer
ships, this is replaced by a guard reading the JWT.

### 3. D204 read-service pattern

The senders feature owns `senders`, `sender_timeseries`, and
`sender_policies`. A future "weekly hero" feature that needs
sender data MUST read it by:

- Subscribing to a `SenderActivityChanged` domain event emitted from
  the senders feature, AND
- Projecting the relevant fields into a weekly-hero-owned table
  (`weekly_hero_sender_rollups` or similar).

The weekly-hero feature MUST NOT directly SELECT from `senders`.
Triage decisions feature (`triage_decisions`) is read-owned by the
triage feature — Senders Detail's decision history is therefore
either:

- Read by the senders feature via a triage-emitted event projected
  into a senders-owned table, OR
- (Launch-pragmatic exception) the senders feature reads
  `triage_decisions` directly with a comment noting the future
  event-projection migration path. Pragmatic at launch because the
  query is read-only and the projection adds operational complexity
  before we know the access pattern. Flagged for ratification when
  the triage feature grows past the current single-table footprint.

## Consequences

**Positive:**
- One canonical envelope shape; the contract type travels with the
  data so BE controllers and FE hooks share compile-time checks.
- Module skeleton documented — future agents don't reinvent it from
  the Undo/Triage references.
- Read-service rule lifts D204 from prose into enforceable code
  layout. `architecture-guardian` can grep for cross-feature SELECTs
  and flag them.
- Senders BE worktree can land in parallel with senders FE worktree
  (FE consumes the typed envelope; mocks via MSW until BE merges).

**Negative:**
- The pragmatic exception for `triage_decisions` access from the
  senders read service is a small architectural debt. Tracked here so
  the migration is intentional, not accidental.
- Existing controllers (`UndoController`, `TriageController`) inline
  their envelope shape rather than importing the type. Per CLAUDE.md
  §1.3 (surgical changes), this PR does NOT refactor them — new
  controllers adopt the import; existing ones stay until they're
  touched for an unrelated reason.

**Neutral:**
- The cursor is unsigned. Acceptable today; revisit if/when we
  introduce per-mailbox shared cursors (we won't).

## Alternatives considered

- **Inline envelope shape per controller.** The status quo. Rejected
  — guarantees drift across 5+ feature modules.
- **`@declutrmail/api-contracts` as a separate package.** Considered;
  rejected as premature. The existing `packages/shared/src/contracts/`
  subdirectory already serves this purpose (KMS provider lives there),
  and adding a package adds workspace overhead with no current win.
- **Offset pagination.** Rejected — see D202; offset is racy under
  concurrent inserts from the sync worker.

## Verification

- `packages/shared/src/contracts/paginate.test.ts` — 18 unit tests
  covering envelope helpers, cursor round-trip, and bad-input
  handling.
- Follow-up PRs (senders BE module, senders FE wire-up) import the
  types and call the helpers — establishing the pattern is in use.
