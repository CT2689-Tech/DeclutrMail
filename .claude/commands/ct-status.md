---
description: Product-level "what happened, what's left" summary of the current session
---

Summarise the work in this session for the founder, in **product language**.

The founder asks this repeatedly and has rejected technical answers before
(LEARNINGS/memory 2026-08-02: a 1165-line spec and file:line-led answers were
both rejected). They are not asking what you edited. They are asking **what
changed about the product, and what still needs them.**

## Rules

**Lead with impact on the user, never with the artifact.** Not "fixed
`computeReadRate` in senders.read-service.ts". Yes: "the app told you you'd
never opened a sender you read 96% of."

**One idea per paragraph, plain sentences.** No file paths, no line numbers,
no function names, no D-numbers, no gate names, no test-suite names in the
body. If a number makes it concrete, use it — "332 of your 615 senders" beats
"many senders". Prefer the founder's own reported symptom as the anchor.

**Quantify the blast radius whenever it is known.** The difference between
"a copy bug" and "this misrepresented half your mailbox" is the whole point.

**Say what was verified, and how — in one clause.** "Verified against your
real mailbox" or "reproduced live, then re-checked after the fix". Never claim
done without saying what proved it.

**Own the misses.** If verification caught a bug in your OWN fix, say so
plainly and say what it would have done to the user. If a review finding was
wrong and you refuted it, say that too, with the evidence in one line. Do not
launder either into passive voice.

**Never pad with process.** Commits, branches, CI job names, gate agents,
merge mechanics belong in at most one closing line, not in the body.

## Shape

1. **What was wrong and what it did to the user** — one short paragraph per
   distinct problem, ordered by severity. Bold the lead sentence of each.
2. **What's fixed and proven** — one or two sentences, concrete.
3. **What's left** — split into:
   - **Decisions only the founder can make.** For each: one plain sentence of
     what the choice is, then a `> **Recommendation:**` blockquote with a
     clear pick and the one reason that drives it. Never present a menu with
     no recommendation, and never surface a choice that is really about
     agent effort or wall-clock — decide those yourself (memory:
     `decide-dont-defer-when-effort-is-claudes`).
   - **Optional follow-ups** — one line each, with an offer to do it.
4. **One closing status line** — PR number, red/green, nothing more.

## Length

Aim for something readable in under a minute. If it runs past ~400 words,
you are describing implementation, not product. Cut.

## Argument

Optional. A bare `/ct-status` covers the whole session. An argument narrows the
scope to that topic (e.g. `/ct-status billing`) — summarise only that thread,
same rules.

## What NOT to do

- Do not re-derive or re-investigate anything. This is a report on work
  already done, not a new pass. If something is genuinely unknown, say
  "not verified" rather than guessing.
- Do not restate the full session chronologically. Group by problem, not by
  the order you happened to work.
- Do not include a table of file changes.
- Do not end with "let me know if you have questions" — end with the
  decision you need.
