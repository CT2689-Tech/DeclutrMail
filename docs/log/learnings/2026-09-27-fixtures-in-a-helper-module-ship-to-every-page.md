## 2026-09-27 — Fixtures in a helper module ship to every page that imports a helper

**Context:** Trimming Triage's first-load JS after #792 pushed it over its budget.

**Finding:** `features/triage/data.ts` held both the row helpers every triage surface imports (`canArchive`, `lastSeenLabel`) and the D133 demo fixtures, which it computed at module load by running the real engine. `apps/web` declares no `sideEffects`, so webpack keeps a module whole once anything imports from it. Triage was shipping the engine, its template copy and fifteen fixture senders: one 3.7 kB gzipped module, more than five times what #792 added. It was found without an analyzer. The route's chunks were diffed between two builds, and the chunk that grew was split per module with `acorn`: each webpack module is one key of the chunk's object literal.

**Rule (provisional):** Keep fixtures, demo data and anything computed at module load out of modules that production code imports for helpers or types; give them a file of their own. To find first-load weight, diff a route's chunk sizes between builds, then split the chunk that moved per module.

**Distillation trigger:** promote to CLAUDE.md §8 "Performance measurement discipline" if another budget regression traces to a module imported for one helper.
