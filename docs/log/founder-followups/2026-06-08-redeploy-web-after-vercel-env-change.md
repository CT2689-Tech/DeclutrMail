### 2026-06-08 — Redeploy the web app after every Vercel env change

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-08.
**Why:** Next.js builds env values such as `NEXT_PUBLIC_*` into the web bundle, so a change in Vercel takes effect only at the next build. On 2026-06-08, an old API host stayed in the live bundle and broke sign-in. Today the deploy step "Bind live India billing env on Vercel" (`.github/workflows/deploy-cloud-run.yml:709-714`, `scripts/live-india-billing-env.mjs --vercel`) updates env without triggering a build. `docs/runbooks/secrets-inventory.md:331` notes the redeploy need for one key only.
**How:**
1. Check whether a value set by `live-india-billing-env.mjs` can miss the Vercel build that the same push already started.
2. Then do one of two things: have scripts that change Vercel env trigger a production redeploy, or add one rule to `docs/runbooks/secrets-inventory.md`: "After any Vercel env change, redeploy the latest production deployment."
**Verifies by:** After a test env change through the chosen path, a new production deployment serves the new value.
**Who:** Engineering (an agent can do it)
**Status:** Open
