# Senders "progress spine" — 5-lens expert critique (2026-07-02)

Five parallel critic agents (cross-screen consistency + terminology ·
interaction/IA + filtering · dark mode · mobile · data leverage) reviewed the
proposed Senders revamp against the SHIPPED codebase. Every claim below was
verified against real code/spec (file:line evidence lives in the session
transcript; load-bearing citations repeated here).

The proposal under review: segments "To decide / Handled / All" (default To
decide) · progress hero + payoff chip · "new senders since Friday" band ·
card click → in-place expand (stats, sparkline, subjects, 5 verbs) · table
"State / Actions" column · bulk select-all-matching + preview + receipt ·
celebration empty state.

**Net verdict:** the mechanics mostly already exist and must be REUSED, not
rebuilt; the shape survives, but with two locked-spec conflicts requiring
founder amendment (DQ19, DQ20), one wrong predicate, one API-boundary
blocker, and ~15 vocabulary corrections into words the codebase already
ruled on.

---

## 1. Corrections the critique forced (proposal → corrected)

| Proposed | Verdict | Corrected form | Authority |
| --- | --- | --- | --- |
| Segments "To decide / Handled" | RENAME | **To review / Reviewed / All** | detail/header.tsx chose "reviewed" over "decided" (agency: template verdicts); "decisions" is D221-locked to Triage queue; "handled" already = emails acted on (landing hero) and is false for Keep |
| Handled = `lastReview != null` | WRONG PREDICATE | Reviewed = `lastReview != null OR standing sender_policy (keep/unsub) OR protected/VIP` — server-side, with per-segment counts in one `meta.query` block + `?segment=` param (new BE work) | Keep on Senders writes a policy, not a verdict (senders-screen.tsx:962-1008, D40) — else Kept senders sit in "To review" forever |
| Counter ticks 1,214 → 1,206 | BANNED | Fade-swap; count changes only in the segment header on refetch | ADR-0010:100-103 explicitly rejects counter-tick; weekly-progress.tsx honors it |
| "84% of your senders are handled" | REWRITE | "**6,625 of 7,839 senders reviewed**" + thin bar (bar carries the %) | Product progress grammar is "N of M", never % prose (weekly-progress, D221) |
| "≈310 fewer emails/mo" payoff chip | REWRITE + RELOCATE | "~310 future emails/mo will skip your inbox" under uppercase-mono "Estimated impact" label, BE-computed from REAL trailing volumes of acted senders (projectImpact ÷3 shape), hidden at 0. `≈` has zero precedent; the uncalibrated h/mo coefficient was deliberately removed (senders-screen.tsx:262-266) | triage/empty-state.tsx:184-202; spec v1.2 Decision 6 |
| Estimate inside D226 preview modal | DROP FROM MODAL | Modal stays strictly factual: "112 emails across 8 senders will move to Archive." Projections never enter the preview | ADR-0011:80-88; senders-v2.md:349-369 locked modal shape; Decision 15 = single modal pattern (reuse ConfirmActionModal) |
| 5 flat equal verbs on expanded card | CONFORM (or amend ADR-0019 — DQ20) | One derived primary (full-word + Kbd chip) + ⋯ overflow popover; Delete red, separator, never a flat peer (`canBePrimary: false`) | senders-v2.md:521-536 lock; verb-registry.ts:200-210 |
| "Select all 1,214 matching" as id list | API BLOCKER | Server-side **sender-filter selector** (registry manifest-entries.ts:143, already modeled, tier: pro): filter+segment params to server, preview computed there, snapshot frozen at confirm so execution = preview. Manual selection stays id-based, capped at BULK_SENDERS_MAX=1000 with cap surfaced | actions.types.ts:234 caps id arrays at 1000 (would 400); Pro gate surfaces at click, not 402-after-preview |
| Row animates out on action | UNSAFE | Busy in place → gray-to-state-chip via session ledger (decided-this-session ids pinned); evict only at segment/filter change or next visit; undo flips chip back | Async enqueue→poll model (D226 forbids optimistic removal); list must never reflow under cursor/shift-anchor |
| "12 new senders since Friday — Review new →" | REWRITE | "**12 first seen this week**" = canned, dismissible filter chip within To review (new `first_seen_since` param; sort=first_seen exists). No weekday dialect; no "Review new" queue (ReviewSession is deliberately dead; Screener owns "new senders waiting" and is Pro-gated D77 — DQ22) | screener-screen.tsx:334-351; relative-time formatters ship today/Nd/Nw only |
| Celebration empty state | TONE DOWN | "**Every sender reviewed.**" + calm next step; two variants: genuinely-empty (closure) vs filtered-empty (Clear filters / See N in All) | D212 calm-never-apologetic; ADR-0011 bans celebratory lines; triage "You cleared today's queue." |
| Stat labels "LAST 30D / LIFETIME" | RENAME | "Last 30 days / Total ever / Opened / You replied" — sentence-case SOURCE strings, uppercased by CSS only (Eyebrow/mono-label convention) | senders-v2.md:183-193 Decision 12 full-word lock; case rule = never hardcode uppercase |
| "2 of 8 have no unsubscribe channel" | REWRITE | "2 of 8 skipped — no unsubscribe option in their emails" | senders-v2.md:470 locked replacement + existing skippedNote grammar |
| "RECENT SUBJECTS" (3 shown) | RENAME + ADD | "Recent subject lines" + privacy line "Subjects only · we never read email bodies" (spec shows 5 subjects; pick and state) | senders-v2.md:474 forbidden-copy table; confirm-action-modal.tsx:976 |
| "Unsubscribed 3d · Change" chip | ADJUST | "Unsubscribed · 3d ago" (Activity past-tense vocab + fmtLastReview units, promote to shared helper). "Change" → reopens ActionPopover (a new mutation = full D226 round-trip). Chip must defer to the unsub EXECUTION status pill (confirming/failed/unconfirmed) — a verdict chip may not say "Unsubscribed" while execution failed | activity-screen.tsx:601; sender-card.tsx:113-132 |
| "Full history →" | KEEP (minor) | "View full history →" | decision-history.tsx:102 verbatim precedent |
| Hero as editorial moment | TRIM | One editorial-adjacent element max (the Estimated-impact chip); count line + bar are facts; keep trust cue near hero | ADR-0011:56-67 one-phrase budget |

