# Senders V2 — Product Spec (single-signer) — v1.3

- **Status:** Founder-signed (v1.2 → 2026-06-03; v1.3 amendment → 2026-06-05)
- **Version:** v1.3 (patches v1.2 with the recent-subjects amendment from 2026-06-05 session)
- **Author:** session 2026-06-03 (drafted by Claude, recommendations only)
- **Owner:** chintan.a.thakkar@gmail.com
- **Supersedes:** the open-loop spec discussion since 2026-05-30
- **Locks:** every Senders + Sender-Detail product decision below for the build cycle. Drift = visible (any PR contradicting a signed section flags plan-drift per CLAUDE.md §3)

## v1.2 → v1.3 changelog

Session 2026-06-05 amendment:

- **`oldestSubjects` → `recentSubjects`** in the "Show what will move" preview panel. The 3-second sender-recognition check works better on recent subjects ("Statement available - April" — user just got it) than on dustiest-at-boundary subjects. Recent = `ORDER BY internal_date DESC LIMIT 5` within the selected time-window. Privacy line + "Subjects only · we never read email bodies" reassurance unchanged.
- Affected sections: §"Show what will move" preview expansion, §Preview payload contract (`recentSubjects` field), §Phase 1 BE foundation (endpoint contract).

## v1.1 → v1.2 changelog

Founder marks 2026-06-03 (round 2) applied:

- Decision 15 redesigned: **all-chips modal** (no dropdowns), composite Option A (two linked DB records via `composite_id`), unified `POST /api/actions` endpoint, sender-context strip, "Show what will move" preview, undo banner top, value-+-unit Custom chip
- Locked copy bans: all "List-Unsubscribe" / "RFC 8058" / "header present" jargon banned user-facing; replacement table locked
- NEW Phase 5: dead-code sweep PR (~400 LOC removal, no migration needed pre-launch)
- Existing single-verb action endpoints retired; composite-only API going forward (long-term correct)
- Composite secondary = optional Archive OR Delete on past emails (applies to Unsubscribe + Later primary)

## TL;DR

DeclutrMail Senders V2 ships as a **fact-first power tool with one editorial moment on Brief**. Senders screen retires all inferred labels. Card chrome neutralizes. Expand panel surfaces last-5 subjects + plain-language privacy. Verb set extends to **K/A/U/L/D** (Delete added) via Verb Registry. Destructive actions get a **unified all-chips composite modal**: primary verb chip + optional secondary past-action chip + time-window chips + sender context + "show what will move" preview. Backend collapses to ONE `/api/actions` endpoint accepting composite shape. Bulk-select-by-filter ships. Mobile gets its own dialect (own ADR). Pre-launch dead-code sweep (~400 LOC) ships as Phase 5.

**Estimated build:** 1 day spec sign + ~16 days code = ~3.5 weeks to launch-ready Senders + Sender-Detail.

## Locked context (no decision needed)

| Lock                                                                        | Source                                     |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| Privacy posture (no body storage, allowlist headers)                        | D7 + D228 + CLAUDE.md §2.1                 |
| Canonical verbs **K/A/U/L/D**                                               | D227 amended via ADR-0019 + CLAUDE.md §2.2 |
| Action lifecycle (preview MANDATORY)                                        | D226 + CLAUDE.md §2.3                      |
| Category prediction REJECTED forever                                        | D222 + CLAUDE.md §2.4                      |
| Pub/Sub OIDC webhook auth                                                   | D229 + CLAUDE.md §2.5                      |
| Typography stack: Geist Sans / Geist Mono / Fraunces display                | D1 + ADR-0016                              |
| Cool/Vercel palette base + amber/emerald semantic + new red/danger (Delete) | D2 + ADR-0019                              |
| NumericDisplay shared primitive (4 variants)                                | ADR-0016 §A1                               |
| Card↔Detail neutral hairline chrome                                         | ADR-0016 §A2                               |

---

## Decision 1 — Verb set: K/A/U/L/D + full-word buttons

**Lock:**

- Verb set extends to **K/A/U/L/D** (Keep · Archive · Unsubscribe · Later · Delete)
- Buttons ALWAYS show full word label
- Keyboard shortcut rendered as small grey `kbd` chip beside word: `Keep [K]` `Archive [A]` `Unsubscribe [U]` `Later [L]` `Delete [D]`
- Single-letter-only display BANNED in production UI
- D227 amended via ADR-0019

