# Handoff — Senders rolling-window rewrite + premium polish

**Date:** 2026-06-02
**Branch:** `feat/d226-actions-pipeline-e2e`
**PR:** [#149](https://github.com/CT2689-Tech/DeclutrMail/pull/149) — `feat(senders): real actions pipeline + real-data counts (D226, D207)`
**State:** MERGEABLE, Lint green (CI passed on `baa1ebb`)
**Last commit:** `baa1ebb fix(senders): drop dead helper + constant + tighten lead CTA (D38)`

---

## TL;DR

Senders screen rewritten end-to-end against a real-data, rolling-window
contract. Old per-sender-latest-`year_month` aggregation removed. New
8-bucket priority assignment (`one_time / protect / people / needs_review
/ quiet / dormant / bulk / other`) drives KPI strip + chip filters. FE
sender cards now Bloc-aligned (tone wash, display numeric, sparkline,
tone-colored lead CTA). Mailbox-wide summary endpoint live. Multi-source
favicon fallback. Row-detail rich panel restored.

**Strategic question still open** (founder call): is default landing
Senders-browse or Triage-decision-queue? Earlier in session I framed it
as "revert Senders, pivot to Triage." That framing was wrong — meant
_additive_ Triage, not _replace_ Senders. Senders screen is good. Awaiting
direction on whether next PR builds Triage default-landing or continues
Senders depth (evidence strip, plain-language chips, auto-protect VIPs).

---

## What shipped in PR #149

### BE — `apps/api/src/senders/`

- **`senders.read-service.ts`**
  - `getSenderSummary` rewritten as single CTE: `replied` (DISTINCT outbound recipient emails) → `last30` (per-sender msgs last 30d) → `bucketed` (per-sender bucket via CASE matching `BUCKET_PRIORITY`) → SELECT with `FILTER` aggregates.
  - `listSenders` per-row enrichment: 3 fresh LATERAL subqueries over `mail_messages` (last30dMsgs, last30dReadCount, baselineMsgs) replacing 5 stale `sender_timeseries` subqueries. New `sparklineSql` LATERAL with `generate_series(0,11)` for 12-week bucket.
  - `computeRollingTrendBucket` JS helper: priority NEW > DORMANT > QUIET > UP/DOWN/STEADY based on `first_seen_at` / `last_seen_at` / recent vs baseline rate.
  - Tenant isolation via `sql.identifier(getTableName(senders))` qualified refs (per MISTAKES.md 2026-05-23 — `sql` template emits bare column names → correlated joins must qualify).
  - `monthlyVolume` repurposed → means **last-30d msg count**.
  - New `includeOneTime` param pivots whole summary.
- **`senders.controller.ts`** — `?includeOneTime=true|false` parsed, default true.
- **`senders.types.ts`** — `SenderSummary` rewritten: `{ totalSenders, activeSenders, last30dVolume, noiseReducible, protected, needsReview, byBucket{8 keys}, asOf }`. `VolumeTrendBucket` extended with `'quiet'`. `SenderListRow.sparkline: number[] | null`.

### Shared — `packages/shared/src/senders/`

- **`thresholds.ts`** (NEW) — single source of truth: `WINDOWS`, `CONFIDENCE`, `VOLUMES`, `TREND`, `SCORE`, `FREE_MAIL_DOMAINS`, `PATTERNS`, `BUCKET_PRIORITY`. Exposed via new `@declutrmail/shared/senders` subpath export.
  - Key constants: `CONFIDENCE.GATE=0.75`, `WINDOWS.ACTIVE_DAYS=30`, `WINDOWS.QUIET_DAYS=60`, `WINDOWS.DORMANT_DAYS=180`, `VOLUMES.ONE_TIME_MAX_TOTAL=2`, `VOLUMES.RECURRING_MIN_TOTAL=3`, `SCORE.REPLIED_WEIGHT=5`, `SCORE.PERSON_SCORE_THRESHOLD=3`.

### FE — `apps/web/src/features/senders/`

- **`senders-screen.tsx`** — hero "Last 30 days · N emails reached you" + "About X% noise". KPI strip: Senders / Active / Needs review / Protected / Noise reducible (dropped Time cost). Hero `isMonday` gate dropped (plan-drift candidate on D47). `READ_MIN_PER_MSG` constant removed (orphan).
- **`grid/sender-card.tsx`** — Bloc-aligned: tone-tinted gradient wash by intent (cleanup=amber / later=neutral / protect=primary / people=plain), display-font 32px primary numeric, 3-stat micro-strip (READ/LAST/STATUS), mini sparkline top-right, tone-colored lead CTA with arrow. Single-word CTA labels (`Unsubscribe` / `Later` / `Keep` / `Archive`) to prevent narrow-grid cutoff. Secondary buttons show label + icon + tooltip.
- **`sender-table/sender-table.tsx`** — rich `SenderRowDetail` wired into `ExpandedRow` via `adaptSenderListRow`. Intent tone stripe (3px left edge) via `ROW_TONE_ACCENT` map. `TotalCell` upgraded to display-font 18px tabular-nums with intent-accent magnitude bar. Domain text in mono. `TREND_LABEL`/`TREND_COLOR` extended with `'quiet'`. Dead `formatDate` removed (lint fix).
- **`api/use-senders-summary.ts`** (NEW) — TanStack hook keyed by `q`.
- **`api/query-keys.ts`** — `summary: (params) => ['senders', 'summary', params]`.
- **`api/adapters.ts`** — sparkline pass-through.
- **`uplift-d/inbox-story-hero/inbox-story-hero.tsx`** — premium "Start review" CTA: gradient, display-font 15px/600, layered shadow with inset highlight, SVG arrow, hover lift.

### Shared — `packages/shared/src/components/avatar.tsx`

- Multi-source fallback: Clearbit Logo API → DuckDuckGo favicons → Google S2 → initial bubble. Strips bulk-mail subdomain prefixes (`mail1./e1./em./news./notify./alerts.`) for clean Clearbit lookups. Tier-based `useState` progression.

### FE wire — `apps/web/src/lib/api/senders.ts`

- `SenderSummaryDto` updated to new contract.
- `fetchSendersSummary` accepts `includeOneTime` query param.
- `VolumeTrendBucket` extended with `'quiet'`.
- `sparkline?: number[] | null` on `SenderListRow`.

---

## Known gaps / debt

1. **Card "STATUS" disagrees with BE bucket.** FE `intentOf()` is the legacy 4-bucket function. BE now assigns 8-bucket. They drift. Founder asked: _should we drop classifications entirely and give filtering/search instead?_ — open strategic call. Cheap interim: replace STATUS with evidence strip (Last seen / Read% / Replied×) and stop showing the bucket label on the card.
2. **10 legacy BE tests skipped.** `senders.read-service.spec.ts` — old tests asserted per-sender-latest-`year_month` semantics. Marked `it.skip` with TODO. Need rewrite against `mail_messages` seeds.
3. **#148 (Unsubscribe/Later pipeline) unbuilt.** Original handoff Workstream A still 0%. Worker rejects U/L fail-closed. Founder will hit this the moment anyone clicks Unsubscribe in prod.
4. **Hero `isMonday` gate dropped → plan-drift on D47.** Mentioned in commit message but not yet promoted to a real plan amendment. CLAUDE.md §3 conflict-resolution says surface as plan-drift, not silently choose.
5. **Card STATUS shows "Cleanup" for likely-VIP senders** (BofA, Robinhood, Splitwise pattern). Trust hit. Until classifications drop, mitigate with auto-protect on first sync: any sender with ≥3 outbound messages → `is_protected=true` automatically.

---

## Queued (waiting on founder direction)

### Path A — keep building Senders depth

- Replace card STATUS with evidence strip (Last seen / Read% / Replied×). Drops `intentOf()` from card display.
- 5 plain-language preset chips: All · Active · Quiet · Replied · Unsubscribe-ready.
- Auto-protect outbound recipients (≥3 outbound = VIP on first sync).
- Hide-from-Suggestions per-card recourse.
- Trust-canary CI fixture (BofA/Chase/Wells never bucketed cleanup).
- Rewrite 10 skipped legacy BE tests.

### Path B — Triage becomes default landing

- New route `/triage` → Decision Card pattern (one sender per screen, full keyboard K/A/U/L control, 60-second sweep of 25 decisions).
- Senders screen demoted to power-user folder view at `/senders`.
- BE primitives (rolling-window aggregates + summary endpoint + person score + 8-bucket) **all reusable**, no BE rewrite.

### Either path — must ship soon

- **#148 Unsubscribe/Later pipeline.** Worker stub rejects U/L. Either path is a half-product without it.

---

## Smoke status

- Stack runtime: stale at session end (preview server killed dev-up web mid-session, restarted, then session compacted). Verify with `./scripts/dev-up.sh` + `pnpm --filter @declutrmail/web dev` before next code change.
- Dev-login (D206) URL for the chintan accounts:
  ```
  http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com
  ```
  Workspace has 2 Gmail accounts → exercises multi-mailbox states out of the box.
- E2E for the new rolling-window aggregates: **not run**. Founder smoked the screen manually in browser (where the trust issues with BofA-as-Cleanup were caught). No Playwright run.

---

## Files touched (PR #149 scope, recent only)

```
apps/api/src/senders/senders.read-service.ts        (heavy rewrite)
apps/api/src/senders/senders.read-service.spec.ts   (9 new tests + 10 skipped)
apps/api/src/senders/senders.controller.ts          (?includeOneTime param)
apps/api/src/senders/senders.types.ts               (SenderSummary shape, sparkline)
apps/web/src/features/senders/senders-screen.tsx    (hero + KPI strip)
apps/web/src/features/senders/grid/sender-card.tsx  (Bloc redesign)
apps/web/src/features/senders/sender-table/sender-table.tsx  (tone stripe, display total)
apps/web/src/features/senders/api/use-senders-summary.ts     (NEW)
apps/web/src/features/senders/api/query-keys.ts              (summary key)
apps/web/src/features/senders/api/adapters.ts                (sparkline)
apps/web/src/features/senders/uplift-d/inbox-story-hero/inbox-story-hero.tsx  (CTA polish)
apps/web/src/lib/api/senders.ts                              (DTOs)
packages/shared/src/senders/thresholds.ts                    (NEW — config SoT)
packages/shared/src/components/avatar.tsx                    (multi-source fallback)
```

---

## Reminders for next session

- CLAUDE.md §2.1 D7/D228 — no body storage. Every new BE column must be allowlisted.
- CLAUDE.md §2.3 D226 — preview is mandatory before destructive mutation. U/L pipeline (#148) must enforce.
- CLAUDE.md §8 — flow completeness. Anything with a state machine: write the `state / transition / UI shows / cache effect / tested?` table first.
- MEMORY.md "No half-baked interim solutions" — founder rejects ship-stub-plus-followup pattern. Either ship final form or pick a smaller surface.
- MEMORY.md "Drizzle correlated subquery pitfall" — `sql` template emits bare column names. Already applied here via `sql.identifier(getTableName(senders))`. Re-apply for any new correlated subquery.

---

## Open question for founder

> Path A (continue Senders depth) or Path B (add Triage as default landing)?
> Either way, **#148 Unsubscribe/Later pipeline must ship next.**
