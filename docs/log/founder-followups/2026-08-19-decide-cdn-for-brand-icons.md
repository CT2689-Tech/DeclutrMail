### 2026-08-19 — Decide whether to put a CDN in front of brand icons

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-19.
**Why:** `GET /api/icons/:domain` answers `Cache-Control: public` so a shared cache can hold each logo, but nothing fronts `api.declutrmail.com`; it is Cloud Run direct (`apps/api/src/icons/icons.controller.ts:26-31`). Every first view of every logo costs a request to an API capped at 3 instances of 1 vCPU (`.github/workflows/deploy-cloud-run.yml`). Only the icon route needs a CDN; the rest of the API is per-user.
**How:**
1. Check in GCP: Cloud Run request counts for `/api/icons/*` against total API requests, to see whether icons are a real load.
2. Decide whether that is worth a monthly load balancer + Cloud CDN bill now.
3. If yes, an agent writes a setup script for an external HTTPS load balancer with Cloud CDN on the icon path only; you run it with GCP credentials.
**Verifies by:** a repeat `curl -I https://api.declutrmail.com/api/icons/chase.com` from a cold client shows a CDN hit (for example `age:` > 0), and Cloud Run counts for `/api/icons/*` drop while page views hold steady.
**Who:** Founder
**Status:** Open
