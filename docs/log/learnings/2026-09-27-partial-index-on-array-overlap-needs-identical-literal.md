## 2026-09-27 — A partial index on `&&` matches only the literal it was built with, element order included

**Context:** Migration 0080's partial index serves the non-mail purge:
`WHERE label_ids && ARRAY['DRAFT','CHAT']::text[]`. The gate reviewer for
#798 probed which query shapes the planner will answer from it.
**Finding:** The reviewer's probe, reproduced in-session on PGlite 0.5.8
(PostgreSQL 18.3), 5,000 INBOX rows plus one DRAFT, after ANALYZE. A query with
the same `ARRAY['DRAFT','CHAT']` literal ran an Index Only Scan Backward on the
partial index, and so did a bound `$1::text[]` that was planned with its value.
The same query written `ARRAY['CHAT','DRAFT']` scanned the table and sorted. Postgres cannot reason about `&&`. To use a partial index,
the planner must find the index predicate in the query, and for this operator
it only succeeds when the two expressions are identical, element order
included. A reordered array is a different expression, so the index silently
stops being chosen. It still builds, still exists, and still passes a test
that sorts the labels before comparing them.
**Rule (provisional):** Write a partial index on an array operator with one
literal array. Have the query render that same literal, from one definition:
here, `nonMailRowWhere()` in `packages/db/src/predicates.ts`. Test it with an
EXPLAIN of the query the app actually renders, not of a hand-written copy.
**Distillation trigger:** promote to CLAUDE.md §8 "Performance measurement
discipline" if a second partial index silently stops matching its query.
