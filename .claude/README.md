# `.claude/` — agent tooling for this repo

## Every product tool is `ct-<word>`

A product tool is anything built for working on DeclutrMail itself — a slash
command, a skill, or a workflow. Name it `ct-` plus one short word for the job
(`ct-qa`, `ct-journey`), a second word only when one is ambiguous
(`ct-gates-verify-test`). No product name in it; the prefix already says whose
it is. Typing `/ct-` lists them all.

| Tool                   | Kind           | File                                    | Use it to                                                            |
| ---------------------- | -------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `/ct-journey`          | command        | `commands/ct-journey.md`                | trace a real user: signup → scan → what they did → what broke        |
| `/ct-qa`               | command        | `commands/ct-qa.md`                     | drive one user job in the browser and try to break it                |
| `/ct-class`            | command        | `commands/ct-class.md`                  | turn one defect into a sweep of its whole class                      |
| `/ct-finding`          | command        | `commands/ct-finding.md`                | capture a founder observation into `FINDINGS.md`                     |
| `/ct-decide`           | command        | `commands/ct-decide.md`                 | surface every open decision that needs the founder                   |
| `/ct-status`           | command        | `commands/ct-status.md`                 | summarise a session in product terms                                 |
| `ct-gates`             | workflow       | `workflows/ct-gates.js`                 | run the CLAUDE.md §7 gate agents over a diff, verify BLOCKING items |
| `ct-gates-verify-test` | workflow       | `workflows/ct-gates-verify-test.js`     | regression-test the `ct-gates` refuters                              |
| `/ct-pr`               | local skill    | `skills/ct-pr/` (per machine)           | list what a PR still needs checked by hand before merge              |
| `/ct-reddit`           | personal skill | `~/.claude/skills/ct-reddit/`           | draft a Reddit comment for a thread                                  |

## Where a new one goes

- **Shared with every checkout and worktree** → `commands/ct-<word>.md`. This
  is the default. Supporting code goes in `scripts/` with a `node --test` file
  wired into `ci.yml`, like `scripts/journey-logs.mjs`.
- **Multi-agent fan-out** → `workflows/ct-<word>.js`.
- `skills/` is gitignored and per machine (third-party installs, personal
  experiments). Nothing there reaches another worktree.

## Not renamed, on purpose

- `agents/` — the gate and review subagents keep role names
  (`privacy-auditor`, `defect-class-sweeper`, …). CLAUDE.md §7 and the
  commands above call them by those names.
- Third-party skills (`caveman*`, plugin skills) keep their upstream names.
