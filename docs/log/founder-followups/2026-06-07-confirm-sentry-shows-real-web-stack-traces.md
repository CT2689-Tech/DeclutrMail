### 2026-06-07 — Confirm production web errors in Sentry show real source lines

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-07.
**Why:** The web build uploads source maps to Sentry (`withSentryConfig` in `apps/web/next.config.ts`, with `@sentry/cli` allowed to install in `pnpm-workspace.yaml`). No one has recorded a production error whose stack trace resolves to source files, and the 2026-09-05 observability note still lists that check as open. Without source maps, a browser error points to minified chunks and is hard to fix.
**How:**
1. Vercel → latest production deployment → Build logs: search for Sentry source-map upload output. If there is none, check `SENTRY_AUTH_TOKEN` in Vercel's production env.
2. Sentry → the web project → Issues → filter `environment:production` → open a recent error.
3. Expand the stack trace.
**Verifies by:** The frames show `apps/web/src/...` paths with line numbers, not `chunks/…js`.
**Who:** Founder
**Status:** Open
