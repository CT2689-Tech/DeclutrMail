# ADR-0012: Senders intent-grouped tables (amends D38, D39)

- **Status:** Accepted
- **Date:** 2026-05-25
- **Accepted:** 2026-05-25
- **Deciders:** chintan.a.thakkar@gmail.com, design-direction agent
- **Related D-decisions:** D38 (Senders surface composition), D39
  (Sender detail page strict layout order), D222 (Auto-Protect via
  category prediction REJECTED — categories are user-assigned or
  rule-matched, never ML-predicted), D44 (Stats strip), D227
  (canonical verbs K/A/U/L)

> **D245 amendment (2026-07-14):** VIP was removed before launch. Protected
> is the sole visible safety state, so every grouping rule below keys only on
> `is_protected`.

## Context

The current Senders surface (`apps/web/src/features/senders/senders-screen.tsx`)
groups senders by **Gmail category** (`primary`, `promotions`,
`social`, `updates`, `forums`) via the `sender_group.tsx` collapsible
bloc. This was the right call when the surface was a "browse my
mail" directory — categories let users find a sender by where Gmail
filed it.

The Variant D design exploration in this session reframed the
Senders surface as a **weekly cleanup cockpit**, not a directory.
The user comes here to make decisions, not to browse. With that
reframe, the relevant question per group changes from "what kind of
mail is this?" to "what should I do about these senders?"

That reframe is incompatible with Gmail-category groups:

- Some Promotions are unsubscribe candidates; some are receipts the
  user wants to keep.
- Some Updates are weekly digests worth keeping; some are
  newsletters the user has stopped reading.
- A sender's _intent disposition_ (clean up / move later / protect /
  keep watching) does not align with its Gmail category.

Intent disposition is **derivable from existing data** — it does not
require new ML, new schema, or new headers:

- **Clean up** = engine recommendation = `unsubscribe`
- **Move later** = engine recommendation = `archive`
- **Protect** = `sender_policies.is_protected`
- **People** = senders with no recommendation and not protected (the
  "still figuring out" middle)

This is **not** ML category prediction (D222) — the engine
recommendation already exists per D26 (`triage_decisions.verdict`).
We're regrouping the existing list by the existing recommendation
field, not adding a new classifier.

The Gmail category remains stored on the sender row (`senders.gmail_category`)
and continues to be visible as metadata, but it is no longer the
primary grouping axis on the Senders surface.

## Decision

The Senders surface (`apps/web/src/features/senders/senders-screen.tsx`)
**groups senders by user-intent disposition**, not by Gmail category:

| Group      | Membership                                       | Default state | Action affordance   |
| ---------- | ------------------------------------------------ | ------------- | ------------------- |
| Clean up   | `triage_decisions.verdict = 'unsubscribe'`       | Auto-expanded | Single primary verb |
| Move later | `triage_decisions.verdict = 'archive'`           | Collapsed     | Single primary verb |
| Protect    | `sender_policies.is_protected`                   | Collapsed     | Status display only |
| People     | All others (no recommendation and not protected) | Collapsed     | Default to Keep     |

Group ordering is fixed: **Clean up → Move later → Protect → People**.
The top-priority action group (Clean up) auto-expands; the rest start
collapsed.

The filter chip row reads: **All · Clean up [N] · Move later [N] ·
Protect [N] · People [N]**. The `All` chip is the default-selected
chip and renders the full intent-grouped table; other chips render
only their corresponding group expanded.

Gmail category remains visible as a metadata stripe on individual
rows (a 3 px left-edge color tag using the existing
`CAT_COLOR[gmail_category]` map). The Gmail category filter chips
(Primary / Promotions / Social / Updates / Forums) are **removed**
from the Senders surface — those filters move to a secondary
"advanced filters" drawer accessible from the filter rail.

## Alternatives considered

- **Keep Gmail-category groups, add intent as a secondary filter:**
  rejected because the primary grouping is what the user reads first,
  and the cockpit reframe requires intent to be primary. Demoting
  intent to a filter retains the directory framing.
