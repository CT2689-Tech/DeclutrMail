# Mistakes

One file per entry. Entries written before 2026-09-27 stay in the frozen
[`MISTAKES.md`](../../../MISTAKES.md) at the repo root.

When to add one: CLAUDE.md §11.

Name the file `YYYY-MM-DD-<kebab-slug>.md`. It holds one entry in this format:

```markdown
## YYYY-MM-DD — Short title
**PR:** #NNN (link)
**Caught by:** <gate name | manual test | user report | production>
**What happened:** factual description
**Correct approach:** what should have been done
**Rule:** <one-line, immediately actionable>
**Enforcement update:** <hook change | agent prompt update | CLAUDE.md edit | none>
```
