# ADR-0011: Editorial copy voice scope (amends D209)

- **Status:** Proposed
- **Date:** 2026-05-25
- **Deciders:** chintan.a.thakkar@gmail.com, design-direction agent
- **Related D-decisions:** D209 (microcopy — trust-first, forbidden
  words: smart, AI-powered, magic, nuke, blast, clean (verb),
  intelligent (standalone)), D212 (empty states are first-class,
  calm, never apologetic), D221 (count "decisions" not "senders" /
  "emails")

## Context

D209 enforces a trust-first, plain microcopy voice. Action surfaces
(buttons, confirm modals, receipts, errors) must be strictly
functional and descriptive — no promises, no anthropomorphism, no
"smart suggestion" or "AI-powered" framing. The forbidden words
list is enforced by `check-microcopy.sh`.

This rule is unambiguous on action surfaces. It is intentionally
strict because those surfaces carry consequences — an Unsubscribe
button must read as a tool, not a promise. But the rule has been
_equally_ strict on the hero strip and empty states. The Variant D
prototype (`apps/web/prototypes/senders-uplift.html`) shows the cost
of that: the hero copy is forced to be a flat number recital —

> "12 senders mail you. ~48% noise reduction available."

— when the same data, framed editorially, would read as

> "312 emails reached you. Only 18% were worth reading.
> 5 decisions can cut next week's inbox by ~48%."

The second framing is recognizably DeclutrMail; the first could be
any inbox tool. The difference is not features — it's voice.

The risk of relaxing D209 anywhere is voice drift. If we allow
editorial copy on the hero, an agent ships a new feature next week
with "AI-powered cleanup" on its hero and cites this ADR as cover.
This ADR is written to make that impossible — the relaxation is
scoped narrowly and the forbidden list is preserved everywhere.

## Decision

D209's forbidden-word list and trust-first rule continue to apply
**everywhere**. They are non-negotiable.

D209's "purely descriptive, no editorial framing" rule is **relaxed
on two surfaces only**:

1. **Hero strips** — the topmost content block on a feature page
   that frames the user's current state (e.g., the Senders list's
   "Your inbox this week" hero, the Triage queue's hero, the
   Dashboard hero).
2. **First-class empty states** — D212 empty-state surfaces, where
   warmth is part of the calmness.

On those two surfaces, copy may include **one editorial framing
phrase per surface**. "Editorial framing" means a sentence that
adds a perspective on the data, not just recites it. Examples that
are now permitted:

- _"Only 18% were worth reading."_
- _"Most of these mail you, few of them mail you back."_
- _"Your inbox is in shape. Next review in 7 days."_

Examples that remain forbidden (because they hit the D209 word list
or read as promises / anthropomorphism):

- _"Smart suggestion: …"_ — uses `smart`
- _"AI picked these for you."_ — uses `AI`
- _"We've nuked the noise."_ — uses `nuke`
- _"Magic is happening behind the scenes."_ — uses `magic`
- _"Your inbox is healthier than ever."_ — health metaphor implies
  scoring, which is itself a streak risk (see §Consequences)

The relaxation **does not extend** to:

- Action buttons (Keep / Archive / Unsubscribe / Later, plus
  microcopy below them like "Saves 7.4h/year" — those are factual,
  not editorial)
- Confirm modals (D226 preview content — strictly factual)
- Receipt toasts / undo strips (factual)
- Error states (factual, no warmth that risks reading as
  dismissive)
- Settings / billing / autopilot / screener surfaces

## Alternatives considered

- **Keep D209 strict everywhere:** rejected because the hero is the
  surface that decides whether the user feels the product
  understands them. The Variant D prototype demonstrated the gap;
  flat number-recital is not a brand voice.
- **Allow editorial copy on all surfaces:** rejected because voice
  drift compounds. Two months from now an agent ships "Smart picks
  for you" on a feature CTA and cites this ADR. Scoping to hero +
  empty states means the rule remains greppable — `check-microcopy.sh`
  can add a path-scoped relaxation rather than a global one.
- **Permit one editorial line per _page_:** rejected because it
  would invite hero authors to spread editorial framing across
  multiple sections of the same page. "One per surface" pins it.

## Consequences

### Positive

- DeclutrMail's hero copy can recognizably be DeclutrMail.
- The forbidden-word list still bars the AI-magic-supercharge
  vocabulary that defines the wedge against Unroll.me / Clean
  Email's voice.
- Scope is narrow enough that `check-microcopy.sh` can enforce it
  by file path rather than by author judgment.

### Negative

- Hero copy now requires editorial review — a flat sentence passes
  the linter but may still be flat. The review burden falls on
  founder / design-direction agent at PR time, not on the linter.
- Risk of subtle voice drift over months as multiple agents author
  hero strings. Mitigation: the ADR caps editorial framing at _one
  phrase per surface_, and the existing D209 forbidden-word list
  catches the obvious failures.

### Neutral

- D221 (count "decisions" not "senders" / "emails") is unchanged.
  The hero may say "5 decisions can cut…" but not "5 senders we'll
  clean up" — `clean` is on the forbidden list and `decisions` is
  the D221-mandated framing.

## Implementation notes

`check-microcopy.sh` extension (deferred to a follow-up PR — flagged
in FOUNDER-FOLLOWUPS): add a path-scoped mode that allows the
single-phrase editorial relaxation only on files matching
`*/hero*.{ts,tsx}` and `*/empty-state*.{ts,tsx}`. Outside those
paths, the existing strict rules apply unchanged.

**Editorial-framing checklist** (a hero / empty-state PR must
satisfy all):

- [ ] At most one editorial framing phrase on the surface
- [ ] Zero forbidden words anywhere on the surface
- [ ] Copy survives the "would this read as a promise?" check
- [ ] Copy survives the "would a power user roll their eyes?" check
- [ ] Trust cue ("No message bodies · Reversible for 7 days") visible
      on or near the surface — editorial framing is balanced by
      explicit trust grounding

**Codex review note (from session 2026-05-25).** The pushback on
counter-tick animation (see ADR-0010) is paired with this ADR's
caution on celebratory copy. After an action lands the hero stat
should update via fade-swap with descriptive copy — never a
celebratory line like _"Nice. Next week's inbox is projected 18
emails lighter."_ That line uses no D209-forbidden words but reads
as encouragement / streak — exactly the dopamine pattern the
product positions against.

## References

- D209 — microcopy trust-first rules + forbidden word list
- D212 — empty states are first-class, calm, never apologetic
- D221 — "decisions" framing
- `~/.claude/plans/how-can-we-uplift-foamy-cloud.md` §D4 — Variant D
  hero / empty / action copy audit
- `apps/web/prototypes/senders-uplift.html` — prototype demonstrating
  hero editorial framing