- **Group by frequency bucket (Daily / Weekly / Monthly):** rejected
  because frequency is a property _of_ a sender, not a disposition
  _toward_ a sender. The user's question is "what do I do about
  this?" not "how often does this person mail me?"
- **Predict a category via ML (newsletter / transactional / personal):**
  rejected by D222, permanently. No version of DeclutrMail does this.
- **Single flat list with no groups:** rejected because the
  scan-and-decide loop benefits from chunking — Clean up first
  (highest-priority decisions), then Move later (medium-priority),
  then the rest collapsed as context.

## Consequences

### Positive

- The Senders surface answers "what should I do next?" by structure,
  not just by sort order.
- Auto-expanded Clean up group means the user's first scroll-line is
  the decisions waiting to be made — the cockpit framing pays off
  immediately.
- Gmail category metadata is preserved (visible as the row stripe
  - the secondary advanced-filter drawer) so power users can still
    navigate by where Gmail filed mail.
- Derivation uses existing fields (`triage_decisions.verdict`,
  `sender_policies.is_protected`) — no schema migration,
  no new wire field, no new endpoint.

### Negative

- Users coming from Unroll.me / Clean Email / SaneBox expect
  Gmail-category-based filtering as the default. Mitigation: the
  Gmail-category chips remain available in an advanced-filter
  drawer, and the on-row color stripe preserves the visual
  association.
- Sender membership in a group is computed each render from
  `triage_decisions.verdict` — when the user acts on a sender, the
  group membership changes (e.g., Unsubscribe LinkedIn → it leaves
  Clean up). The list rerenders. Mitigation: TanStack Query's
  invalidation on mutation already handles this; the row removal
  animation per ADR-0010's receipt-strip motion makes the
  transition legible.

### Neutral

- Sender Detail page (D39) is unaffected. Detail page composition
  follows ADR-0011 (editorial copy) and the Variant D layout
  (`~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D2), not this
  ADR.
- `senders.gmail_category` column stays in the schema and the API
  response envelope (D202) is unchanged.

## Implementation notes

**Grouping helper** (lives in `apps/web/src/features/senders/data.ts`
per lazy promotion — promote to `packages/shared` when Activity
needs the same disposition grouping):

```typescript
export type SenderIntent = 'cleanup' | 'later' | 'protect' | 'people';

export function intentOf(s: SenderListRow): SenderIntent {
  if (s.lastReview?.verdict === 'unsubscribe') return 'cleanup';
  if (s.lastReview?.verdict === 'archive') return 'later';
  if (s.protectionFlags?.isProtected) return 'protect';
  return 'people';
}

export const INTENT_ORDER: SenderIntent[] = ['cleanup', 'later', 'protect', 'people'];
```

**Group descriptions** (per Variant D copy audit, all D209-compliant):

| Intent  | Description                                           |
| ------- | ----------------------------------------------------- |
| cleanup | Senders we think you can let go                       |
| later   | Out of inbox, still here when you need them           |
| protect | Always-keep · protected senders and important threads |
| people  | Folks and tools you stay in touch with                |

**Migration path.** The current Gmail-category `SenderGroup`
component is preserved (do not delete) — it becomes the rendering
primitive that the new intent grouping wraps. Same row component,
different group shell.

**Storybook coverage** (per D210):

- `senders-screen.stories.tsx` — `intent-default`, `intent-cleanup-only`,
  `intent-move-later-only`, `intent-protect-only`, `intent-people-only`,
  `intent-empty-cleanup-group` (no unsubscribe recommendations exist).

## References

- D38 — Senders surface composition (introduced Gmail-category groups)
- D39 — Sender detail page strict layout order (unaffected)
- D222 — Auto-Protect via category prediction REJECTED (this ADR's
  grouping is derived from existing triage verdicts, not predicted)
- D26 — Recommendation banner (verdict + confidence)
- `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D1 — Variant D
  list page composition with intent groups
- `apps/web/prototypes/senders-uplift.html` — prototype demonstrating
  intent groups in context