## 2. Filtering — why it "looks odd" (diagnosis) and the v2 contract

Ranked causes (all code-verified):
1. **Four behaviors in identical chip clothing** — radio (activity), tri-state
   (has-unsub/replied/protected), popover-openers (QUIET FOR/DOMAIN), and a
   sort control deliberately dressed as a filter (compose-strip.tsx:661-666).
2. **Two recency axes** (activity buckets vs QUIET-FOR windows) that can
   compose contradictions; resting label "QUIET FOR any time" is nonsense.
3. **Counts don't predict the click** — chips show mailbox-wide absolutes
   while results are AND-composed.
4. **Invisible negation** — Alt/right-click flips chips to NOT; undiscoverable,
   hijacks context menu.
5. **Terminal typography** under an editorial hero — two products, one screen.
6. **Dead axis** — "you replied" chip writes URL state but the param is never
   sent to the API (FE omits it; BE accepts it). Live production bug.

**Filter v2:** segment control (population) → primary row: `[Unsub ready]`,
`[Quiet 90d+ ▾]` (merged recency quick-pick writing existing activity/window
params), `[Domain ▾]`, `[Filters (2)]` disclosure → results line "**214**
senders match · Sorted by Most emails ▾ · clear filters" (sort returns to the
summary line, distinct from filters). Disclosure holds all six axes as
explicit `[any | is | is not]` rows — negation becomes words, never Alt-click.
Chip counts scoped to segment ∩ other-filters, or dropped entirely (honest >
mailbox-wide-but-wrong). Segment tab counts stay filter-independent. All URL
params preserved + `?seg=`; sort/direction move INTO the URL (doc comment
already claims they're there; they aren't — store.ts:44-48).

## 3. Interaction contracts (agreed across critics)

- **Expand:** one-at-a-time, store-owned `expandedId` (triage store pattern),
  full-width panel under the card's grid row; REUSE SenderRowDetail (its
  stats/subjects block already exists — but its sparkline is SEEDED FAKE DATA,
  sender-row-detail.tsx:63-74; wire real timeseries or drop it).
