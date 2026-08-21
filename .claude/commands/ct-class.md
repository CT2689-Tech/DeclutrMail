---
description: Take one reported symptom, name the defect class behind it, and sweep the whole product for every other instance — issue → cause → verdict → trust score
---

The founder reports ONE thing they saw. Find every other place the same
mechanism is live.

This command exists because of a standing order (memory:
`fix-the-class-not-the-instance`): a fix that repairs only the reported
instance leaves its siblings shipping. The founder should never have to
report the same bug twice wearing a different screen.

## Argument

- Bare `/ct-class` — use the most recent thing the founder reported in this
  session. If that is ambiguous, say which symptom you took and continue;
  do not stop to ask.
- `/ct-class <symptom>` — that symptom, in their words.
- `/ct-class F###` — an already-triaged FINDINGS.md entry.

## Step 1 — Name the class, not the symptom

The class is the **mechanism** that produced the symptom, stated so it could
apply to code that has nothing to do with the reported screen.

Too narrow (this is the symptom): "the Archive pill has no percentage."
Too broad (this is a genre, and it will match everything): "UI shows wrong data."
Right (this is the mechanism): "**a UI state gated on a numeric threshold that
one whole subpopulation of the producing distribution can never reach**."

Test your class statement two ways before you search:

- **Would it survive a rewrite?** If the class dies when someone renames a
  component, it is a symptom.
- **Can you say what it is NOT?** A class that excludes nothing will "find"
  fifty instances and you will have to throw them all away.

Write the class in one sentence at the top of the report. Everything below
either instantiates it or is cut.

## Step 2 — Prove it on the reported instance FIRST

You cannot sweep for a mechanism you have not confirmed once. Follow
`superpowers:systematic-debugging` on the reported instance until you have
the actual cause with evidence — a query result, an enumeration, a
reproduction. If the reported instance turns out to be working as designed,
say so and stop; there is no class to sweep.

## Step 3 — Prove your SEARCH before you trust its silence

Whatever you are about to grep, run it and confirm **it rediscovers the
reported instance**. A sweep whose query cannot find the bug you already know
about did not find zero instances — it asked zero questions.

This is the founder's own blind-guard rule (memory: `ui-truth-bug-class`) and
it is not optional. State in the report which query was used and that it hit
the known instance. If it does not, fix the query and try again.

## Step 4 — Sweep on more than one axis

Grepping the code shape alone finds the copies and misses the class. Run at
least the axes that apply:

- **Shape** — the same expression, constant, or comparison elsewhere.
- **Reachability** — for every threshold, enumerate what the PRODUCER can
  actually emit and compare it to what the CONSUMER requires. This is where
  dead gates live, and it never shows up in a grep.
- **Consumers** — every other reader of the same field, table, or endpoint.
  The reported screen is rarely the only one.
- **Provenance** — did a value's distribution move (a re-weight, a new
  window, a schema change) while a constant sized for the old one stayed put?
  Check git log on the producer, not just the consumer.
- **Layer** — the same mechanism in the API, a worker, a SQL predicate, or a
  copy string, not only in `apps/web`.

Say which axes you ran. An axis you skipped is a gap, not an absence.

## Step 5 — Try to kill every candidate before reporting it

For each hit, argue the other side: is this reachable in practice, does a
guard upstream already prevent it, is the population actually empty? Verify
with real data where real data exists — the dev DB carries the founder's own
mailbox. Cut anything that survives only as a hunch. A short list of proven
instances beats a long list that has to be re-litigated.

**Never invent a value to make an instance concrete** (memory:
`never-fabricate-data-values`). Query it or label it unmeasured.

## Format

Open with the class, then the blast radius in one line ("4 live instances
across Triage, Autopilot and the Senders aggregate"). Then one block per
instance, worst first:

### N. <what a user would notice, in plain product language>

**Issue.** One or two sentences: what the product does wrong, in terms of
what a user experiences. Not what the code does.

**Cause.** The mechanism, with the specific number or path that proves it.
`path:line` is allowed here and only here.

**Verdict.** Is it live, is it reachable, who is affected, how often. Give the
count if you have one ("4 of 97 decisions on your own mailbox"). If it is
theoretically reachable but nobody hits it, say that — it changes the fix.

**Trust <N>/10.**

Close with:

- **Fixes** — one line each, grouped by whether they are safe to just do.
- **Needs the founder** — anything touching a destructive verb, automation
  reach, billing, privacy, or production data (CLAUDE.md §9). Do not decide
  these. Name them and point at `/ct-decide`.
- **Filed** — offer to append each confirmed instance to `FINDINGS.md` via
  `/ct-finding`. Do not write the file unless asked.

## The trust score

A number from 1 to 10 where **10 = certain this instance is real**. It scores
your EVIDENCE, not the severity and not the fix. This is a different axis from
`/ct-decide`'s safety score — do not blend them.

- **9–10** — observed. Reproduced live, or the wrong value queried out of a
  real database, or the screenshot shows it.
- **7–8** — proven from code plus an exhaustive enumeration of the producing
  range. Not run, but it cannot be otherwise.
- **5–6** — the code path plainly reads this way and nothing upstream stops
  it, but neither run nor enumerated.
- **3–4** — pattern-matched. Same shape as a confirmed instance; the specific
  reachability is unchecked.
- **1–2** — suspicion. Do not report it. Go check, or drop it.

Anything below 7 must say in one clause what would move it up, and what you
would have to run to get there.

## Rules

- **No fixes in this command.** Report the class. Fixing is a separate,
  explicit instruction — sweeping and patching in one pass is how a
  three-line report becomes a forty-file diff.
- **Do not report the reported instance as a discovery.** It is instance
  zero; it anchors the class and it goes first, labelled as the one they
  already saw.
- **Zero instances is a real answer** — but only after Step 3. Say which
  queries ran and that the known instance was found by them.
- **Cap it.** More than about six instances means the class is too broad. Go
  back to Step 1 and split it.