**Delete semantics:**

- Moves messages to Gmail Trash (Gmail auto-empties after 30 days)
- Reversible within 30 days via undo journal (D232) + Gmail Trash recovery
- Tone: red/danger
- Confirm modal MANDATORY (D226) w/ red tone + explicit "Recoverable 30d" warning
- No type-to-confirm — Trash recovery window is sufficient deterrent

**BE implication:**

- `delete` verb added to action pipeline + Verb Registry
- Worker calls Gmail `messages.trash` (NOT `messages.delete`)
- Undo journal entry typed `delete`

**FE implication:**

- All buttons use full word + `kbd` chip pattern; single-letter chips ELIMINATED
- Verb Registry (Decision 9) adds `delete` entry w/ tone:'danger', separator:true, canBePrimary:false
- Confirm modal renders Delete tone red

---

## Decision 2 — Intent layer disposition + fact menu

**Lock:** Retire `intentOf` entirely. Primary CTA derives from facts.

**Fact-derived primary CTA rule:**

```
if (sender.protected)             → 'keep'        (faded outline)
else if (sender.unsubReady)       → 'unsubscribe' (amber filled)
else if (sender.lastSeenDays > 180) → 'archive'   (dark outline)
else                              → 'keep'        (neutral outline)
```

**Delete is NEVER primary** — always overflow-only via `canBePrimary: false`.

**Available facts:** unchanged from v1.1 (12 facts listed).

**BE implication:** unchanged from v1.1.

**FE implication:** unchanged from v1.1.

---

## Decision 3 — Default landing chip

**Lock:** First-visit = `Unsub-ready` preset w/ caption. Subsequent visits restore last filter from URL state.

---

## Decision 4 — Hero placement + retiring components

**Lock:** Weekly Hero moves to Brief. Senders screen becomes lean.

| Component        | Disposition                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `WeeklyHeroLive` | Move to Brief consumer                                                       |
| `InboxStoryHero` | Retire entirely; observed half ("3,805 emails reached you") → KPI strip cell |
| `WeeklyProgress` | Move to Brief                                                                |
| `CohortRail`     | Retire as default; resurrect as "Saved filters" post-launch                  |

---

## Decision 5 — Hero copy detailed (lives on Brief)

**Lock:** Locked literal copy per slice — unchanged from v1.1. Forbidden copy unchanged.

---

## Decision 6 — Editorial inference policy

**Lock:** BAN editorial inference. Unchanged from v1.1.

**Enforcement audit:** Phase 3 polish PR runs grep for inferred-percentage patterns + removes.

---

## Decision 7 — ADR-0009 violet retire

**Lock:** Retired. Single-accent discipline. ADR-0017 supersedes.

---

## Decision 8 — Mobile pattern

**Lock:** D54 + swipe-right primary + long-press multi-select + hairline-divided rows. ADR-0018 + Phase 4 PR.

---

## Decision 9 — ActionPopover via Verb Registry

**Lock:** ActionPopover ships Phase 2 PR-FE1. Verb Registry at `packages/shared/src/actions/verb-registry.ts`.

**Verb Registry shape:** unchanged from v1.1.

**Surface application:**

| Surface               | Primary                  | Overflow `⋯`                     |
| --------------------- | ------------------------ | -------------------------------- |
| Sender card           | Derived per Decision 2   | All non-primary registry entries |
| Table row             | Derived                  | Same                             |
| Detail action toolbar | Derived                  | Same                             |
| Mobile row collapsed  | Derived (or swipe-right) | Bottom-sheet on `⋯` tap          |
| Bulk SelectionBar     | Equal-weight K/A/U/L/D   | None                             |

D199/D220 promoted-component allowlist: Verb Registry + ActionPopover added (ADR-0019 satisfies spec-override clause).

---

## Decision 10 — Expand panel simplified

**Lock:** Default = subjects + plain-language privacy reassurance. Raw URL + headers behind "Show technical details" toggle.

Copy per locked replacements table (cross-cutting locks below).

---

## Decision 11 — Density toggle

**Lock:** Defer to post-launch.

---

## Decision 12 — Sender card stat-strip labels

