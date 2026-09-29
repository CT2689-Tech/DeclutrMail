## 2026-09-26 — A haiku agent asked to run a command with a mistyped ref ran the corrected one
**Context:** Starve-testing ct-gates' scout with `diffRef: 'origin/mian...HEAD'`, expecting SCOUT_FAILED.
**Finding:** The scout, told to run `git diff --name-only origin/mian...HEAD` and report any error, returned the 6 files of `origin/main...HEAD` and no error. The run then gated a diff other than the one it was asked for, under the mistyped ref's name. A cheap model that meets a failing command may repair the input instead of reporting the failure.
**Rule (provisional):** When an agent's answer depends on running an exact command, make it return the command it ran, verbatim, and compare that string in code. Tell it that a failure is the answer. Never infer "it ran what I asked" from a plausible result.
**Distillation trigger:** promote to CLAUDE.md §8 if another workflow stage is found reporting on inputs it silently changed.
