# Senders V2 — Compose Filters + Action Closeout Hand-off

**Date:** 2026-06-04
**Branch:** `feat/d038-senders-v2-integration` (23 commits ahead of `main`)
**Spec:** `docs/spec/senders-v2.md` v1.2 (founder signed 2026-06-03)
**Status:** Phase 1 BE composite + Phase 2 FE PR-FE3 + D38 powerful filters all landed. Branch ready for stress-test → merge.

---

## Quick-resume command

```bash
git checkout feat/d038-senders-v2-integration
git pull
./scripts/dev-up.sh
pnpm --filter @declutrmail/web dev
```

Then dev test-login:

```
http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
```

---

## Session arc (founder-driven)

1. Closed out prior overnight handoff — Thread A (BE composite) + Thread B (FE PR-FE3) in one session
2. Search autosuggest + grid sort surface promoted
3. Sort dropdown w/ explicit 8 options (column × direction)
4. Filter scope diagnosed — the chip lie (`Active 30` was 30 of loaded 50, not mailbox)
5. Reading Room editorial prototype shipped to `/senders-lab-v2` (lab pattern repeat)
6. Founder pivoted to "smaller scope, greater effect, powerful filters"
7. D38 multi-axis compose strip landed direct on `/senders`
8. Sort promoted to a first-class compose axis chip

---

## What landed this session

### Thread A — BE close-out — `6e220fd`

- Manifest: `delete` LabelChange forward `{addLabelIds:['TRASH'], removeLabelIds:['INBOX']}`; reverse symmetric. Aligns local mirror with Gmail Trash semantics.
- `ActionLabelAppliedPayloadSchema` verb enum widened to `archive | later | delete`; carries `compositeId` for audit join.
- Undo types: `delete` payload kind (messageIds only — reverse `LabelChange` IS the restoration step; no `priorLabels`).
- Worker: `PIPELINE_COMPLETE_VERBS += later + delete`; generic `buildLabelMirrorExpr` derives the local-mirror UPDATE from any `LabelChange` (idempotent add via `CASE WHEN`, chained `array_remove`); `resolveSenderInboxIds` accepts `olderThanDays` and applies `internal_date <= now() - interval 'N days'`; `undoExpiresAt` returns 30d for delete regardless of tier (Gmail Trash physical guarantee).
- `ActionsService.enqueueComposite` — single-verb + composite via one path. Primary's `composite_id = NULL` (self-implicit via `id`); secondary's `composite_id = primary.id`. Namespaced idempotency keys.
- `ActionsService.previewComposite` — ONE aggregate produces sender context strip + all 4 time-window bucket counts + monthly via `count(*) FILTER (WHERE internal_date <= …)`.
- `ActionsService.enqueueCompositeRevert` — resolves siblings via `id = $primary OR composite_id = $primary`; enqueues reverse rows in primary-first order.
- Controller: `POST /api/actions` delegates to `enqueueComposite`; the 501 fallback retired.
- Undo controller: cascade-aware via `LABEL_MODIFY_UNDO_KINDS`.
- +13 tests (composite, preview, cascade, delete forward, olderThanDays narrowing).

### Thread B — FE PR-FE3 close-out — `7e85ba2`

- `ActionVerb` K/A/U/L → **K/A/U/L/D**; `SenderTableVerb += 'delete'`; `capabilities.delete: true`.
- `ConfirmActionModal` rewritten:
  - Delete primary: red tone + "Recoverable for 30 days in Gmail Trash" banner + default time-window 180d + red confirm.
  - Composite secondary chip row `[Leave alone | Archive them | Delete them]` for Unsub + Later primary.
  - Time-window chip row w/ per-bucket counts.
  - "Show what will move (5 of N) ▾" expand panel.
  - Confirm always names action: `🚫 Unsubscribe + 🗑 Delete 2,908`.
- `senders-screen.performAction` routes Delete + composite via `enqueueComposite`.
- Bulk-select-by-filter button on result-count strip.

### Docs + learnings — `5a117db`

- FOUNDER-FOLLOWUPS: PR-FE3 entry moved to Done; new Open entries: senders-lab-v2 cleanup, `oldestSubjects` BE endpoint.
- LEARNINGS: FILTER aggregates collapse N preview queries into 1; cascade-undo via `composite_id` walks at undo time, not issue time.

### Search autosuggest + grid sort surface — `2592fc8`