- **Keyboard:** verb keys act on the expanded card ONLY (triage contract);
  precedence stack: modal > popover > expanded card > selection > none. No j/k
  (k = Keep per D227). Esc: modal → popover → collapse; never clears selection.
  After confirm: collapse + focus next, NO auto-expand-next (Senders is the
  management surface; the ritual lives on Triage).
- **Bulk:** two species never mixed — manual (ids, ≤1000, cap surfaced) and
  scope (sender-filter, server-resolved, snapshot at confirm, Pro). Scope
  selection invalidated by any filter/segment change. Bulk unsub needs a
  server-side batch (today = N browser POSTs, fine at 30 not 1,214).
- **Counts:** every spine number (segment counts, left-to-review, N-of-M) from
  ONE `meta.query` block, page-1 snapshot, existing invalidation.
- **Shared URLs:** `?seg=` omitted = To review — accept the semantic shift for
  old links, release-note it.

## 4. Dark mode (feeds DQ21, amends DQ17)

- Feasibility measured: features use 1,321 `color.*` refs vs 45 raw hex (38 =
  `#FFFFFF`) + 94 rgba literals; ZERO hex-alpha appends → flipping tokens.ts
  values to `var(--dm-*)` is mechanical and safe. No component consumes a
  `--dm-` color var today (tokens are JS literals — landing.css:9-12 documents
  why marketing had to fork).
- **Funnel is already split-brained:** marketing ships a full warm dark scheme
  (landing.css:47-73); dark-OS users get a dark landing → blinding light app.
