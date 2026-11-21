### 2026-08-11 — Make git hooks run in every new worktree and container

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-11.
**Why:** Husky installs its hooks only when `pnpm install` runs. Git's `core.hooksPath` is `.husky/_`, a folder that exists only after that install, so a fresh container or a new worktree runs no commit-msg, pre-commit or pre-push hook, and git does not warn. Seen again on 2026-11-19 in a worktree with no install. CI still checks PR titles and branch names, so this is a local gap, not a merge gap.
**How:**
1. Make `scripts/wt-new.sh` run `pnpm install` (or `pnpm exec husky`) in the new worktree.
2. Make the SessionStart hook in `.claude/settings.json` warn loudly when `.husky/_` is missing.
3. Starve it: delete `.husky/_` in a scratch worktree and confirm the warning prints.
**Verifies by:** In a brand-new worktree, `git commit -m "chore: no d trailer"` on a non-exempt branch exits non-zero.
**Who:** Engineering (an agent can do it)
**Status:** Open