- BE: `GET /api/senders/suggest?q=&limit=8` — ILIKE on name/email/domain, ordered by `total_received DESC`, mailbox-scoped. Light shape (no correlated subqueries). Declared before `:id` route.
- FE: `useSenderSuggestions` hook (150ms debounce) + `SenderSearch` rewritten. Loaded-page filter stays as fallback while BE in flight.
- Result-count strip got a cycle button `sorted by total ↓` (later replaced by full menu).

### Grid sort menu — `7ebbc96`

- Cycle button replaced with dropdown menu w/ 8 explicit `(column × direction)` options grouped by column. Active marked `✓`. Trigger reads in plain language ("sorted by most emails ever ▾").

### Reading Room prototype — `c772b2d`

- Self-contained throwaway at `apps/web/src/app/senders-lab-v2/page.tsx` (~850 LOC).
- "Statement Bar" editorial design — hero number, click-to-edit token sentence, saved tabs, sparkbar.
- Founder reviewed, asked for smaller scope w/ more power instead.

### D38 powerful filters — `1c39da6`

- **BE** `GET /api/senders` + `getSenderListQueryMeta`:
  - `?activity=active|quiet|dormant` (+ `not-*` for negation)
  - `?unsub_ready=true|not` (predicate excludes `'none'` so count is realistic)
  - `?window=30d|90d|180d|365d` + bare number
  - `?domain=<substring>`
  - `?protected` widened to tri-state (`true|not|null`)
  - `meta.query.filterCounts` — mailbox-wide absolutes per axis via ONE aggregate w/ `COUNT(*) FILTER (WHERE …)`. Counts stable across compose.
  - Helpers: `buildActivityPredicate`, `parseActivity`, `parseTriState`, `parseWindow`.
- **FE** `compose-strip.tsx` + `use-compose-state.ts`:
  - 6 axes, AND across, multi-state per chip
  - Activity radio, toggle chips w/ tri-state (Alt-click/right-click negates → red outline + ✕)
  - Window + Domain popovers
  - URL-backed state via `useSearchParams` + `router.replace`; falls back to local state when AppRouterContext is absent (test renders)
  - Hero number (Fraunces italic 56px) replaces 3-cell KpiStrip
  - `senders-screen` retires `KpiStrip`, `FactChip` row, `factFilteredSenders`, `computeTotals`, `SenderTotals` interface, `isStandingProtected` import

### SORT chip joins compose — `7021f63`

- Sort lived in tiny inline summary text. Promoted to first-class axis chip next to Window / Domain.
- `(column × direction)` popover + grouping moved from inline `SortMenu` into `compose-strip.tsx` as `SortChip`.
- Summary line trimmed to `<N> senders match.` + select-all.
- Inline `SortMenu` renamed `_retiredSortMenu` so Phase 5 sweep can delete the dead body.

---

## What's NOT done

### Still on Phase 1 BE todo

1. **`senders.replied_count` column + worker write paths** — `repliedTo` count stubbed to 0 in `filterCounts`; FE chip shows 0 always until the column lands.
2. **`oldestSubjects` BE endpoint** — `ConfirmActionModal` "Show what will move" panel uses `sampleSubjects(sender)` fixture pool. Subject is allowlist-safe (D7); endpoint just hasn't been written. FOUNDER-FOLLOWUPS has it.
3. **Auto-protect on replied ≥ 3** rule — spec Decision canary fixture references this.
4. **`TOP SENDER` hotfix** — spec mentions, untouched.

### Still on Phase 2 FE todo (cleanup)

5. **Magnitude under-bar denominator** — `sender-card.tsx` divides by `/100` instead of `globalMaxTotal`. Visual fine on current fixture but wrong semantic. FOUNDER-FOLLOWUPS.
6. **`useWeeklyHero` observability port to Brief** — pending Brief surface.
7. **Lab deletion** — `rm -rf apps/web/src/app/senders-lab-v2/` (founder hands; agent perm denied earlier).
8. **CLAUDE.md §2.2 K/A/U/L → K/A/U/L/D distillation** — founder-only `chore/distill-` PR.

### Pre-launch sweep (Phase 5)