**Lock:** Full-word labels.

| Old (cryptic) | New (user-friendly) |
| ------------- | ------------------- |
| `READ`        | **Opened**          |
| `LAST`        | **Last seen**       |
| `RPLD`        | **You replied**     |
| `STATUS`      | DROPPED entirely    |

---

## Decision 13 — NumericDisplay `hero` variant scope

**Lock:** Card volume uses `display` (28px), NOT `hero` (40px).

---

## Decision 14 — Skeleton fidelity NOW (Phase 2)

**Lock:** Phase 2 PR-FE1 ships skeleton re-baselining.

---

## Decision 15 — Unified all-chips composite action modal (REDESIGNED)

**Lock:** Single modal pattern for every action. All-chips (NO dropdowns). Composite Option A backing. Unified `POST /api/actions` endpoint.

### Modal shape

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│  Acting on Bank of America.                               │  ← Fraunces italic editorial moment
│                                                           │
│  ealerts.bankofamerica.com                                │
│  247 emails · last seen 2d · you replied 0× · 12yr        │  ← sender context strip
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ ⏱ Reversible for 7 days                             │  │  ← undo banner (Archive)
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ACTION                                                   │
│  ┌──────┐ ┌─────────┐ ┌────────────┐ ┌─────┐ ┌────────┐   │
│  │ Keep │ │ Archive │ │ Unsubscribe│ │Later│ │ Delete │   │  ← primary verb chips
│  └──────┘ └─────────┘ └────────────┘ └─────┘ └────────┘   │
│             ✓                                             │
│                                                           │
│  HOW FAR BACK                                             │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐     │
│  │ All inbox│ │ 30 days+ │ │ 3 months+│ │ 6 months+ │     │  ← time-window chips
│  └─────────┘ └──────────┘ └──────────┘ └────────────┘     │
│      ✓                                                    │
│  ┌──────────┐ ┌────────────────────────┐                  │
│  │ 1 year+  │ │ Older than [6][months⌄]│                  │  ← Custom = value + unit
│  └──────────┘ └────────────────────────┘                  │
│                                                           │
│  ─────────────────────────────────────────────────────    │
│                                                           │
│  47 emails will move to Archive.                          │  ← summary line
│                                                           │
│  [ Show what will move (5 of 47) ▾ ]                      │  ← preview expand
│                                                           │
│                       [Cancel]  [📥 Archive 47]           │  ← named confirm
└───────────────────────────────────────────────────────────┘
```

### When secondary section appears

Secondary chip row appears ONLY when primary ∈ {Unsubscribe, Later}. Hidden for Keep (no-op), Archive (already past-action), Delete (already past-action).

When primary = Unsubscribe:

```
ACTION
[ Unsubscribe ✓ ]

ALSO ACT ON PAST EMAILS
[ Leave alone ✓ ]  [ Archive them ]  [ Delete them ]

