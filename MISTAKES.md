# Mistakes — DeclutrMail

Append-only log of mistakes and the rules added so we never repeat them.

See CLAUDE.md §11. Append when a gate fires, a bug ships and is caught
later, or an approach turns out wrong.

## Entry format

```markdown
## YYYY-MM-DD — Short title
**PR:** #NNN (link)
**Caught by:** <gate name | manual test | user report | production>
**What happened:** factual description
**Correct approach:** what should have been done
**Rule:** <one-line, immediately actionable>
**Enforcement update:** <hook change | agent prompt update | CLAUDE.md edit | none>
```

---

<!-- Entries go below. Newest at the top. -->

## 2026-05-20 — packages/ui scaffolded against D173
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** session review (PR 3 prep)
**What happened:** PR 1 scaffolded a `packages/ui` workspace package
(`@declutrmail/ui`). D173 explicitly rejects it: *"packages/ui — only one
consumer (apps/web) at launch, doesn't earn package status."* The plan's
canonical shared package is `packages/shared` (D173, D198, D199, D210, D220 —
hooks, components, tokens, copy, types, Zod schemas).
**Correct approach:** Scaffold `packages/shared` per D173, not `packages/ui`.
**Rule:** Before creating a workspace package, confirm its name against the
plan's structure decisions (D173).
**Enforcement update:** none — one-off scaffold error; renamed to
`packages/shared` in this PR.