9. `intent.ts` + all `intentOf` / `groupByIntent` / `INTENT_META` / `INTENT_ORDER` machinery.
10. `KpiStrip` component itself (file remains; only the import retired from senders-screen).
11. `FactChip` component file.
12. `_retiredSortMenu` body block in senders-screen.
13. `SenderTotals` interface + `computeTotals` (already removed; ensure no other consumer).
14. Reading Room lab page (founder rm).
15. Stale Storybook stories for retired components.

### Architecture work pending (proposed, not landed)

16. **ADR-0021** — Sender brand/domain grouping. Drafted in chat (`Q: 148 Amazon senders confusing`). Not written to `docs/adr/`. Founder asked to brainstorm before commit.

---

## Testable surface (smoke matrix)

### A. Visual `/senders`

- Top row: search box + Grid|Table + Add VIP — unchanged
- Hero: `7,759 senders` Fraunces italic 56px (one editorial moment)
- ComposeStrip (one row, breathes):
  - `ACTIVITY` `active 515 · quiet 586 · dormant 6,658` (radio)
  - `☐ has unsub 2,229 · ☐ you replied 0 · ☐ protected 0` (tri-state toggles)
  - `QUIET FOR any time ▾ · DOMAIN any ▾`
  - `SORT Most emails ever ▾`
- Compose summary: `<N> senders match.` + `select all N [+]`
- Cards as before
- `clear filters [×]` appears when ANY filter active

### B. Filter interactions

- Click `active` → URL `?activity=active`, hero rolls 7,759 → 515, cards filter
- Click `has unsub` → URL adds `unsub_ready=true`, hero → 385
- Alt-click `protected` → URL adds `protected=not`, chip turns red w/ ✕
- Right-click also negates
- Click `QUIET FOR` → popover → pick `90d+` → URL adds `window=90`
- Click `DOMAIN` → popover → type `amazon` → URL adds `domain=amazon`
- Click `SORT` → 8-option menu grouped by Volume / Last seen / First seen / Name
- Click `clear filters [×]` → URL strips all compose params

### C. Sentence shape

- `<N> senders match.` — single Fraunces italic line, no sort word stutter
- Bulk-select toggles between `select all N [+]` and `deselect all N [⌫]`

### D. URL state shareable

- Paste `http://localhost:3000/senders?activity=active&unsub_ready=true&protected=not` → page boots with that scope already composed

### E. Composite confirm modal (Delete + secondary)

- Pick a sender → `⋯` → Delete → modal shows red eyebrow + "Recoverable for 30 days in Gmail Trash" + default `6 months+` chip + `🗑 Delete N` confirm
- Pick Unsub → modal shows secondary chip row `[Leave alone | Archive them | Delete them]`
- Pick "Delete them" → time-window chip row appears with real counts from composite preview (`2,908` for `All inbox`)
- Confirm button reads `🚫 Unsubscribe + 🗑 Delete 2,908`

### F. NOT testable yet

- Real Gmail Trash via Delete worker — needs founder hands + a low-stakes sender + Activity → Undo verification
- Composite secondary actually firing through worker — needs founder hands

---

## Known blockers / gotchas

### Atlas state

Migrations 0019-0021 (Delete enum + composite_id + delete-action-kinds) already in `atlas.sum` per `401129f`. The dev DB local stack reports "No migration files to execute" — confirm with:

```bash
psql $LOCAL_DATABASE_URL -c "\d action_jobs" | grep -E "composite_id|older_than_days"
psql $LOCAL_DATABASE_URL -c "SELECT unnest(enum_range(NULL::action_verb))"   # archive/later/delete
psql $LOCAL_DATABASE_URL -c "SELECT unnest(enum_range(NULL::undo_action_kind))"  # incl delete
```

Per CLAUDE.md §9 — production migration apply is founder hands.

### `repliedTo` stub

`filterCounts.repliedTo` returns 0 today. The chip on the compose strip will show `you replied 0` always until the `senders.replied_count` column lands. Document on the chip if it confuses dogfooders; otherwise leave silent.

### Pre-existing test failures (8) unrelated to this session

`senders-screen.test.tsx`:

- Weekly Hero rendering tests (D47, D48) — component retired
- "renders the editorial hero + KPI strip when the list resolves" — KPI strip retired by D38
- Summary-driven aggregates tests — KPI strip retired
- "hero N emails reached you" — hero copy moved to Brief per spec Decision 5

All assert removed surfaces. Phase 5 dead-code sweep retires the tests along with the components.

### Sort chip cosmetic

