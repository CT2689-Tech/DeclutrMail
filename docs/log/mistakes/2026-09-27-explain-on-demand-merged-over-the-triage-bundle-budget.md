## 2026-09-27 — Explain on demand merged over the Triage bundle budget, and blocked every deploy

**PR:** #792 (https://github.com/CT2689-Tech/DeclutrMail/pull/792); fixed on branch `fix/d024-triage-first-load-budget`

**Caught by:** CI ("Build — Web + bundle budget"), after the merge

**What happened:** #792 added 0.7 kB (gzipped) of client code to Triage's first load, which sat 0.13 kB under its 206 kB budget. Before opening the PR I ran typecheck, lint, every affected suite and a live smoke, but never a production web build and `scripts/check-web-bundle-budget.mjs`, the only check that measures first-load JS. The budget job is not a required check, so auto-merge took the PR through red. `deploy-cloud-run`'s await-ci step then refused bb13eb79 and every later commit on main, so the API and worker stayed on #790 while Vercel shipped the web half.

**Correct approach:** for any change that adds client code to an app route, run `pnpm --filter @declutrmail/web build` with no `NEXT_PUBLIC_*` set, then `node scripts/check-web-bundle-budget.mjs`, and read the touched routes' margin before opening the PR.

**Rule:** A web change is not verified until the bundle budget has run on a CI-exact build. A red check that is not required can still block every deploy.

**Enforcement update:** none in code. Whether the budget job becomes a required check is the founder's call (founder follow-up 2026-09-27).