- Every semantic hue fails AA on dark as-is (teal 2.67, danger 2.29 on card);
  full proposed ramp with ratios is in the critic report — "ink desk" warm
  green-black (#0C1110 bg / #151D1B card / #F2F3F0 ink / #36C2AF teal).
- One true redesign item: elevation must become surface-lightening + hairline
  (shadows invisible on near-black). Scrim is copy-pasted rgba at 7+ sites →
  tokenize `color.scrim`. fgInverse migration stalled at 2 consumers → finish.
- **Plan (DQ21):** revamp PR leaves dark ONE CSS BLOCK away — (a) tokens.ts →
  var() indirection (standalone PR, zero visual diff), (b) dark ramp lands in
  tokens.css behind `[data-theme='dark']`, unshipped, (c) fgInverse + scrim
  migrations, (d) every new component token-clean + sanity-rendered once under
  the unshipped ramp, (e) ESLint no-new-color-literals rule. Toggle ships
  post-launch as fast-follow.
- Finding worth knowing: 43 `*.stories.tsx` files exist but NO Storybook
  runner/config/dependency is installed — D210's story gate is currently
  notional.

## 5. Mobile (feeds ADR-0018 amendment)

- ADR-0018 has two factual errors: claims sm breakpoint = 600 (actual token
  `sm: 900`, load-bearing in shell CSS + senders view-force) and cites a PWA
  that does not exist (no manifest/SW/viewport-fit anywhere).
- **Breakpoint model:** keep `sm: 900` untouched; ADD `phone: 600` token.
  <600 = phone dialect (row list, sheets, gestures — Phase 4); 600–900 =
  compact (today's reality + pointer-coarse target bump); >900 = desktop.
- **Bulk has no touch path** — shift-click only; ADR-0018 long-press →
  selection mode is the target; interim = ≥44px checkbox hit areas.
- **Minimum mobile slice riding WITH the revamp PR:** responsive stacking of
  segments/hero/band; expanded-card verbs = primary full-width (thumb zone) +
  ⋯ ActionPopover as bottom sheet; SelectionBar two-line compact + safe-area
  padding (breaks at 375px today; toast overlaps it); ConfirmActionModal sheet
  variant with STICKY confirm footer (D226 confirm can scroll out of reach on
  667px phones today); receipt bottom-anchored on phones (top placement is
  off-viewport when acting from the bottom bar); `@media (pointer: coarse)`
  min-height bump in tokens.css.
- Deferred to ADR-0018 Phase 4: hairline row-list, swipe verbs (edge-gesture
  guards + D226 ruling needed), long-press selection, chip snap-scroll.
- Independent small PR: real PWA baseline (manifest + icons + themeColor +
  viewport-fit=cover) — cheapest return-visit lever; safe-area work depends
  on it in standalone mode.

## 6. Data leverage — ship list

Top 5 WITH the revamp (all from stored allowlisted data):
1. **Measured cleanup receipt** — `GET /api/stats/impact`: SUM(activity_log
   .affected_count) by verb + COUNT(unsub_status='done'). "12,438 emails
   handled · 43 subscriptions ended" — measured, not projected; pairs with
   "Full bodies fetched: 0" (the share-card wedge, DQ16).
2. **Read-rate trend at decision time** ("read 40% → 2%") — timeseries stored;
   one field onto the list wire; replaces the fake sparkline.
3. **Since-last-visit delta band** — first_seen + existing volumeTrend
   thresholds (shared/senders/thresholds.ts is the single source; Brief must
   consume the same read-service method, not re-derive).
4. **size_bytes on D226 previews** — "Moves 555 messages (~48 MB)" (ADR-0021
   column; pre-backfill rows render "≥" floor).
5. **Per-sender unread pile + last-read recency** — the partial index for it
   already exists unconsumed (mail-messages.ts:188-192).

Verdicts: own-mailbox percentiles ALLOWED; cross-user benchmarks BLOCKED
(privacy wedge; would need a new D); subject-repetition SAFE only as a
deterministic fact, never a category noun (D222); minutes-saved only as
footnoted secondary (6s/email basis, D33). Anti-metrics: no % prose, no
streak guilt, no lifetime-count-beside-recency without naming windows.

## 7. Live defects found during critique (independent of the revamp)

| Defect | Where | Status |
| --- | --- | --- |
| "you replied" filter chip is a silent no-op (FE never sends param BE accepts) | senders-screen.tsx:168-179 / senders.ts:416-459 | task chip spawned |
| Row-expand sparkline renders SEEDED FAKE DATA in prod | table/sender-row-detail.tsx:63-74 | task chip spawned |
| Row-expand dropped the locked privacy line + uses forbidden "Recent subjects" label | sender-row-detail.tsx:251-282 vs senders-v2.md:474 | fix in revamp PR |
| SelectionBar overflows at 375px; toast overlaps it; no safe-area anywhere | selection-bar.tsx:46-133, toast.tsx:63-67 | revamp mobile slice |
| D226 confirm scrollable out of reach on phones (footer inside scroll area) | confirm-action-modal.tsx:439-445, 985-1027 | revamp mobile slice |
| SelectionBar ships A/L/U/D while spec :534-536 says K/A/U/L/D equal-weight | selection-bar.tsx:93-131 | founder pick in DQ20 scope |
| No Storybook runner installed; 43 story files unexecutable; D210 gate notional | repo-wide | flagged to founder |
| Marketing dark → light app split-brain for dark-OS users | landing.css:47-73 | DQ21 |

## 8. Revised build plan

0. **Docs first:** ADR-0018 amendment (breakpoint model, gesture rules, PWA
   correction, CSS-first switch note) + this critique's DQ19–DQ22 resolved.
1. **PR A — token indirection** (standalone, zero visual diff): tokens.ts →
   var(); dark ramp unshipped; scrim token; fgInverse finish; lint rule.
2. **PR B — BE slice:** `?segment=` + reviewed-predicate + per-segment counts
   in meta.query; `first_seen_since`; `/api/stats/impact`; read-rate-trend
   field; replied param wiring fix.
3. **PR C — the revamp** (redesign label, gates on): segments To review /
   Reviewed / All + N-of-M line + bar + Estimated-impact chip; filter v2;
   store-owned expand reusing SenderRowDetail (real data); State/Actions
   column; scope-selection bulk (Pro) + snapshot execution; calm closure
   states; the mobile minimum slice; PostHog events for segment/filter/bulk.
4. **Fast-follows:** dark toggle; ADR-0018 Phase 4 row-list/gestures; PWA
   baseline PR; Brief delta digest consuming the same read-service.
