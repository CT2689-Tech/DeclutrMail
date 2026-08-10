# ADR-0031: Protection evidence splits into strong / weak / manual, and only the weak half gets reviewed

- **Status:** Proposed — needs founder ratification (see FOUNDER-FOLLOWUPS 2026-08-10)
- **Date:** 2026-08-10 (documenting a rule shipped in #483, recorded nowhere)
- **Deciders:** founder (brief of 2026-08-08), Claude
- **Related D-decisions:** D245 (protection semantics), D112 (step-5 pin)

## Context

D245 names three explainable signals that may auto-protect a sender —
at least three replies, a message starred in the past year, at least
three Gmail-important messages in the past year — plus the user's own
Protect. It says nothing about whether those four reasons are equally
trustworthy.

The `protect_important` onboarding review (#483) needed exactly that
second-order judgment: which protections are safe to celebrate, and
which are worth a second look. The founder's build brief decided it,
the code ships it, and `packages/shared/src/copy/protection.ts` now
exports it (`WEAK_PROTECTION_REASON_IDS`, `isWeakProtectionReason`) —
but no D-number and no ADR recorded the rule. The architecture review
of 2026-08-10 flagged the gap: the API split, the onboarding contract
(`OnboardingProtectionSplit`) and two FE surfaces all depend on a
taxonomy that existed only as code.

Per the 2026-07-28 D-vs-ADR split, this is an ADR: it has no build
status of its own — it is a rule that constrains how every future
protection surface gets written.

## Decision

Protection reasons carry one of three evidence strengths:

| Strength   | Reasons                      | Why                                                                                                                                         |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strong** | `replied`                    | A reply is a two-way relationship. The user chose to write back, repeatedly — nothing to second-guess.                                      |
| **Weak**   | `starred`, `gmail_important` | One-way signals. A star or an importance flag marks a MESSAGE, not a correspondent; a single stray star shields a sender's whole mail flow. |
| **Manual** | `user_defined`               | The user's own decision. Neither reassurance material nor review material — it is not ours to celebrate or to question.                     |

The split is **definitional, not tuned**: it follows from what each
signal is (two-way vs one-way vs deliberate), not from a threshold that
could drift. Consequences:

1. **Review surfaces show the weak half.** Strong protections are the
   reassurance headline; manual protections are counted (absence from
   the review must never read as absence from the mailbox — see #485)
   but never listed for second-guessing.
2. **The taxonomy lives in one module** —
   `@declutrmail/shared/copy/protection.ts`. Consumers derive from
   `WEAK_PROTECTION_REASON_IDS` / `isWeakProtectionReason`; a second
   copy of the reason list (including inside a SQL string) is the drift
   this ADR exists to forbid.
3. **A reason outside the taxonomy is bucketed nowhere.** Counts log
   and exclude it; copy renders the honest minimum ("it is Protected").
   Guessing a bucket is how an unknown enum value becomes a false
   statement about the user's own actions.
4. **The feedback loop is the unprotect rate.** The `sender_unprotected`
   event (reason × surface) is the only signal that a D245 threshold is
   mistuned — a weak reason with a high unprotect rate is the argument
   for revisiting D245's signal list, which remains a founder decision.

## Consequences

**Positive:** every future protection surface (Brief, Screener,
digests) inherits one answer to "which protections deserve scrutiny"
instead of re-deriving it; the shared module makes drift a compile-time
or test-time failure.

**Negative:** the strength of `gmail_important` is Gmail's judgment,
not ours — if Gmail's importance model improves, "weak" may become too
harsh a label. That is a future amendment to this ADR, not a per-surface
override.

**Neutral:** `manual` senders being invisible to review surfaces means a
mistaken manual Protect is only correctable from Settings → Protected
senders or Sender Detail — deliberate, since questioning the user's own
explicit call is not this product's place.
