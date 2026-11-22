# `.claude/` — agent tooling for this repo

## Every product tool is `ct-<word>`

A product tool is anything built for working on DeclutrMail itself — a slash
command, a skill, or a workflow. Name it `ct-` plus one short word for the job
(`ct-qa`, `ct-journey`), a second word only when one is ambiguous. No product name in it; the prefix already says whose
it is. Typing `/ct-` lists them all.

| Tool                   | Kind           | File                                    | Use it to                                                            |
| ---------------------- | -------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `/ct-journey`          | command        | `commands/ct-journey.md`                | trace a real user: signup → scan → what they did → what broke        |
| `/ct-qa`               | command        | `commands/ct-qa.md`                     | drive one user job in the browser and try to break it                |
| `/ct-class`            | command        | `commands/ct-class.md`                  | turn one defect into a sweep of its whole class                      |
| `/ct-finding`          | command        | `commands/ct-finding.md`                | capture a founder observation into `FINDINGS.md`                     |
| `ct-gates`             | workflow       | `workflows/ct-gates.js`                 | run the CLAUDE.md §7 gate agents over a diff, verify BLOCKING items |
| `/ct-pr`               | command        | `commands/ct-pr.md`                     | list what a PR still needs checked by hand before merge              |
| `/ct-reddit`           | personal skill | `~/.claude/skills/ct-reddit/`           | draft a Reddit comment for a thread                                  |
| `/ct-orchestrate`      | personal cmd   | `~/.claude/commands/ct-orchestrate.md`  | run a session as tech lead for every parallel session                |

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
- The `pr-review-toolkit` plugin ships a generic agent with the same name
  (`pr-review-toolkit:silent-failure-hunter`). The
  plugin is per machine and knows nothing of the privacy rule, the action
  preview or the worker policies.
  Gates and `ct-gates` call the repo agents in `agents/`; use those.

## Hooks

`settings.json` registers only the PreToolUse blockers, each a cheap
single-pass check:

- `block-protected-files.sh` — no edits to secrets (`.env*`, keys,
  credential / service-account JSON) or `.git/`.
- `block-bypass-flags.sh` — no `git … --no-verify` / `--no-gpg-sign` /
  `commit.gpgsign=false`; the same text inside a quoted message passes.
- `block-destructive-cloud-ops.sh` — no destructive gcloud / gh / vercel /
  supabase / redis / migration ops, and psql `DROP` anywhere or
  `TRUNCATE` / `DELETE FROM` against a non-local DSN.

The guard hooks (`verify-no-body-storage`, `check-microcopy`,
`block-category-prediction`, `require-idempotency`, `check-raw-date-in-sql`)
are not registered here. CI runs them on every PR through
`scripts/run-guard-hooks.mjs`, whose `GUARDS` list is their one registration;
`node scripts/run-guard-hooks.mjs --base origin/main` runs them locally.
`hooks/test/check-microcopy.test.sh` runs from `scripts/run-guard-hooks.test.mjs`.

`launch.json` starts `web` (:3000) or `api` (:4000) from whichever checkout
runs it; `./scripts/dev-up.sh` brings up the full stack with the worker.
