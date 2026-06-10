# Senders V2 — Overnight Build Hand-off

**Date:** 2026-06-04
**Branch:** `feat/d038-senders-v2-integration` (13 commits ahead of `main`)
**Spec:** `docs/spec/senders-v2.md` v1.2 (founder signed 2026-06-03)
**Status:** Phase 1 BE partial + Phase 2 FE landed; integration branch awaiting stress-test before merge to `main`.

---

## Quick-resume command

```bash
git checkout feat/d038-senders-v2-integration
git pull
cd packages/db && atlas migrate hash && cd ../..
./scripts/dev-up.sh
pnpm --filter @declutrmail/web dev
```

Then dev test-login:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

---

## Spec contract (read first)

`docs/spec/senders-v2.md` v1.2 — 15 decisions + locks + 5-phase rollout.
Locks: fact-first cut · K/A/U/L/D · all-chips composite modal · unified `POST /api/actions` · mobile dialect.

ADRs landed this session:

- ADR-0016 — Senders visual language (Layer A + B)
- ADR-0017 — retire dashboard violet (supersedes ADR-0009)
- ADR-0018 — Senders mobile dialect (Phase 4 placeholder)
- ADR-0019 — Verb Registry + K/A/U/L/D (amends D227)
- ADR-0020 — unified actions endpoint, Option A composite
- ADR-0009 — marked Superseded

---

## What's done

### Shared primitives

- `packages/shared/src/components/numeric-display.tsx` — 4 variants (hero/display/stat/data), NaN guard → em-dash
- `packages/shared/src/components/action-popover.tsx` — keyboard nav, focus trap, role=menu
- `packages/shared/src/actions/verb-registry.ts` — VERB_REGISTRY w/ K/A/U/L/D + `deriveDefaultPrimary` fact rule
- Stories for all three

### DB schema

- Migration `0019_action_verb_delete.sql` (+ rollback) — `ALTER TYPE action_verb ADD VALUE 'delete'`
- Migration `0020_action_jobs_composite.sql` (+ rollback) — `composite_id` (nullable uuid self-FK) + `older_than_days` (CHECK 1-3650)
- Migration `0021_delete_action_kinds.sql` (+ rollback) — `'delete'` added to `undo_action_kind` + `activity_action`
- Drizzle schema: action-jobs.ts / undo-journal.ts / activity-log.ts updated
- Shared: `ACTION_VERBS += 'delete'`, `CANONICAL_SHORTCUTS += {delete:'D'}`, manifest-entries delete descriptor (TRASH labelIds)
- Types: `UndoActionKind` updated at 3 sites (`apps/api/src/undo`, `packages/shared/.../undo-tray`, switch label exhaustive default)

### FE Senders

- `sender-card.tsx` — NumericDisplay display variant, STATUS="You replied", magnitude under-bar (denominator drift logged), emerald protected dot, ActionPopover `⋯`, `capabilities.delete:false` until PR-FE3
- `data.ts` — `Sender.repliedCount?: number`
- `senders-screen.tsx` — `FACT_CHIPS`, `matchFactChip`, `factFilteredSenders`, FactChip, result-count strip; removed WeeklyHeroLive/InboxStoryHero/WeeklyProgress/CohortRail + inferred KPI cells; keydown guard for `[role="menu"]`
- `confirm-action-modal.tsx` — `olderThanDays`, TIME_WINDOW_PRESETS, sender context strip
- `detail/sender-detail-page.tsx` — removed "Estimated reading cost" + "Reading cost" KPI + unused vars
- `sender-table.tsx`, `detail/header.tsx`, `stats-strip.tsx`, `uplift-d/kpi-strip.tsx` — NumericDisplay port
- `triage/action-preview.tsx` + `data.ts` — "RFC 8058" jargon retired

### BE API

- `actions.types.ts` — composite Zod schemas (primary K/A/U/L/D subset, secondary archive|delete, time-window 1-3650)
- `actions.controller.ts` — `POST /api/actions` (single Archive → delegate; else 501 COMPOSITE_NOT_IMPLEMENTED); `GET /api/actions/preview` (sender ctx + bucket counts stubbed=all)

---

## What's NOT done (pending work)

### Phase 1 BE

1. **Composite service executor** — `enqueueComposite` handling primary=Delete + secondary
2. **Delete worker dispatch** — `messages.trash` in `label-action.worker.ts`
3. **Per-bucket count query** — `SELECT count(*) FILTER (WHERE internal_date <= …)` in `previewComposite`
4. **Composite cascade undo** — undo flow via `composite_id` index

### Phase 2 FE

5. **PR-FE3 finish:**
   - composite secondary verb chip row in ConfirmActionModal
   - "Show what will move" expand panel
   - bulk-select-by-filter
   - Delete callback widening on SenderCard (flip `capabilities.delete:true`)

### Cleanup / observability

