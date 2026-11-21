### 2026-08-27 — Fail the web build when rendered copy contains `undefined`

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-27.
**Why:** PR #651 fixed a literal `undefined` that real users saw inside the D226 preview copy. The value was right in Node and wrong only after Next's `optimizePackageImports` rewrite (still on, `apps/web/next.config.ts:47`), so no unit test can see this kind of bug. Nothing checks the build output for it today.
**How:**
1. Add a second pass to `scripts/check-web-bundle-budget.mjs` (it already reads `.next` after a build): scan each route's chunks for `undefined`, `NaN` or `[object Object]` inside string literals that also hold prose, and fail on a hit.
2. Starve it first: an empty or missing `.next` must exit non-zero and say why (CLAUDE.md §8.4).
3. Negative control: on a branch, revert the #651 import change; the check must fail. Restore it; the check must pass.
4. Related: `docs/log/founder-followups/2026-09-27-make-the-bundle-budget-a-required-check.md`.
**Verifies by:** the negative control in step 3, and the new pass running in CI's web build.
**Who:** Engineering (an agent can do it)
**Status:** Open
