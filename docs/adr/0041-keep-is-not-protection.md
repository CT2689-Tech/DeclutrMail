# ADR-0041: Keep is not protection, and reach is controlled on one screen

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** founder, Claude
- **Related D-decisions:** D226, D227, D245

## Context

Two questions came out of a review of the mandatory action preview, and
both had more than one defensible answer. Neither is written down
anywhere, and both had already been answered wrongly once — by me, in
this repo, on the same night — so they are recorded here as rules rather
than left to be re-derived.

### What Keep means

Keep writes an activity row with zero affected messages, which is what
drops the sender out of the triage queue, and a sender policy row that
**no reader anywhere filters on**. It does not rewrite the triage
verdict: a sender's row still read `verdict='unsubscribe'` immediately
after a Keep, traced live on the dev mailbox.

Autopilot reduces its candidate set with `filter((s) =>
!s.signals.isProtected)` and nothing else. The Brief's noise group does
the same. So a Kept sender is shielded from no automatic rule at all.

On the reference mailbox: **809 senders carry a Keep decision, 625 are
separately Protected, leaving 184 Kept but unshielded.**

The obvious repair is to make Keep suppress Autopilot. That is what the
word suggests, and it would quietly move those 184 senders from reachable
to shielded.

### Where reach is controlled

The senders screen lets a cleanup say "only mail older than three
months". Triage does not — it passes no window, so every Archive there
sweeps the sender's whole inbox history. The same verb, on the same
sender, reaches differently depending on which screen you are standing
on.

## Decision

**Keep is a triage decision, not a safety state.** Protect is the only
thing that stops an automatic action. Keep means _not now_; it does not
mean _never_. Do not add a second shield keyed on the Keep policy, and do
not treat the stored Keep state as protection anywhere.

The preview says this in the product, out loud: _"Keep is not Protect —
Autopilot rules can still act on this sender."_

**Triage stays all-or-nothing; the senders screen is the precise one.**
Triage is a speed surface answered one key at a time, and a five-chip
window control per decision is the wrong trade there. The split is
allowed to stand _only while the triage copy keeps saying so_ — the title
reads "Archive **all** inbox email from …" and that word is load-bearing,
not decoration.

## Consequences

- Someone will propose Keep-as-shield again, because the word invites it.
  The answer is here, with the number: two overlapping protections and no
  way to tell a user which one saved a sender.
- The Keep policy row remains written and unread. The founder declined
  retiring it (2026-08-27); it is dead state, not a bug, and dropping it
  is a tidy-up available whenever.
- If anyone removes the word "all" from the triage preview title, the
  reach split becomes a lie and this ADR is violated even though no
  behaviour changed.
- A future manual ranking control must stay a separate concept, per D245.
  Neither Keep nor Protect is a ranking.

## Alternatives rejected

- **Keep suppresses Autopilot.** Rejected: it gives Keep an invisible
  second meaning that overlaps Protect, and Protect is the state the
  product can already explain to a user.
- **Add the window control to Triage.** Rejected: it taxes the one
  surface built for one-key answers to remove an inconsistency the copy
  already discloses.
- **Remove the window from the senders screen.** Rejected outright:
  consistency by subtraction, taking away a control that works.