6. **Magnitude bar denominator** — currently `/100`, should be `/globalMaxTotal`
7. **useWeeklyHero observability** port to Brief
8. **Mobile dialect** (ADR-0018, Phase 4, post-launch ok)
9. **CLAUDE.md §2.2 distillation** K/A/U/L → K/A/U/L/D (founder-only `chore/distill-` PR)
10. **Lab deletion** — `rm -rf apps/web/src/app/senders-lab-v2/` (founder hands)
11. **Phase 5 dead-code sweep** — `intent.ts`, per-verb endpoints, unused `detail/header.tsx` + `stats-strip.tsx`

---

## Testable surface (smoke matrix)

### A. Visual `/senders` (no BE)

- KPI strip = 3 cells: Senders / Active / Protected
- 7 fact-chips render; each filters grid + result-count updates
- No editorial hero / WeeklyProgress / CohortRail
- Cards: rounded-sq avatar, 28px Fraunces volume, "Opened/Last seen/You replied", under-bar, `⋯`
- `⋯` opens ActionPopover w/ K/A/U/L/D (D disabled)
- ESC closes; click-outside closes; arrow nav; K/A/U/L shortcuts trigger
- Archive in popover → ConfirmActionModal: context strip + time-window chip row; "6 months+" → "Acts on mail older than 180 days"

### B. Visual `/senders/:id`

- NO "Estimated reading cost: X min/month"
- NO "Reading cost" KPI cell
- Fraunces "Mails you 2×/mo. You read 0%" stays
- Chrome continuity vs `/senders`

### C. Visual `/triage`

- Unsubscribe preview drops "RFC 8058" → "one-click unsubscribe"

### D. BE wire (after `atlas migrate hash` fix below)

- `curl POST /api/actions` composite Archive body → 200
- `curl POST /api/actions` Delete body → 501 `COMPOSITE_NOT_IMPLEMENTED`
- `curl GET /api/actions/preview?senderId=<uuid>` → sender ctx + counts (stubbed=all)

### E. NOT testable

- Real Delete (worker not wired)
- Composite secondary (executor not wired)
- Composite cascade undo

---

## Known blockers / gotchas

### Atlas checksum mismatch (hit at session end)

```
atlas migrate hash
Error: sql/migrate: stat migrations: no such file or directory
```

Run from `packages/db/`, not repo root:

```bash
cd packages/db && atlas migrate hash
```

Migrations 0019/0020/0021 lack a refreshed `atlas.sum`. Inspect diff — should touch only those three lines. If more lines change → STOP, surface (might mean older migrations also drifted).

### Migration application — founder hands only

Per CLAUDE.md §9 stop-condition (production migrations). Even on dev DB, founder runs:

```bash
./scripts/db-migrate.sh apply
```

### SenderCard Delete silent-route fix

Found by design-system-agent. `capabilities.delete:false` set until PR-FE3 widens callback. Otherwise Delete fires Archive (BLOCKING).

### Magnitude bar denominator drift

`sender-card.tsx` divides by `/100` instead of `globalMaxTotal`. Visual harmless on current fixture but wrong semantic — logged FOUNDER-FOLLOWUPS.

### Lab deletion permission

`apps/web/src/app/senders-lab-v2/` — founder must `rm -rf` (agent perm denied).

---

## Tracking files updated

- `FOUNDER-FOLLOWUPS.md` — 4 new Open entries (CLAUDE.md distillation, PR-FE3, magnitude drift, useWeeklyHero observability)
- `LEARNINGS.md` — visual-language consolidation pattern entry
- `MISTAKES.md` — no new entries (no gate fired)
- `IMPLEMENTATION-LOG.md` — auto-flips on merge

---

## Next session — choose one of two threads

**Thread A — BE complete first** (recommended; unblocks Delete end-to-end):

1. `enqueueComposite` service-layer executor (handle Delete primary + secondary)
2. Delete worker dispatch (`messages.trash`)
3. Per-bucket count query in `previewComposite`
4. Composite cascade undo via `composite_id`

**Thread B — FE PR-FE3 finish** (unblocks visible product surface):

1. Composite secondary verb chip row in ConfirmActionModal
2. "Show what will move" expand panel
3. Bulk-select-by-filter
4. SenderCard Delete callback widening (flip `capabilities.delete:true`)

Founder picks. Either runs against same branch `feat/d038-senders-v2-integration` until ready for stress-test → merge to `main`.

---

## Commit log (this session, last → first)

```
6fbe5c7 feat(actions): unified POST /api/actions composite endpoint skeleton (D227)
[+12 prior commits — see `git log feat/d038-senders-v2-integration ^main`]
```

---

## Critical reminders for next session

- Spec v1.2 is the contract — re-read before changes that touch decisions D1-D15
- ADRs 0016-0020 are signed; do not relitigate without founder
- `capabilities.delete` flip = PR-FE3 scope, not a one-line drive-by
- Migration app = founder hands only (CLAUDE.md §9)
- CLAUDE.md K/A/U/L/D distillation = founder-only `chore/distill-` PR (CLAUDE.md §11)
