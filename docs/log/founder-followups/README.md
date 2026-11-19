# Founder follow-ups

One file per entry. The old root `FOUNDER-FOLLOWUPS.md` was triaged and deleted
on 2026-11-19: entries still open moved here; read the rest with
`git show cb785809:FOUNDER-FOLLOWUPS.md`.

When to add one: CLAUDE.md §11.

Name the file `YYYY-MM-DD-<kebab-slug>.md`. It holds one entry in this format:

```markdown
### YYYY-MM-DD — Short title
**Source:** <PR #N | session | review finding | external ask>
**Why:** what this unblocks or fixes
**How:** the literal steps the founder takes (URL when applicable)
**Verifies by:** how we know it's done (signal that returns to green / log line / config visible)
**Who:** Founder | Engineering (an agent can do it) — optional
**Status:** Open | Done <YYYY-MM-DD> | Skipped <YYYY-MM-DD> + reason
```

The status changes by editing that entry's own **Status:** line, not by moving
the entry anywhere. Entry files are never deleted (the trail matters).

Open items in this directory:
`grep -rl --exclude=README.md '^\*\*Status:\*\* Open' docs/log/founder-followups`
