# CodeQL Bootstrap

This directory exists ONLY to give CodeQL a non-empty TypeScript file
to analyze during the pre-monorepo bootstrap phase.

**Delete this entire directory in PR 1** when `apps/web`, `apps/api`,
and `packages/*` land with real TypeScript source.

## Why this is needed

The repository ruleset `protect main` requires CodeQL Code Scanning
results on every PR (severity threshold: high_or_higher). CodeQL's
`javascript-typescript` language analyzer fails with
"could not process any code" if the repo contains zero non-empty
JS/TS files — and during bootstrap (sessions 1-3) the repo has only
markdown, shell, and JSON.

The single file `anchor.ts` here is enough for CodeQL to:

1. Find a non-empty TS file
2. Extract it into the CodeQL database
3. Run the security-and-quality query suite (0 findings expected)
4. Upload a SARIF result that satisfies the ruleset rule

## Removal in PR 1

When PR 1 lands `apps/web/src/...` with real TypeScript code, this
entire directory and its files become redundant. Remove them in PR 1's
diff so the repo has only one source of truth for what's bootstrap
versus real.