`SortChip` is "active" styled (border darkens) once the user picks anything other than the BE default `total ↓`. Doesn't render a `negate` state — sort has no "NOT this" semantic. Founder's first sort change paints the chip dark.

---

## Tracking files updated

- `FOUNDER-FOLLOWUPS.md` — PR-FE3 moved to Done; senders-lab-v2 cleanup + `oldestSubjects` BE endpoint added Open
- `LEARNINGS.md` — FILTER aggregates + cascade-undo via `composite_id` entries
- `MISTAKES.md` — no new entries (no gate fired)
- `IMPLEMENTATION-LOG.md` — auto-flips on merge

---

## Commit log (this session, last → first)

```
7021f63 feat(senders): SORT chip joins compose strip (D38)
1c39da6 feat(senders): multi-axis compose filter + BE-honest counts (D38)
c772b2d feat(senders-lab): "Reading Room" Statement Bar prototype (D38)
7ebbc96 feat(senders): grid sort menu — 8 explicit (column × direction) options (D38)
2592fc8 feat(senders): mailbox-wide search autosuggest + grid sort surface (D38)
5a117db docs: PR-FE3 done; FILTER-aggregates + cascade-undo learnings (D227)
7e85ba2 feat(senders): Delete primary + composite modal + bulk-select-by-filter (D38, D227)
6e220fd feat(actions): delete verb pipeline + composite executor + cascade undo (D227)
```

(8 commits this session on top of `fbe438d` — the prior handoff doc.)

---

## Next session — choose a thread

### Thread A — BE Phase 1 finish (recommended)

The compose chip row currently lies about `replied` (stub 0) and the modal "Show what will move" panel uses fixture subjects. Both are BE column / endpoint adds with a clean shape.

1. `senders.replied_count` column + worker write path (initial-sync `building_sender_index` + incremental ingest)
2. Auto-protect-on-replied ≥ 3 rule
3. `/api/actions/preview` carries `oldestSubjects: string[5]` per active window
4. FE wires both: `you replied N` chip count honest; modal panel swaps fixture for wire subjects

~1-2 days. Unblocks dogfood honesty on the compose strip + the modal trust signal.

### Thread B — ADR-0021 sender grouping brainstorm + design

148 Amazon senders is THE founder-observed friction. Grouping is the architectural answer but needs more shape:

1. Sketch the 3 group-identity options (domain auto / brand-curated / hybrid heuristic) on `/senders-lab-v2`
2. Define the heuristic boundaries (free-mail allowlist, publisher allowlist, machine-local-part regex)
3. Write `docs/adr/0021-sender-brand-grouping.md`
4. Founder picks → migration shape lands as D236

~half day brainstorm + 1 day prototype + ADR. Schema migration is its own PR.

### Thread C — Stress-test the branch → merge to main

23 commits ahead. Founder may want to stop iterating and ship what's solid.

1. Real Gmail Trash via Delete (founder hands)
2. Composite Later+Archive past via real worker (founder hands)
3. Cascade undo end-to-end
4. Multi-mailbox switch w/ active compose preserved (URL state behavior across active-mailbox change)
5. Cross-mailbox 404 + 409 gates
6. PR open + merge

~1 day smoke + merge.

### Thread D — Phase 5 dead-code sweep

Drop ~600 LOC of retired surfaces:

- `intent.ts` + all `intentOf` machinery
- `KpiStrip` component
- `FactChip` component
- `_retiredSortMenu` body
- Reading Room lab page
- Stale Storybook stories

Also drop 8 pre-existing failing tests for retired surfaces. ~half day. Lower risk than Threads A-C.

---

## Critical reminders for next session

- Spec v1.2 is the contract — re-read before changes that touch decisions D1-D15
- ADRs 0016-0020 signed; do not relitigate
- Migration apply = founder hands only (CLAUDE.md §9)
- CLAUDE.md K/A/U/L/D distillation = founder-only `chore/distill-` PR
- The pre-existing 8 failing senders-screen tests are NOT regressions — they assert retired surfaces. Don't chase them.
- Lab dir `apps/web/src/app/senders-lab-v2/` agent perm denied to delete; founder hands.
- Compose strip URL params: `activity / unsub_ready / window / domain / protected / replied`. Negation via `not-*` (activity) or `not` (booleans). Document if a new axis lands.
- `useComposeState` falls back to local state in test environments without AppRouterContext — do NOT mock the router in tests; the fallback is the affordance.
