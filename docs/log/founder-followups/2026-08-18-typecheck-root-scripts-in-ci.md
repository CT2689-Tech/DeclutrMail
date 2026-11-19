### 2026-08-18 — Typecheck the root scripts in CI

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-18.
**Why:** `pnpm typecheck` (package.json:12) checks only the packages under `apps/` and `packages/`. The root `tsconfig.json` covers `scripts/**/*.ts`, but nothing runs it, and `tsx` skips type checks. Type errors in watchdog and release scripts therefore pass CI and break only at runtime. Three such errors existed on 2026-08-18.
**How:**
1. Add `"typecheck:scripts": "tsc --noEmit -p tsconfig.json"` to the root `package.json`, and make `typecheck` run it after the package checks.
2. Run it, then fix every error it reports in `scripts/*.ts`.
3. Confirm the CI `typecheck` job (`.github/workflows/ci.yml`) still runs `pnpm typecheck`, so it picks up the new check.
**Verifies by:** Add a deliberate type error to one `scripts/*.ts` file: `pnpm typecheck` fails. Revert it and the check passes.
**Who:** Engineering (an agent can do it)
**Status:** Open