(time-window appears when secondary != Leave alone)
```

### Editorial moment + sender context

- Title: Fraunces italic 24px `Acting on {sender.name}.` (single line)
- Context strip: mono 12px, single line: `{domain} · {totalEmails} emails · last seen {N}d · you replied {N}× · {years}yr`
- Undo banner: top banner, tone matches action (amber for Archive 7d, red for Delete 30d)

### Sender context strip values

Pulled from existing `SenderListRow`:

- `domain` (from `senders.email`)
- `volume30d` or `totalReceived`
- `lastSeenDays` (computed FE-side from `last_seen_at`)
- `repliedCount` (NEW BE field — Decision 2)
- `relationshipMonths / 12` → years (from existing stats)

3-second "is this the right sender?" check before destructive action.

### "Show what will move" preview expansion

Tapping `[Show what will move (5 of N) ▾]` reveals the 5 most-recent subjects in the selected time-window (v1.3 amendment — recent beats oldest for 3-second sender recognition):

```
┌─────────────────────────────────────────────┐
│ 01  Statement available - April             │
│ 02  Travel notice acknowledged              │
│ 03  Replacement card mailed                 │
│ 04  Account update needed                   │
│ 05  Wire transfer received                  │
│ ─────────────────                           │
│ Subjects only · we never read email bodies  │
└─────────────────────────────────────────────┘
```

Privacy reassurance line at bottom.

### Defaults per verb

| Primary verb | Default time-window          | Secondary default |
| ------------ | ---------------------------- | ----------------- |
| Keep         | n/a                          | n/a               |
| Archive      | `All inbox`                  | n/a               |
| Unsubscribe  | n/a (until secondary picked) | `Leave alone`     |
| Later        | n/a (until secondary picked) | `Leave alone`     |
| Delete       | `6 months+` (safer)          | n/a               |

### Confirm button label

Always summarizes action:

| Composition                    | Button                           |
| ------------------------------ | -------------------------------- |
| Archive                        | `📥 Archive 47`                  |
| Delete                         | `🗑 Delete 125` (red fill)        |
| Unsubscribe (secondary = none) | `🚫 Unsubscribe`                 |
| Unsubscribe + Archive past     | `🚫 Unsubscribe + 📥 Archive 47` |
| Unsubscribe + Delete past      | `🚫 Unsubscribe + 🗑 Delete 125`  |
| Later (secondary = none)       | `⏰ Later`                       |

Never bare "Apply." Always names what user is committing to.

### Smart pre-fill from ActionPopover entry

Tap Archive in popover → modal opens w/ Archive chip pre-selected + `All` time-window pre-selected → user can tap Apply directly (2 taps total).

Tap Delete in popover → modal opens w/ Delete chip pre-selected + `6 months+` pre-selected → user can tap Apply directly (2 taps total).

Tap Unsubscribe → modal opens w/ Unsub chip + `Leave alone` secondary → user can tap Apply or modify.

Power compose: tap any verb → modify in modal → Apply.

### Small mailbox edge case

If `totalEmails < 5`, time-window collapses to single non-interactive chip:

```
HOW FAR BACK
[ All (4) ]
```

If `totalEmails == 0`, modal shows error state: "No emails to act on" + Cancel only.

### Bulk variant

```
Acting on 12 senders.

LinkedIn · Substack · Calendly · GitHub · Notion +7 more

[ Show all 12 senders ▾ ]   ← expand to per-sender drop affordance

ACTION
[ Archive ✓ ]

HOW FAR BACK
[ All inbox ✓ ] [ 30 days+ ] ...

1,247 emails across 12 senders will move to Archive.

[ Show what will move (5 of 1,247) ▾ ]

[Cancel]  [📥 Archive 1,247]
```

Expanded sender list lets user remove individuals from the bulk:

```
Senders (12)
┌──────────────────────────────────────────┐
│ LinkedIn        47 emails              × │
│ Substack        24 emails              × │
│ Calendly        18 emails              × │
│ ... +9 more   [ show all ]               │
└──────────────────────────────────────────┘
```

### Unified BE endpoint

Single endpoint replaces today's per-verb endpoints:

**`POST /api/actions`**

Request body:

```ts
{
  senderIds: string[];          // 1 for single-sender, N for bulk
  primary: {
    type: 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';
    olderThanDays?: number;     // applicable for archive/delete; null = no time filter
  };
  secondary?: {                 // only when primary in {unsubscribe, later}
    type: 'archive' | 'delete';
    olderThanDays?: number;
  };
}
```

Response:

```ts
{
  actionId: string;             // primary's id
  compositeId: string;          // same as actionId (parent links)
  status: 'queued';
  estimatedCount: {
    primary: number;            // 0 for unsub/keep/later (one-time ops on sender)
    secondary?: number;         // count of past emails secondary will act on
  };
}
```

**BE persistence (Option A — two linked records):**

```sql
-- actions table
id            uuid PRIMARY KEY
type          text NOT NULL CHECK (type IN ('keep','archive','unsubscribe','later','delete'))
sender_ids    uuid[] NOT NULL
older_than_d  integer NULL
composite_id  uuid NULL REFERENCES actions(id)  -- self-fk; primary refs itself
status        text NOT NULL CHECK (status IN ('queued','running','done','failed'))
undo_token    text NOT NULL
created_at    timestamptz NOT NULL DEFAULT now()
-- ... other fields per existing actions table
```

Single-verb action (e.g. Archive) = 1 row, `composite_id = id` (self-ref).
Composite (e.g. Unsub + Delete past) = 2 rows, both share `composite_id = primary's id`.

