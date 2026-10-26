# ADR-0048: One swipe grammar for every phone surface

- **Status:** Accepted (founder decision 2026-10-24)
- **Date:** 2026-10-24
- **Deciders:** chintan.a.thakkar@gmail.com; Claude (author)
- **Related D-decisions:** D37, D54, D226, D227
- **Related ADRs:** ADR-0018 (Gestures section superseded), ADR-0019, ADR-0047

## Context

Phone gestures existed in two private implementations that had drifted. Triage
mapped right to Keep, left to Archive, up to Later (D37 plus a founder-directed
addition) and kept Unsubscribe button-only. Senders mapped right to the row's
derived primary verb and left to expand (ADR-0018). The same direction meant
different things on two screens that decide about the same object.

The founder's read of usage is that **Delete, Unsubscribe and Keep are the most
used verbs**. That is an untested hypothesis (no per-verb counts were available
in this session), and it contradicts D37's premise that only the two lower-risk
verbs earn gestures. What made that premise unnecessary is D226: every gesture
only opens the mandatory preview, so a swipe on a destructive verb cannot
mutate anything. The Confirm tap and the undo tray remain the guards.

One more defect fell out of the old code: the hint overlay named a verb a swipe
would resolve to even when a guard then refused it on release, so the screen
promised something it would not do.

## Decision

One hook, `useSwipeVerb` in `packages/shared`, used by every surface that
decides about a sender:

| Gesture     | Verb        |
| ----------- | ----------- |
| Swipe right | Keep        |
| Swipe left  | Unsubscribe |
| Swipe up    | Delete      |
| Swipe down  | unbound     |
| Tap         | expand      |
| Long-press  | select      |

Archive and Later are one-tap buttons only. Every swipe opens the D226 preview
through the same `onVerb` the buttons use. A verb that cannot run on the item
(no unsubscribe channel, a request already in flight, nothing to delete) neither
fires nor shows a hint. The words a hint uses live in one table (`SWIPE_HINT`).

Touch pointers only; controls inside a surface keep their own gestures. Every
swipe has a visible button equivalent.

## Alternatives considered

- **Keep D37 for Triage and ADR-0018 for Senders:** rejected. It is the drift
  this ADR exists to end.
- **iOS-style reveal buttons on a partial swipe:** not rejected on merit, but it
  needs a second interaction model beside the card fling Triage already has, and
  the shared mapping above already fits both surfaces.
- **Keep Unsubscribe and Delete button-only:** rejected by the founder on
  frequency. Two of the three most-used verbs would sit behind tap-to-expand.

## Consequences

### Positive

- One direction means one verb on every sender-decision screen.
- The hint and the release can no longer disagree.
- The two frequent verbs are one gesture plus one confirm tap.

### Negative

- Senders changes: swipe-left no longer expands the row (tap does), and
  swipe-right is always Keep, not the derived primary.
- Up-swipe competes with scrolling. The cards set `touch-action: pan-y`, so the
  browser keeps vertical drags it can scroll; a Delete preview can still open
  from an unintended up-swipe when the page cannot scroll. It is a preview, not
  a deletion, but it is friction. **Test on a real device.**
- Android's edge-swipe back gesture may take a swipe that starts at the screen
  edge. **Test on a real device.**
- An Unsubscribe request cannot be recalled once sent. The preview must keep
  stating that (D226); the gesture does not change it.

### Neutral

- Other plan lines mention swipes on Activity (undo), Later (wake) and Follow-ups
  (dismiss). None is built. They act on other objects, not on a sender with the
  five verbs, so they are out of scope. When built they must not reuse left or
  right for a different meaning on a list of the same objects; prefer a row
  button.

## Implementation notes

- `packages/shared/src/hooks/use-swipe-verb.ts`; resolver tests in shared, DOM
  tests in `apps/web/src/components/use-swipe-verb.test.tsx`.
- Instrument per-verb counts so the frequency hypothesis can be checked after
  launch.
- Haptic feedback on a committed swipe belongs to the native shell (ADR-0047).
