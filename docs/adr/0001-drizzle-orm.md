# ADR 0001 — Drizzle as the backend ORM

**Status:** Accepted
**Decision:** D11 (locked in the plan)
**Date:** 2026-05-19
**PR:** TBD (this PR)

## Context

DeclutrMail's backend touches Postgres heavily — message metadata,
sender profiles, activity log, undo journal, outbox events. The schema
relies on Postgres-native features: `jsonb`, `citext`, partitioning
(D151), `FOR UPDATE SKIP LOCKED` (D13), partial indexes, GIN with
`pg_trgm` (D150 index #4).

The team needs:

1. Schema-as-TypeScript so types flow from DB to API to frontend
   without hand-maintained interfaces.
2. First-class support for Postgres-specific types (no leaky-abstraction
   tax on `jsonb`/`citext`/arrays).
3. Lightweight runtime (no heavy reflection / decorator graph at request
   time — the API hot path runs through workers per D203/D225 and the
   request side stays slim per D201).
4. A migration tool we can audit row-by-row before production deploys
   (D152 demands rollback companions + Atlas linting).

## Decision

**Use Drizzle ORM** for all server-side database access.

- **Generation:** `drizzle-kit generate` reads `packages/db/src/schema/*.ts`
  and emits forward migrations under `packages/db/migrations/`.
- **Migration tooling hybrid (D152):** Drizzle Kit generates; Atlas
  lints in CI for dangerous changes (`destructive`, `data_depend`,
  `incompatible`, `concurrent_index`). Each migration ships with a
  companion `*.rollback` file (no `.sql` extension — Atlas reads every
  `*.sql` in the dir and would otherwise apply the rollback before the
  forward, since alphabetical sort places `.rollback.sql` before `.sql`).
- **Round-trip test:** PGlite-backed Vitest suite applies every
  migration, rolls back, re-applies, and asserts schema equality.
  Runs in CI on every PR touching `packages/db/**`.

## Alternatives considered

### Prisma

- **Pros:** mature; large ecosystem; auto-generated client is
  ergonomic.
- **Cons:** schema language is not TypeScript (yet another DSL —
  `prisma.schema`); `jsonb`/array support is weaker; partitioning
  requires escape hatches; runtime is heavier (Rust engine binary +
  IPC); migrations are forward-only with limited human-readable SQL.
- **Disqualifier:** the Rust engine adds operational surface (binary
  must match server arch) that doesn't pay rent for a single-target
  Cloud Run deploy.

### TypeORM

- **Pros:** decorator-based; first-party NestJS integration.
- **Cons:** maintenance pace has slowed; decorator-based schema can't
  encode all Postgres-native features without raw SQL escape hatches;
  active query-builder bugs around `jsonb` over the last 18 months.
- **Disqualifier:** schema-as-decorators couples the DB shape to the
  module that owns the entity, which fights the read-only services +
  cross-feature events pattern in D204.

### Kysely

- **Pros:** lightweight; type-safe query builder; SQL-first.
- **Cons:** not an ORM — no schema-as-TypeScript layer; migration
  tooling separate (e.g., kysely-codegen + custom scripts); types are
  inferred from a `Database` interface that the developer maintains by
  hand.
- **Disqualifier:** D11's action items explicitly require
  schema-as-TypeScript. Adopting Kysely would mean adding a separate
  schema definition layer on top — Drizzle bundles both.

## Consequences

**Positive:**

- Schema and types share a single source (`packages/db/src/schema/*.ts`).
- Postgres-native features (`jsonb`, `citext` planned, partitioning
  planned for D151, partial + GIN indexes for D150) all expressible
  with first-party builders.
- The runtime client is plain SQL underneath — easy to read in logs,
  easy to escape-hatch to raw SQL when needed.
- Drizzle Kit's forward-only migrations match the production discipline
  (D152's manual rollback companion + Atlas pre-deploy lint).

**Negative:**

- Drizzle Kit's CJS resolver doesn't handle `.js` extensions on `.ts`
  source files; schema imports use the unsuffixed form (works with
  `moduleResolution: bundler` in `tsconfig.base.json`).
- Smaller ecosystem of plugins compared to Prisma; some patterns
  (e.g., logical decoding subscriptions) require raw SQL.
- The team has to maintain the rollback files by hand. The round-trip
  test catches the obvious failure modes, but subtle data-bearing
  rollbacks (drop-column-with-data) still need human review per D152's
  pre-deploy checklist.

## References

- D11 — Backend ORM choice (locked)
- D152 — Migration tooling hybrid (Drizzle Kit + Atlas)
- D150 — Indexing strategy (12 indexes at launch; lands per-table in
  feature PRs as the target tables are created)
- D151 — Partitioning (hash on `mail_messages`, range on `activity_log`)
- Codex Doc 04 §18 — round-trip test pattern