Worker enqueues each row independently. Secondary waits for primary `status=done` via DAG dependency.

**Preview endpoint (separate, faster):**

`GET /api/actions/preview?senderIds=...&primary.type=archive`

Returns counts per time-window bucket:

```ts
{
  totalInbox: 47,
  totalAll: 247,
  byWindow: {
    olderThan30d: 32,
    olderThan90d: 24,
    olderThan180d: 18,
    olderThan365d: 8,
  },
  custom: { /* computed on-demand via debounced refetch when user types Custom */ },
  unsubAvailable: true,
  protected: false,
  recentSubjects: [ /* 5 most-recent within selected window for "Show what will move" — v1.3 */ ],
}
```

Bulk variant: `POST /api/actions/preview` w/ filter body.

### Forbidden user-facing copy (LOCKED — Decision 15)

| Banned                                                | Allowed replacement                          |
| ----------------------------------------------------- | -------------------------------------------- |
| `via List-Unsubscribe`                                | `from their list`                            |
| `List-Unsubscribe header present`                     | `Unsubscribe available`                      |
| `No List-Unsubscribe header`                          | `No unsubscribe option in their emails`      |
| `RFC 8058` / `RFC`                                    | (never user-facing)                          |
| `UNSUBSCRIBE URL` (technical-details label)           | `Unsubscribe link they sent`                 |
| `LIST-UNSUBSCRIBE` (panel label)                      | `One-click unsubscribe`                      |
| `RECENT SUBJECTS`                                     | `Recent subject lines`                       |
| `DKIM` / `SPF` (raw header keys in technical-details) | Stay verbatim (power-user audience)          |
| `Apply` (composite confirm button)                    | Always summarize: `Unsubscribe + Archive 47` |

---

## Cross-cutting locks (unchanged from v1.1 unless noted)

### Accent semantic map (LOCKED)

| Hue     | Token            | Semantic                                               |
| ------- | ---------------- | ------------------------------------------------------ |
| Teal    | `color.primary`  | Keep verb tone, Protect status, filter-chip active     |
| Amber   | `color.amber`    | Unsubscribe verb tone, recommendation-action-available |
| Emerald | `color.emerald`  | Privacy / trust, success toast, live/active dot        |
| Dark    | `color.fg`       | Archive verb tone, neutral primary                     |
| **Red** | NEW (Decision 1) | Delete verb tone, irrecoverable-action warnings        |
| Violet  | RETIRED          | All uses forbidden                                     |

### Trust-canary CI fixture (fact-based)

Auto-protect rule: **replied ≥3× → `protected = true`** (regardless of domain).

CI tests:

- Sender w/ 0 replies + 200 msgs + unsub-link → `Unsubscribe` primary CTA
- Sender w/ ≥3 replies → `Keep` primary CTA, `protected = true`
- Protected sender → never recommended Unsub anywhere

### Privacy panel (plain-language)

```
🔒 Metadata only · No email bodies · No attachments

We never read your emails. We only save what helps you decide:
✓ Who it's from
✓ Subject + Gmail preview
✗ Email body — never fetched
✗ Attachments — never fetched

[ Show storage counts ]   ← power-user expand
```

### Sort/filter URL state

All filter + sort + search persists via `useSearchParams`. Bookmarkable, refresh-stable. Mailbox switch resets all state.

### Action display rule (all surfaces)

```
Primary derivation:
  protected            → 'keep'        (faded outline)
  unsub_ready          → 'unsubscribe' (amber filled)
  last_seen > 180d     → 'archive'     (dark outline)
  else                 → 'keep'        (neutral outline)

Overflow ⋯:
  Render VERB_REGISTRY entries (filtered by sender capability)
  Delete tone red, separator above

Bulk SelectionBar:
  Equal-weight K/A/U/L/D — no primary
```

---

## Phase rollout

**Phase 0 — This spec, founder signs.** ~1 day.

**Phase 1 — BE foundation.** ONE PR.

