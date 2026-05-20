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

## 2026-05-20 — Rename recon used an extension-filtered grep, missed config files
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** broad verification grep (later in the same session)
**What happened:** Scoping the `packages/ui` → `packages/shared` rename, the
recon `grep` used `--include=*.json --include=*.ts --include=*.tsx
--include=*.mjs --include=*.js --include=*.md --include=*.yaml`. It excluded
`.sh` and (by extension-name) `.yml`. The plan therefore claimed "no source
imports to update" and scoped the change to one agent file. The post-rename
verification grep (no filter) then found four more path refs: `subagent-gate.yml`
(`design` paths-filter), `require-preview-before-mutation.sh` (functional scope
glob), `check-microcopy.sh` (comment). The `subagent-gate.yml` one would have
silently disabled the design-system-agent gate on PR 3 — the opposite of the
PR's purpose.
**Correct approach:** Recon for a rename/move must grep the whole tree with no
`--include` filter. CI workflow YAML, shell hooks, and agent configs all
reference paths and are invisible to source-only greps.
**Rule:** When renaming or moving any path/package, grep unfiltered first —
`grep -rn '<oldpath>' --exclude-dir=node_modules --exclude-dir=.git .` — before
scoping the change. Never scope a rename off an extension-filtered grep.
**Enforcement update:** none — behavioral rule; promote to CLAUDE.md §1.3 if a
path-rename recon miss recurs.

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
