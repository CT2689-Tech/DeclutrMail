## 2026-10-12 — Queue ignore status lands on the base SHA

**Context:** `scripts/ensure-vercel-queue-preview.mjs` failed runs 38283948924 and 38290639082 with "Existing queue preview failed or was cancelled" while the queue deployment was `CANCELED`.

**Finding:** Vercel did not post `Canceled by Ignored Build Step` on the queue SHA. Queue SHA `63170ac4ba2727fc312ed32c87e4e646c5f6bb35` had no commit statuses; the parent SHA `0f20c443805cc6aa4b534c76d6c71b5b058f730f` carried that success. At the earlier failure, queue SHA `0f20c443805cc6aa4b534c76d6c71b5b058f730f` also had no Vercel status yet.

**Rule (provisional):** A `CANCELED` queue deployment whose latest `Vercel` status is not `failure` or `error` is the ignore step. A Vercel failure/error status, or any other terminal deployment state, still fails the job.

**Distillation trigger:** promote to CLAUDE.md §X if pattern recurs ≥3 times
