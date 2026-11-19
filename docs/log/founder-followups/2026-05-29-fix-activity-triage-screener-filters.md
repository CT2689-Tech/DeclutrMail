### 2026-05-29 — Make Activity's Triage and Screener filters match real rows

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-05-29.
**Why:** Activity's source filter offers Triage and Screener (`apps/web/src/features/activity/activity-filter-fields.tsx:33`). But every user action, from Triage and Screener too, is written with `source: 'manual'` (`apps/api/src/actions/actions.service.ts`, for example line 1570), and the read side only tells manual from autopilot (`apps/api/src/activity/activity.read-service.ts:347`). So those two filters likely show nothing new. Autopilot already writes its own source.
**How:**
1. Verify first: in dev, act on a sender from Triage and from Screener, then filter Activity by each source.
2. If they come back empty, pick one: pass the surface into `ActionsService` and write `triage` or `screener` (and teach the execution-row merge those sources), or remove the two filter options. Removing is smaller and fits ADR-0042.
3. Drop the old plan to add `senders` and `brief` sources unless step 2 keeps per-surface sources.
**Verifies by:** each remaining filter option returns a non-empty, distinct set of rows in a seeded smoke, or the option is gone.
**Who:** Engineering (an agent can do it)
**Status:** Open
