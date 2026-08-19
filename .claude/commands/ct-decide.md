---
description: Surface every open decision that needs the founder, as question → cause → options → recommendation → verdict → safety score
---

Present every open decision currently blocking on the founder, in a format
they can answer by picking a number.

The founder asks for this repeatedly. They are not asking for a status update
— they are asking **"what needs me, and what should I pick?"**

## Before writing anything: decide what actually belongs here

A decision belongs in this list ONLY if the founder is the right person to
make it. Include:

- Anything touching a **destructive verb** (unsubscribe, delete, archive at
  scale), **auto-protection**, **billing**, **privacy/retention**, **OAuth
  scopes**, or **production data** — the CLAUDE.md §9 stop conditions.
- A **product-meaning** choice where more than one answer is defensible and
  the code cannot settle it.
- Anything that **changes what the product promises a user**.
- Work you have deliberately **not done** and want ratified.

Do NOT include:

- Anything that is really about **your** effort or wall-clock. Decide those
  yourself and say what you picked (`decide-dont-defer-when-effort-is-claudes`).
- Anything a convention, an existing decision, or the plan already answers —
  go read it and act.
- Questions you could answer by running a query, reading a file, or testing.
  **Go and check first.** A question that verification would have answered is
  not a decision, it is unfinished work.

If nothing qualifies, say exactly that in one line and stop. A padded
decision list trains the founder to ignore it.

## Format — one block per decision, numbered

### N. <the decision as a plain question>

**Question.** One sentence, in product language. What is being chosen, in
terms of what a user would experience. No file paths, no function names, no
D-numbers.

**Cause.** Two or three sentences: what is actually true that forces this
choice. Include the number that makes it concrete ("57 senders are protected
on replies that never happened"). If it came from a bug, say what the bug
does to a user, not what the code does.

**Options.** Every genuinely available path, including doing nothing when
that is real. For each:

```
**A — <short name>** · safety <N>/10
<One or two sentences: what happens, and the specific risk or cost.>
```

Order them best-first by your own judgement, not by safety score alone.
Always include the do-nothing option when it is defensible, and say plainly
when it is not.

**Recommendation.** One option, named, with the single reason that decides
it. Not a summary of the trade-offs — the reason you would pick it if it were
your company. If the recommendation is close, say it is close and what would
change your mind.

**Verdict.** The bottom line in one or two sentences: what happens if this is
left unanswered, and how confident you are. This is where you say "this is
reversible, take your time" or "this is live in production right now".

## The safety score

A number from 1 to 10 where **10 = safest**. It scores the OPTION, not how
much you like it. Anchor it:

- **9–10** — reversible in one click, no user-visible change, no data touched.
- **7–8** — reversible, but a user could notice; or touches data that can be
  recomputed.
- **5–6** — hard to reverse, or changes a promise the product makes; recoverable
  with effort.
- **3–4** — touches a destructive verb, auto-protection, billing, or production
  data. Recoverable only with a migration or a support conversation.
- **1–2** — irreversible for the user. Mail actually sent, unsubscribes actually
  delivered, data actually deleted.

State the basis in the option text whenever the score is below 7 — the number
alone is not an argument. Do not inflate a score to make a recommendation look
better; if you are recommending a 4, say why the 9 is worse.

## Rules

- **Never present a menu without a recommendation.** A list of options with no
  pick is work handed back.
- **Never invent a decision to fill the list.** Fewer, real ones.
- **Do not re-investigate.** Report decisions already surfaced by work already
  done. If a decision rests on something unverified, say "not verified" rather
  than guessing — or go verify it and then write the block.
- **Keep each block under ~150 words.** If it runs longer you are explaining
  implementation.
- End with a single line telling the founder how to answer (e.g. "Reply with
  `1A` and `2C`, or ask for more on any of them").

## Argument

Optional. Bare `/ct-decide` lists everything open. An argument narrows to one
topic (e.g. `/ct-decide autopilot`).