- Filter params (`?activity`, `?has_unsubscribe`, `?replied`, `?protected`)
- `sort=read` w/ low-N floor
- `recent-subjects` endpoint
- **NEW unified `POST /api/actions` endpoint** (replaces per-verb endpoints)
- **NEW `GET /api/actions/preview` endpoint** (returns time-window bucket counts + `recentSubjects` for preview — v1.3)
- Bulk-by-filter endpoint
- `summary.byBucket` += `replied`, `unsub_ready` keys
- `replied_count`, `to_me_only`, `has_attachment` columns added
- **`actions` table schema migration** (add `composite_id`, `older_than_d`, `secondary_type` columns OR use Option A linked-records pattern; final shape per Option A)
- Delete worker + Gmail Trash wiring
- Hero slice predicate audit
- Auto-protect-on-replied-≥3 rule
- `TOP SENDER` hotfix

~5 days. Gates: schema-migration-reviewer, architecture-guardian, privacy-auditor.

**Phase 2 — FE core.** THREE PRs against locked BE wire.

**PR-FE1: ADR-0016 corrections + skeletons + Verb Registry + ActionPopover + locked-copy sweep**

- Card volume `display` not `hero`
- Drop STATUS cell, replace w/ `You replied`
- Magnitude under-bar on card
- Emerald protected dot on avatar
- Skeleton re-baselining
- `packages/shared/src/actions/verb-registry.ts`
- `packages/shared/src/components/action-popover.tsx`
- Full-word buttons + `kbd` chips everywhere
- Replace all banned "List-Unsubscribe" / "RFC" copy w/ locked replacements

**PR-FE2: Fact-first cut + Senders screen lean + URL state**

- Drop `intentOf` entirely
- Replace chips w/ fact filters; first-visit `Unsub-ready` preset
- URL state for filter/sort/search
- Result-count strip
- Drop `InboxStoryHero` / `WeeklyProgress` / `CohortRail` from Senders
- Move `WeeklyHeroLive` consumer to Brief
- Card primary CTA derives from fact rule

**PR-FE3: Unified composite action modal + expand panel + bulk + time-window selector**

- New `ConfirmActionModal` w/ all-chips composite shape (Decision 15)
- Sender context strip
- "Show what will move" preview expansion
- Per-sender drop in bulk
- Expand panel (subjects + plain-language privacy + technical-details toggle)
- Bulk-select-by-filter affordance
- Plain-language privacy panel

~7 days. Gates: design-system-agent, flow-completeness-auditor, typescript-reviewer, privacy-auditor.

**Phase 3 — Premium polish.** ONE PR.

- Hover-subject-teaser on card
- Sort indicator on active column header
- Editorial inference audit + sweep
- ADR-0017 (violet retire) lands

~3 days. Gates: design-system-agent.

**Phase 4 — Mobile + ActionPopover post-launch sweep.** ONE PR.

- Mobile dialect per Decision 8
- ActionPopover applied to mobile row + bottom-sheet
- D54 amendment if needed

~5 days. Gates: design-system-agent, flow-completeness-auditor.

