### 2026-09-19 — Settle Brandfetch's terms for cached logos, or unbind the key

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-19.
**Why:** The production worker fetches and caches Brandfetch logos. ADR-0034 records that Brandfetch's general terms require a specific written agreement for cached delivery, and a developer key is not one. Stale Brandfetch bytes stop being served after 30 days but are never deleted from `domain_icons`.
**How:**
1. Read Brandfetch's current Brand API terms on caching and redistribution.
2. Either get written permission or a plan that covers caching, or ask an agent to unbind `brandfetch-api-key-prod` from the worker in `deploy-cloud-run.yml`.
3. If unbound, the same change removes the Brandfetch row from `/privacy` §8 and the `api.brandfetch.io` origin, or `external-origins.contract.spec.ts` fails.
**Verifies by:** ADR-0034 names the agreement or plan, or the worker no longer mounts the secret.
**Who:** Founder
**Status:** Open
