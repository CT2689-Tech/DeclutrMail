## 2026-10-12 — A shell read under loading.tsx hydrates the page against an empty query

**Context:** Production `/billing` threw React #418 on a live Pro complimentary account. The server HTML was the plan. The first client render was the loading placeholder.

**Finding:** `HydrationBoundary` applies a query that already exists only in an effect. `billing/loading.tsx` lets the shell commit and run effects while the page is still streaming. `AccessDeadlineBanner` then started `GET /api/billing/subscription`, so the page hydrated against that pending query instead of the dehydrated success snapshot.

**Rule (provisional):** Do not start a query from the shell that a streamed page hydrates. If a pending query has no data and the snapshot is a success, replace it before the page's children render.

**Distillation trigger:** promote to CLAUDE.md §8 if another streamed page hydrates against a shell-seeded query.