**Phase 5 — Dead-code sweep (pre-launch only — won't run post-launch).** ONE PR.

~300–400 LOC deleted, 0 LOC added:

- `apps/web/src/features/senders/uplift-d/intent.ts` + all `intentOf` / `groupByIntent` / `INTENT_META` / `INTENT_ORDER` / `ENGINE_CONFIDENCE_GATE`
- Card legacy: `TONE_BY_INTENT` (already gone), `LEAD_VERB_BY_INTENT` (after Verb Registry), `intentLabel` switch, `leadButtonTone`, `leadButtonCopy`
- `senders-screen.tsx`: dead `renderHeroStory`, `renderCtaCopy`, `computeTotals` editorial-inference paths
- `sender-detail-page.tsx`: editorial "Estimated reading cost" line + supporting math
- `detail/header.tsx` + `detail/stats-strip.tsx` (verified unused — detail page inlines its own)
- `weekly-hero/weekly-hero.tsx` (legacy non-Live variant)
- BE `sender_engine_intent` column + write paths (NO migration needed pre-launch — drop column directly)
- `color.dashboard.*` namespace + violet CSS vars (mark ADR-0009 Superseded)
- BE legacy single-verb action endpoints (`POST /actions/archive` etc.) → all subsumed by `POST /api/actions`
- `apps/web/src/app/senders-lab-v2/` (visual reference complete)
- Stale Storybook stories for retired components

~2 days. Single design-system-agent review. Runs `pnpm typecheck` + `pnpm test` to catch orphans.

**Total: 1 day spec + 22 days code = ~5 weeks** (Phase 4 + 5 can ship post-launch concurrent w/ feedback iteration).

**Critical path to launch:** Phase 0 → 1 → 2 → 3 = ~16 days = 3 weeks.

---

## ADRs needed

| ADR      | Purpose                                                                                        | When                               |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| ADR-0017 | Retire violet (ADR-0009 superseded)                                                            | Phase 2 or 3                       |
| ADR-0018 | Mobile dialect (Decision 8)                                                                    | Phase 4                            |
| ADR-0019 | K/A/U/L/D verb set + Verb Registry (amends D227)                                               | Phase 1 BE alongside endpoint work |
| ADR-0020 | Unified `POST /api/actions` composite endpoint (Option A) + time-window selector (Decision 15) | Phase 1 BE                         |

## Open items NOT decided here

- Triage screen visual alignment (own spec — uses ADR-0016 Layer A)
- Brief screen redesign (new hero home — own spec)
- Autopilot rules surface (D99-D105 — own spec)
- Pro-mode / dark theme toggle (post-launch)
- Density toggle (Decision 11 deferred)
- Action state-persistence-across-dismiss (Decision 15 nit i)
- Keyboard nav full spec for modal (Decision 15 nit j)

---

## Founder sign-off

| Section                 | Decision (v1.2)                                                                                                                            | Founder mark               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Decision 1              | K/A/U/L/D + full-word buttons + `kbd` chips; ADR-0019                                                                                      | ☐ Accept ☐ Reject ☐ Modify |
| Decision 2              | Retire `intentOf` entirely; fact-derived primary CTA                                                                                       | ☐ Accept ☐ Reject ☐ Modify |
| Decision 3              | First-visit `Unsub-ready` preset                                                                                                           | ☐ Accept ☐ Reject ☐ Modify |
| Decision 4              | Senders lean; Hero/WeeklyProgress → Brief; CohortRail retire                                                                               | ☐ Accept ☐ Reject ☐ Modify |
| Decision 5              | Hero copy locked literal per slice                                                                                                         | ☐ Accept ☐ Reject ☐ Modify |
| Decision 6              | Ban editorial inference                                                                                                                    | ☐ Accept ☐ Reject ☐ Modify |
| Decision 7              | Retire ADR-0009 violet                                                                                                                     | ☐ Accept ☐ Reject ☐ Modify |
| Decision 8              | Mobile = D54 + swipe + long-press + hairlines                                                                                              | ☐ Accept ☐ Reject ☐ Modify |
| Decision 9              | ActionPopover via Verb Registry                                                                                                            | ☐ Accept ☐ Reject ☐ Modify |
| Decision 10             | Expand panel simplified default + technical-details toggle                                                                                 | ☐ Accept ☐ Reject ☐ Modify |
| Decision 11             | Defer density toggle                                                                                                                       | ☐ Accept ☐ Reject ☐ Modify |
| Decision 12             | Stat labels `Opened · Last seen · You replied`                                                                                             | ☐ Accept ☐ Reject ☐ Modify |
| Decision 13             | Card volume `display` not `hero`                                                                                                           | ☐ Accept ☐ Reject ☐ Modify |
| Decision 14             | Skeleton fidelity Phase 2                                                                                                                  | ☐ Accept ☐ Reject ☐ Modify |
| Decision 15             | **All-chips composite modal + Option A backing + unified `POST /api/actions` + sender context + preview + undo banner + locked copy bans** | ☐ Accept ☐ Reject ☐ Modify |
| Cross-cutting           | Accent map + canary (fact-based) + plain-language privacy + URL state + registry-driven action rule                                        | ☐ Accept ☐ Reject ☐ Modify |
| Phase rollout           | 1 day spec + 22 days code = ~5 weeks (critical path 3 weeks to launch)                                                                     | ☐ Accept ☐ Reject ☐ Modify |
| Phase 5 dead-code sweep | Yank ~400 LOC pre-launch (no migration needed)                                                                                             | ☐ Accept ☐ Reject ☐ Modify |

**Founder sign-off date:** ☐ **\*\***\_\_\_\_**\*\***

Once signed, every PR opened under this spec links here. Any deviation flags as plan-drift per CLAUDE.md §3.
