# Founder follow-ups

One file per entry. Items already listed in the frozen
[`FOUNDER-FOLLOWUPS.md`](../../../FOUNDER-FOLLOWUPS.md) at the repo root keep
being tracked there until Done.

When to add one: CLAUDE.md §11.

Name the file `YYYY-MM-DD-<kebab-slug>.md`. It holds one entry in this format:

```markdown
### YYYY-MM-DD — Short title
**Source:** <PR #N | session | review finding | external ask>
**Why:** what this unblocks or fixes
**How:** the literal steps the founder takes (URL when applicable)
**Verifies by:** how we know it's done (signal that returns to green / log line / config visible)
**Status:** Open | Done <YYYY-MM-DD> | Skipped <YYYY-MM-DD> + reason
```

The status changes by editing that entry's own **Status:** line, not by moving
the entry anywhere. Entry files are never deleted (the trail matters).

Open items in this directory:
`grep -rl --exclude=README.md '^\*\*Status:\*\* Open' docs/log/founder-followups`
