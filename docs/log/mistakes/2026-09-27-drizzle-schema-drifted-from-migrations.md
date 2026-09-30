## 2026-09-27 — The Drizzle schema drifted from the migrations nine times and nothing could notice

**PR:** #798 (https://github.com/CT2689-Tech/DeclutrMail/pull/798)
**Caught by:** schema-migration-reviewer (gate), confirmed by both refuters
**What happened:** Migration 0080 created `mail_messages_non_mail_idx`
without a matching declaration in `packages/db/src/schema/mail-messages.ts`.
Comparing a freshly migrated database against the schema found eight more
objects in the same state, all already merged:
- six indexes: two from 0051, and one each from 0063, 0066, 0070 and 0077;
- two CHECK constraints, from 0020 and 0023.

No check could see any of them:
- drizzle-kit's journal and snapshots stop at 0015, so `drizzle-kit check`
  prints "Everything's fine" whatever a later schema declares;
- `migration-roundtrip.test.ts` compares only table and enum names, yet its
  header claimed it caught "Index / constraint mismatches between schema and
  migration SQL".

The only thing left checking was a reviewer reading each diff, and it missed
0066 and 0070.
**Correct approach:** Declare every index and CHECK in `src/schema` in the
same PR as the migration that builds it. Keep a test that builds the database
from the real migration files and compares the two.
**Rule:** A migration that creates a table, index or CHECK constraint ships
its Drizzle declaration in the same PR. `schema-migration-parity.test.ts`
fails otherwise.
**Enforcement update:** `packages/db/tests/schema-migration-parity.test.ts`
builds the database from the real migration files and compares it with the
schema in both directions: tables, CHECK constraints, and standalone
indexes. Each declaration is also built as a probe on that database, and
both sides are read back through `pg_get_indexdef` and `pg_get_expr`, so
Postgres normalises them. Predicates, expression keys, method, sort
direction and CHECK expressions are compared exactly, not just names.

It was starved on each side and went red under thirteen mutations. The
round-trip test's header is corrected.
