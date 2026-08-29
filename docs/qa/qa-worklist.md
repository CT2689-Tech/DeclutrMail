# QA worklist

Every finding that survived a `finding-refuter` in a `/ct-qa` run, and the state
of its fix. Written by `/ct-qa` (see `.claude/commands/ct-qa.md` §8).

**The ledger is frozen the moment a run ends; this file and `FINDINGS.md` both
keep moving.** They move for different reasons, which is why they are three
files and not one:

| File                   | Answers                                          | Lifecycle                            |
| ---------------------- | ------------------------------------------------ | ------------------------------------ |
| `docs/qa/launch-qa.md` | What happened in a run?                          | Append-only, frozen once written     |
| `FINDINGS.md`          | What is an open question about the product?      | P0/P1 only, triaged by `/ct-finding` |
| **this file**          | What is being fixed, by whom, and how far along? | Rows move in place, across runs      |

A survivor appears in the ledger always, here always, and in `FINDINGS.md` only
if it is P0/P1 — so a P0/P1 sits in three files and a P2/P3 in two. None of that
is duplication. `FINDINGS.md` tracks whether a product question is still open and
is not QA-specific; this file tracks approval and the Codex handoff, which
nothing else does; the ledger cannot track either, because it is frozen.

**Ids carry the date of the run that FIRST filed the row**, not the run that last
touched it — `QA-triage-20260827-01` was filed on 2026-08-27 and keeps that id
for life, however many later runs re-confirm it. A bare `QA-triage-01` would
collide with the next triage run and silently re-point every PR and sweep that
cited it; re-dating an inherited row on each run would do the same thing more
slowly.

**Rows are grouped by job, not by run.** A job's rows accumulate in one section
across every run of it, because a row outlives the run that found it and the
question this file answers is "what is still open on Triage", not "what did
Tuesday's run say". Per-run counts — survived, refuted, inherited — belong in
the ledger, which is the run record.

## Rules

- **The run fixes; Codex reviews adversarially.** The independent check sits at
  review time, not authoring time — a reviewer reading a real diff sees what a
  written brief cannot describe. No row reaches `Fixed` on the fixer's own
  say-so, however small the diff.
- **A repeat run inherits these rows before filing new ones.** A row still open
  from a previous run of the same job is the same defect: re-confirm it, or close
  it as `Gone` or `Refuted` with the check you ran. Never re-file it under a
  fresh id. Only a genuinely new survivor gets a new id.
- **Moving a row TOWARD a fix needs the founder.** `Open → Approved` is theirs
  alone; no answer is a complete outcome and the row stays `Open`.
- **Moving a row OUT on evidence does not.** A run may close a row as `Gone` or
  `Refuted` without asking, because that is recording that work is not needed,
  not doing work. State what you ran; an unverified close is worse than an open
  row, because it stops anyone looking again.
- **Tier 1 items** (CLAUDE.md §2 — billing, OAuth scopes, token crypto, webhook
  auth, prod migrations, deletion, privacy) are flagged and approved on their
  own, never inside a bulk approval.
- **A candidate refuted before filing never appears here at all** — it lost
  before it was work, and lives only in the ledger's Refuted table. A row already
  on this list that a later run refutes is different: it stays, as `Refuted`,
  pointing at the ledger entry that killed it.
- **Rows are never deleted.** `Won't do`, `Refuted` and `Gone` keep their reason.
  The trail is the point.

## States

Not a single line — a row has four ways out, and only one of them is a fix that
landed.

|     | state                 | means                                                                                              | who can set it        |
| --- | --------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| ⬜  | `Open`                | Filed and unapproved. The resting state.                                                           | a run                 |
| ⬜  | `Approved`            | Founder said fix it. Nothing is touched before this.                                               | founder only          |
| ⬜  | `Approved — queued`   | Approved, not yet started. Name what it is waiting on.                                             | a run                 |
| 🟡  | `Fixing`              | Diff in progress on a branch.                                                                      | a run                 |
| 🟡  | `In review`           | Diff sent to Codex for adversarial review.                                                         | a run                 |
| 🟡  | `Review found <n>`    | Review landed findings. Row returns to `Fixing`.                                                   | a run                 |
| 🟡  | `PR #n`               | A review passed against **this** diff, not an ancestor; branch proposed. Name the reviewed commit. | a run                 |
| 🔵  | `Merged #n`           | Landed on main. NOT `Fixed` — no run has re-checked the symptom yet.                               | a run                 |
| 🟢  | `Fixed YYYY-MM-DD`    | Merged **and** a later run confirmed the symptom is gone.                                          | a run, after checking |
| 🟢  | `Gone YYYY-MM-DD`     | No longer reproduces, no fix attributable to it. Say what you ran.                                 | a run, after checking |
| 🟢  | `Refuted YYYY-MM-DD`  | New evidence killed the finding itself. Point at the ledger row.                                   | a run                 |
| 🔴  | `At review cap`       | Two substantive rounds ran. Goes to the founder to ship or keep reviewing. Name the last commit.   | a run                 |
| ⏸️  | `Won't do YYYY-MM-DD` | Founder declined. Keep the reason.                                                                 | founder only          |

`Fixed` and `Gone` are deliberately separate: "we fixed it" and "it stopped
happening and nobody knows why" are different facts, and collapsing them hides
the second — which is usually the more interesting one.

A row may reach `Gone` or `Refuted` straight from `Open` without passing through
approval. That is not a skipped step; it is the row leaving without work.

**`In review` is not a formality.** A row that goes `Fixing → PR #n` without it
was self-approved by the session that wrote both the finding and the fix, which
is the one combination this pipeline exists to prevent.

**And it is not a one-shot — but it does terminate.** A SUBSTANTIVE response to a
review (behaviour, wire shape, rendered string, an assertion) sends the row back
through `Fixing → In review`. A mechanical one (formatter, lint autofix, comment,
a rebase that resolved cleanly) does not; name it on the row instead.

A round is CLEAN when it returns nothing you had to act on, and a clean round
ends the loop. **Two substantive rounds is the cap** — if a third would be
needed, the row goes to the founder with what each round found, because at that
point either the diff is too big or the finding under it is wrong, and another
lap will not say which. The row names the commit the clean round ran against.

---

## triage

Rows accumulate across every `/ct-qa triage` run. Per-run counts are in the
ledger. First filed 2026-08-27 (15 survivors, 4 refuted before filing).

**Scan the first column.** It collapses the twelve states above into the same
six glyphs `IMPLEMENTATION-LOG.md` uses (CLAUDE.md §8), so nothing new has to be
learned to read it:

⬜ pending · 🟡 being worked · 🔵 shipped, not yet re-checked · 🟢 closed ·
🔴 needs the founder · ⏸️ won't do

The glyph answers "is this still on me?" and nothing else — 🟢 covers `Fixed`,
`Gone` and `Refuted` alike, which are three different reasons a row is finished.
The `status` column keeps that distinction; this one deliberately throws it away.

**🔵 means merged, and nothing short of it.** An open PR is 🟡, however green its
checks: a proposed branch is work in flight, and a column that reads "shipped"
for an unmerged diff tells you the one thing you were scanning to find out. The
line is `Merged #n`, not `PR #n`.

**As of 2026-08-29: 🔵 16 shipped · ⬜ 3 pending · 🟢 0 confirmed.** This line
is a hand-count and goes stale the moment a row moves —
it carries a date so you can see that, rather than trusting a number nothing
regenerates. A run that moves a row updates it.

|     | id                    | sev                       | one line                                                                                                                                                        | status                                | PR   |
| --- | --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---- |
| 🔵  | QA-triage-20260827-01 | P1                        | The daily queue's `ORDER BY` has no tiebreak, so _which_ 12 senders appear is undefined and any write reshuffles the list under the reader                      | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260827-02 | P1                        | "LAST SEEN today" is false for 849 of the 954 rows that assert a recency; the open back-end half of merged PR #258                                              | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260827-03 | P1                        | "reduce future noise by ~10%" measures mail already received, while Archive and Later both declare future email unchanged                                       | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260827-04 | P2 · **Tier 1 (billing)** | The Free-tier cap is one `::int` from inverting, and its spec runs on PGlite rather than the production driver                                                  | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-05 | P2                        | D30's adaptive 5–12 queue size is dead code — no client ever calls `queue-size`, so everyone gets the hard max 12                                               | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-06 | P2                        | The Triage empty state says new decisions arrive after a sync; the queue refills from already-scored rows with no sync                                          | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-07 | P2                        | One measurement, two names on the same card: the row says "marked read", the tile and bullet say "read rate"                                                    | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-08 | P2                        | "You'll see the affected email before anything changes" names Keep first, and Keep has no preview by design (D40)                                               | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-09 | P2                        | The undo deadline renders in UTC in the toast and in the reader's zone in the preview, two clicks apart                                                         | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-10 | P2                        | Two stat tiles are windowed and two are not, with nothing saying so; at 375px "90D" orphans onto its own line                                                   | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-11 | P2                        | The preview's footer — reversibility line, Cancel, confirm — sits below the fold on a 375px phone                                                               | Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-triage-20260827-12 | P3                        | The `K · A · U · L · D` legend renders from first paint, but the keys do nothing until a row is expanded                                                        | Merged #663 — awaiting confirming run | #663 |
| ⬜  | QA-triage-20260827-13 | P3                        | Rows 2–12 show a bare `›` while row 1 shows a rationale, reading as "row 1 loaded and the rest failed"                                                          | Open                                  |      |
| ⬜  | QA-triage-20260827-14 | P3                        | A sender with no inbox mail occupies a decision slot with no signal until the preview opens                                                                     | Open                                  |      |
| 🔵  | QA-triage-20260828-04 | P2                        | Protecting a queued sender updates the rows but not the Today strip, so the strip keeps naming a subset the rows no longer contain                              | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260828-03 | P2                        | The Today strip and the rows it summarises are separate queries pulled apart by four independent paths, so they can describe different windows and queue copies | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260828-02 | P3                        | "The last 90 days" is implemented independently in 4+ places with no shared definition; nothing makes them agree                                                | Merged #663 — awaiting confirming run | #663 |
| 🔵  | QA-triage-20260828-01 | P2                        | "LAST SEEN today" is shown for mail that arrived yesterday — the label buckets by elapsed hours, not calendar day                                               | Merged #663 — awaiting confirming run | #663 |
| ⬜  | QA-triage-20260827-15 | P3                        | The H1 and queue legend give an unscoped count, and no "done for today" state ever renders to correct it                                                        | Open                                  |      |

### Review rounds — QA-01 / QA-02 / QA-03

The three P1s share one branch, so they are reviewed as one diff.

| round | ran against | verdict            | what it returned                                                                                                                                                                                                         |
| ----- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —     | `da7d4073`  | cancelled          | Dispatched against an ancestor of the final diff. Superseded, not counted.                                                                                                                                               |
| 1     | `d9554423`  | **substantive**    | **4 findings** (2 High, 1 Medium, 1 Low) covering **5 distinct defects** — its first bundled two independent mechanisms. 4 areas nothing-found. All reproduced; all fixed in `933a3e89`.                                 |
| 2     | `933a3e89`  | **substantive**    | 1 Medium, 1 Low. Re-cleared all four of round 1's nothing-found areas and confirmed the five round-1 tests have teeth. Both fixed in `dc36daab`.                                                                         |
| —     | `dc36daab`  | **over-corrected** | The round-2 fix anchored the window to the UTC day, making Triage the only surface in the product not reading 90 days as rolling. Caught at stop-review; reverted in `5bea2db0`, which keeps the within-request sharing. |
| —     | —           | **cap reached**    | Two substantive rounds. No round 3: at this point either the diff is too big or the finding under it is wrong, and another lap cannot say which. Founder call.                                                           |

**Round 1's four findings, numbered as the reviewer numbered them.** Finding 1
carries two independent defects, which is why the fix commit lists five items
and this table counts four. Both are true; the count that governs the row
status is the reviewer's, because `Review found <n>` records what came back,
not how it decomposed.

1. **High** — the noise share is not the ratio it claims. Two mechanisms, each
   fixable alone, each sufficient to make the number false:
   - **(a) Mismatched windows.** The numerator cut at `Date.now() - 90d`, the
     denominator at `todayStartUtc - 90d` — up to a day apart, so the share
     spanned two different periods. Worst just before midnight UTC.
   - **(b) A clamp over a detected inconsistency.** `Math.min(100, …)` printed
     exactly "100%" for a raw ratio above 1, which can only occur when the two
     non-transactional reads disagree. The most confident claim available,
     produced from evidence that the inputs did not agree.
2. **High** — a missing `noiseSenderCount` restored the exact falsehood
   `d9554423` removed. Nothing validates the wire, so an older API revision
   omits it, and `undefined < 12` is false — which fell into the whole-queue
   branch. **The fix's own new field was the regression vector.**
3. **Medium** — `MAX(internal_date)` was not inbound-filtered while the counts
   beside it were, so outbound mail under a shared sender key rendered "LAST
   SEEN today". Same defect class as QA-02, one column over.
4. **Low** — the equal-count branch was plural unconditionally: "1 sender
   decision. These senders sent …".

Nothing-found areas: the Protected override (the display verdict is applied
before `noiseRows` is built, so a protected Archive contributes to neither the
count nor the numerator), the nullable `lastDays` consumers, the total-order
fixture, and the tiebreak's effect on D30 queue size.

**Round 2 found the trap round 1's fix walked into.** Round 1's window fix
threaded one cutoff through a single request. But the rows and the strip reach
the user through DIFFERENT requests — `/queue` and `/today-summary`, each
invalidated separately — so each still derived its own rolling cutoff, and the
strip could claim a share above a row whose own 90-day count read 0. There is
no instant to share across two HTTP requests, only a rule both re-derive; the
cutoff is now anchored to the UTC day. **The first fix was the wrong half of
the problem, and only a reader looking at the request boundary saw it.**

Round 2's second finding: the clamp removal had no test and could not have one,
because the state that triggers it cannot be staged through the database. The
decision is now a pure `noiseSharePct(queuedNoise, total)` the spec calls
directly.

**The round-2 fix then over-corrected, and that is worth more than either
finding.** Round 2 observed that `/queue` and `/today-summary` derive separate
instants. It never prescribed a remedy. The remedy chosen — anchor the window
to the UTC day — closed a rare, invisible drift by opening a permanent, visible
one: the scorer writes "1% read rate over the last 90 days" into the row's own
reasoning text on a ROLLING window, and the stat tile directly above that
sentence would have rendered a 90-to-91-day number for the same sender. Same
card, two windows.

Every other 90-day read in the product is rolling (`score.worker.ts`
`NINETY_DAYS_MS`, `activity.read-service.ts`, `actions.service.ts`). Reverted
in `5bea2db0`; the within-request sharing that fixes the actual defect stays.

**The lesson is not "the reviewer was wrong".** It is that a finding names a
problem, not a fix, and the fix is where the next defect gets introduced —
three times in this branch now. The residue round 2 named is documented at the
helper with an explicit instruction not to close it by anchoring Triage alone.

**Round 1 is the evidence FOR the inversion, not its cause.** The pipeline was
inverted by founder instruction in `6ae06847`, ten minutes before `d9554423` —
the commit round 1 reviewed — so round 1 could not have caused it. The reasons
it was inverted are the two failed handoffs recorded below.

What round 1 bought is separable from why it was commissioned: three of the
five defects were introduced by the fixing session's own diff, and finding 2 is
one it could not have caught by reading its own code — it needs a reader asking
what the wire does when the producer is a version behind. A self-approved
`Fixing → PR` would have shipped every one of them.

### Smoke — 2026-08-28, `dc36daab`, real mailbox

Dev stack restarted so `:4000` served this branch; verified its cwd. Signed in
via the D206 dev login as `chintan.a.thakkar@gmail.com` (12 queued decisions,
12,368 inbound messages in the anchored 90-day window).

| what               | result                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strip copy         | "12 sender decisions. These senders sent ~9% of the email you received in the last 90 days." Past tense; plural correct for 12 of 12 non-Keep.               |
| Share arithmetic   | `/queue` non-Keep `last90dMessages` sum = 1126; anchored denominator = 12368; 1126/12368 = 9.1% → **9**, matching `/today-summary` from a SEPARATE request.  |
| `lastDays` honesty | Returns 0, 1, 2 and 45 — varied, where the bug collapsed every row to 0. All five spot-checked senders match `MAX(internal_date)` for inbound mail exactly.  |
| The 45-day sender  | "Thomas Dixon \| Red State Legacy" renders **LAST SEEN 45d**. Last inbound 2026-07-13. This row read "today" before the fix.                                 |
| D226 preview       | Renders for Archive; 283 matches the row's RECEIVED and the DB inbound count. Escaped without confirming — **no new `action_jobs` row**, so nothing mutated. |
| Console            | Clean.                                                                                                                                                       |
| 375px              | Strip wraps, no overflow.                                                                                                                                    |

**This is the driver boundary the spec suite structurally cannot reach.** The
`lastDays` defect existed because a raw `sql` fragment carries no decoder, so
postgres.js returned a STRING where PGlite returns a `Date` — which is why no
test could ever reproduce it. The varied values above are that path executing
correctly against the real driver.

**What the smoke did NOT prove.** This mailbox's anchored and rolling
denominators differ by only 5 messages (12368 vs 12363) and both round to 9%,
so the data cannot discriminate the two rules — which is why cross-surface
consistency, not this run, decided it. Re-smoked after the revert: rolling
returns the same 9%, the same 1126-message numerator and the same `lastDays`
including the 45. Nor did any queued sender have outbound mail under a shared
key, so the inbound-`MAX` fix's own effect is covered by spec only.

**QA-triage-20260828-01, filed from the smoke above, is NOT fixed in this
branch.** `lastDays` is `floor(elapsed_hours / 24)`, so `0` means "within 24
hours" while the label renders "today". Temu's newest inbound message was
2026-08-27 14:14 PDT — 11.1 hours before the smoke, and one calendar day back.
The screen said today.

It is the same class as QA-02 (a recency label asserting more than the data
supports) by a different mechanism, and it is on a surface this branch already
touches, which normally means fixing it here. It is deliberately not fixed
here anyway: an honest fix needs the timestamp on the wire so the client can
compare calendar days in the reader's own zone, and adding an unreviewed wire
field to a diff that just hit its two-round review cap repeats the exact
mistake round 1 caught — a new required field nothing validates. It goes in
the next branch, reviewed on its own.

Strongest objection on record, for the founder: `lastDays` is documented as an
elapsed-day count, so "today" could be read as shorthand for "in the last 24
hours". Rejected as a defence of the copy — the label is what the user reads,
and no user reads "today" as "since this time yesterday" at 01:00.

**QA-triage-20260828-03** is the residue round 2 named and the revert left
standing. It is PRE-EXISTING — every version of this code derived a fresh
instant per request — but the branch should not close by pretending otherwise.

The remedy is **one query, not one window rule and not one patched call
site.** An earlier draft of this note said "only the refetch after a decision
splits them" and named `invalidateAfterDecision` as the fix. That was wrong,
and wrong in the dangerous direction: it would have fixed a fraction while
looking complete. Four paths pull the keys apart —

1. `invalidateAfterDecision` marks all three stale as three separate refetches;
2. `useRefreshStaleRead` (D25) invalidates the queue key **alone**;
3. `use-sender-policy` invalidates the queue key alone as well — and that one
   is QA-triage-20260828-04 below, a present bug rather than drift;
4. all three query options carry `staleTime: 30_000` independently, so they
   refetch on whichever component remounts or refocuses first, with no
   mutation involved at all.

So the strip must stop being a separately-fetched query: one bootstrap query
key, rows and strip both selecting from it. One query is one instant and one
copy of the queue, and every existing invalidator covers it automatically
because only one key remains.

Not done here: it moves the query keys, the SSR boundary, the strip's fetching
half and their tests, on a branch already at its review cap. It is the natural
first item of the next branch.

**QA-triage-20260828-04 is the sharp end of it, and this branch made it
sharper.** `listQueue` rewrites a protected sender's verdict to `keep`, and the
strip's subset is `verdict !== 'keep'` — so protecting a queued sender moves
`noiseSenderCount` and `noiseReductionPct`. `use-sender-policy` invalidates
`TRIAGE_QUEUE_KEY` and `SCREENER_QUEUE_KEY` and not `TODAY_SUMMARY_KEY`, so the
rows update and the strip does not.

The staleness pre-dates this branch. Its consequence does not: before
`d9554423` the sentence did not depend on `noiseSenderCount`, and now its
SUBJECT does. A stale summary used to show an old percentage; it can now also
choose the wrong subject — "These senders sent…" over a queue where one row has
just become Keep. Widening the blast radius of a gap that was already there,
without noticing it, is worth recording as its own kind of mistake.

**QA-triage-20260828-02** is the class behind the over-correction above. "The
last 90 days" is spelled out separately in `score.worker.ts`,
`activity.read-service.ts`, `actions.service.ts` and `triage.read-service.ts`,
with nothing holding them to one definition — which is exactly why changing one
of them in isolation looked safe and was not. A shared constant would have made
the anchoring change fail loudly instead of silently disagreeing with the
sentence beside it. Not fixed here: it spans four modules well outside this
diff, and this branch is at its review cap.

### What this branch ships, and what it deliberately does not

Merged as #663: the three P1s, plus QA-12 and all four rows filed during the
2026-08-28 smoke and reviews. The unsubscribe kill switch
(`FOUNDER-FOLLOWUPS.md`) landed with it, corrected twice afterwards in #664 and
#665. **It does not unblock QA of that surface** — the gate built on it was
withdrawn the day it was written, and `U` stays unpressed. See "Blocked, not
findable — still" below.

**QA-13, QA-14 and QA-15 are NOT fixed, and each is held for a reason rather
than skipped.**

- **QA-13** (row 1 shows a rationale, rows 2–12 a bare `›`) is D26's deliberate
  hero-only reasoning. Changing it is a design decision on a screen under the
  PR-3 freeze, not a defect fix, and it wants the founder's eye rather than a
  guess at the end of a long branch.
- **QA-14** (a sender with no inbox mail occupying a decision slot) needs a new
  signal on the row — data and design, not copy.
- **QA-15** (the count reads as a total; nothing says "done for today") is
  entangled with QA-06, which is approved but not yet built: the empty state
  currently claims new decisions arrive after a sync, and the queue refills
  from already-scored rows with no sync. Adding a second claim about refill
  cadence before that one is settled risks shipping the same falsehood twice.
  These two go together, in that order.

**Pipeline changed 2026-08-28 — Codex no longer writes these fixes.** The run
writes them and Codex reviews the diff adversarially. The two attempts at the
old arrangement are why: a written brief is a lossy channel, and it lost data
silently both times. The first dispatch got an inline argument the runtime
compressed from ~230 lines to 28 without saying so; the second was pointed at a
brief file that was still uncommitted, so it did not exist in the worktree Codex
ran from and the path resolved to nothing. A diff has no such channel — it is
the artifact, already in the repo.

`docs/qa/handoffs/QA-triage-20260827-01-02-03.md` and `…-04.md` are kept, and
still earn their place: they hold each finding's evidence, traced cause,
acceptance criterion and the refuter's surviving objection. They are now the
dossier used to _write_ the fix and to brief the _reviewer_, rather than a
specification handed to an author who has no other context.

A third Codex run had produced a partial fix before this change; it was
cancelled and its diff discarded rather than adopted, because a review of work
Codex itself wrote would be circular. The diff is kept out-of-tree for
comparison only.

**Id note.** The two Codex handoffs dispatched on 2026-08-27 cite the short form
(`QA-triage-01`…`-04`), which was the scheme at the time. Those PRs map to
`QA-triage-20260827-01`…`-04`. The dated form is correct from here on.

**Sequencing — the block is lifted.** QA-triage-20260827-05 through
QA-triage-20260827-11 were held because they edit the same files as
QA-01/02/03 (`triage.read-service.ts`, `triage-row-expanded.tsx`,
`triage-row.tsx`), and two authors in those files at once produce conflicting
branches rather than parallel progress. That branch merged as #663 on
2026-08-27, so the seven go out as one sweep whenever the founder starts them.
QA-04 is isolated in the entitlements service and was never blocked by the
file overlap — only by the queue.

**Not offered, and why.** Four candidates died to the refuters and are not on
this list: the undo/category-label claim (the run compared a DB row against a
Gmail read whose tool strips `CATEGORY_*`), re-score-on-expand (D25
`stale_refresh`, built to a founder decision), the reorder's _named cause_ (real
symptom, wrong mechanism — the surviving version is QA-triage-20260827-01), and
"8,036 decisions hidden" (of 8,051 scored senders only 147 are actionable, so
printing the larger number would have been the bigger falsehood — the surviving
remnant is QA-triage-20260827-15). Detail in the ledger's Refuted table.

**Blocked, not findable — still.** Unsubscribe execution and the `U` keystroke
have never been exercised, by any route, on any run. `UnsubExecutionWorker`
performs a real one-click POST to the sender's host from the founder's address,
and it is irreversible (D58 — no undo). **Nothing below the unsubscribe preview
has been QA'd**, and the surface stays reviewed by reading, not driving.

A kill switch now exists and is sound: `UNSUB_SEND_ENABLED`, **fail-closed** —
anything other than the exact string `true` refuses, the API refuses at the
enqueue boundary before any write, and production boot asserts the flag so the
refusal cannot silently reach a real user. Shipped in #663, corrected twice
(#664, #665).

**It does not authorise pressing `U`.** A gate that said it did was written on
2026-08-28 and withdrawn the same day. Its first check — grep `.env.local` for
the flag — passes in four situations where the running app still sends, each
demonstrated rather than argued: a quoted `UNSUB_SEND_ENABLED="true"` parses to
`true` while the grep returns 0; an exported shell variable beats the env file;
a process booted before the line was removed keeps the old value; and the
second check ran _after_ the press it was meant to guard. Reading the live
process environment does not rescue it — this app injects config via
`node --env-file-if-exists`, so runtime variables are invisible to `ps eww` and
its zero is vacuous. The withdrawn gate and the evidence are in
`.claude/commands/ct-qa.md`.

`U` stays unpressed. **Never set the flag during a QA run.** Lifting this needs
a mechanism that makes a press unable to reach a real sender, not a check that
predicts it will be refused; the decision is open in `FOUNDER-FOLLOWUPS.md`.

### The 2026-08-28 sweep — QA-04 through QA-11, plus QA-undo-01/02/04

The sequencing block above named QA-05 through QA-11 as one sweep once #663
merged; QA-04 was isolated and already unblocked. All eight went out together
in one diff, alongside the three `undo`-job rows the founder approved in the
same session (QA-undo-01, -02, -04) — nine files touched by more than one row
(`undo-tray.tsx`'s timezone fix backs both QA-triage-09 and QA-undo-04's
second bullet; the Delete result-label string is duplicated three ways and
all three copies were fixed together), so one diff was the only sane unit to
review.

Each fix carries its own negative control in the fixing session (revert →
confirm RED → restore → confirm GREEN) — not yet a Codex round; that is a
different check; see "Rules" above. Committed as `4491c340` on
`claude/qa-ledger-pending-items-df5b47` and sent for review. `pnpm typecheck`
and the full `apps/api` + `apps/web` + `packages/shared` suites are green on
that commit.

| round | ran against | verdict         | what it returned                                                                                                                                                                                  |
| ----- | ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `4491c340`  | **substantive** | **3 blocking, 3 concern**, across 11 rows. All 3 blocking fixed in `8df9cbeb`.                                                                                                                    |
| 2     | `8df9cbeb`  | **CLEAN**       | Independently re-verified all 3 round-1 fixes are genuinely red-before-green against `4491c340`, plus the 2 sibling additions. 2 comment-accuracy nits only. Nothing to act on — round ends here. |

**Round 2's two comment nits, fixed mechanically in `f7f7929b`** (no
new round — a mechanical response per the Rules above): `summarizeActivity`
was called "uncalled" when the API controller does call it ("no web
caller" is the accurate claim); `undo-tray.tsx`'s corrected comment
attributed the baseline-hiding mechanism to `useUndoEntries` when it
actually lives in `ProductUndoTray`.

**Round 1's three blocking findings, and why each mattered:**

1. **QA-undo-20260828-01 — wrong function fixed.** The original fix
   landed on `summarizeActivity` (`activity.read-service.ts`), a DQ16
   share-receipt endpoint with no web caller. The live `/activity`
   metrics header reads a DIFFERENT, structurally near-identical
   function, `aggregateStats` (via `listActivity`) — still uncorrected,
   so the actual screen the row was filed against was untouched. The
   ledger row's own line-number citation (`:1071-1073`) pointed at
   `aggregateStats` all along; the fixing session matched it to the
   wrong function by name instead of by line. Fixed the real one, plus
   the "noise prevented" projection sitting 15 lines below it in the
   same function (same omission, same mechanism).
2. **QA-undo-20260828-04 — a 4th copy, missed.** The 3-copy sweep
   (`action-semantics.ts`, `triage/types.ts`, `senders/data.ts`) found
   every copy a grep for the exact old string turned up. It missed a
   4th, semantically-identical map with a DIFFERENT old value —
   `senders/api/adapters.ts`'s `ACTION_LABEL.delete: 'Deleted'` (no
   "to Gmail Trash" to begin with), feeding Sender Detail's own
   decision-history timeline. A string-literal grep cannot find a
   variant it isn't looking for; Codex found it by tracing every
   consumer of the underlying wire enum, not by grepping the fix text.
3. **QA-triage-20260827-04 — the test didn't test the fix.** The `::int`
   cast already existed before this diff, so postgres.js already
   decoded `used` as a number pre-commit — `typeof used === 'number'`
   passed on the OLD code too. The Number() wrapper is real defense in
   depth, but nothing distinguished pre- from post-fix behavior. Fixed
   by extracting the coercion into a pure `coerceUsedCount` function,
   unit-tested directly (genuinely red against the code as it stood
   before the diff).

**Round 1's three CONCERN findings — logged, not auto-fixed** (same
"logged sibling, not filed" pattern the ledger already uses elsewhere):
QA-triage-07's fixture/Storybook signal strings and the LLM adapter's
internal fact-label prompt still say "Read rate"; QA-triage-08's
marketing pages (`how-it-works`, JSON-LD, `llms.txt`) still claim a
universal preview — a different surface than the in-app copy this row
fixed. Two items surfaced in round 1 that WERE cheap enough to fix
immediately went into `8df9cbeb` anyway: `batch-action-sheet.tsx` had
the exact same non-sticky-footer defect as QA-triage-11's ActionSheet
(structurally identical dialog, worse odds of overflow), and QA-08's
ScreenIntro copy change had shipped with no regression test.

**Not touched, on purpose:** QA-archive-20260828-05 (design call, stays 🔴);
QA-triage-13/14/15 (P3, held for the same reasons recorded above); QA-undo-03
(P3, no code change proposed). Archive PR #670's merge is left to the founder
— not part of this sweep's scope.

## undo

Rows accumulate across every `/ct-qa undo` run. Per-run counts are in the
ledger. First filed 2026-08-28 (4 survivors; 3 candidates refuted before
filing — "no outcomes / nothing needs your attention" is a false claim
(see QA-undo-20260828-01's "What this is NOT"), the Delete preview's default
filter is a silent dead end, and its reach chip contradicts its own inbox
count — the last two died to measurement: the first is spec'd, Delete-only,
and self-annotated (6.5% of sends even hit it, one click clears it); the
second compared two numbers from two different UI moments that cannot
coexist on one frame).

|     | id                  | sev | one line                                                                                                                                                                  | status                                                        | PR   |
| --- | ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---- |
| 🔵  | QA-undo-20260828-01 | P1  | Activity's own verb-count tiles include actions the user already undid while a different tile row on the same page correctly excludes them — no label says which is which | Approved this session — Merged #671 — awaiting confirming run | #671 |
| 🔵  | QA-undo-20260828-02 | P2  | `/activity`'s stat row ships the desktop 5-column grid before hydration at 375px, so "UNSUBSCRIBES" and "KEPT" briefly overprint each other                               | Approved this session — Merged #671 — awaiting confirming run | #671 |
| ⬜  | QA-undo-20260828-03 | P3  | The "Recovered" outcome tile can never register a user's own Undo (a different mechanism entirely — retried-after-failure jobs) and nothing in the product defines it     | Open                                                          |      |
| 🔵  | QA-undo-20260828-04 | P2  | Delete's own verb name disappears across 6 result surfaces, and its undo deadline repeats the two-clock mechanism already filed on `triage`, now on a second surface      | Approved this session — Merged #671 — awaiting confirming run | #671 |

### QA-undo-20260828-01 — inconsistent undo/reverted-action exclusion

**Core mechanism.** `activity_log.reverted_at` is a terminal-state fact
(stamped in the same transaction as the undo-journal flip). Different
aggregates over `activity_log` take opposite, undisclosed positions on
whether a reverted row still counts.

**Anchor evidence, live-verified this run.** The `window=7d` "This week"
metrics panel (`activity-screen.tsx:3587`) reads `ARCHIVED 3 / DELETED 1` for
the SAME window the "Your last 7 days" outcome tiles read `0/0/0/0/0` for.
Confirmed via SQL: exactly 4 `activity_log` rows exist in that 7-day window,
and **all 4 have `reverted_at` set** — they are two real actions performed and
undone in this QA session (Archive of `classicfirearms.com`, Delete of
`ukpos.com`) plus inherited rows from the prior session's run. `summarizeActivity`
(`apps/api/src/activity/activity.read-service.ts:1071-1073`, `byVerb`) applies
no `reverted_at` filter; `persistedReviewOutcomeExpression`
(`apps/api/src/activity/activity.read-service.ts:1248-1291`) explicitly does
(`when activityLog.revertedAt is not null then null`). Neither tile row
carries a tooltip saying so.

**What this is NOT** (refuted, do not re-file): "No outcomes in the last 7
days. Nothing needs your attention." is NOT a false or contradictory
statement — it is entailed true (gated on 5 zero tiles, which entails
`failed=0`, which is exactly the separate `needsAttention` condition), and
every one of the 4 rows renders an explicit `UNDONE` badge one panel below,
so the screen is coherent, not self-contradicting. The original "Recovered
tile" framing is also not this — see QA-undo-20260828-03, filed separately
at P3.

**Siblings — same mechanism, found by `defect-class-sweeper`, not
independently re-refuted (recorded per finding, not filed as separate rows;
promote any of these to its own row if a future run re-confirms it live):**

- Triage's Today strip credits Autopilot with messages the user has since
  undone — "DeclutrMail handled N automatically"
  (`apps/api/src/triage/triage.read-service.ts:1211-1222`, no `reverted_at`
  filter; contrast `packages/workers/src/weekly-value-receipt.worker.ts:301`,
  which filters correctly on the identical shape — proof this is an omission,
  not a house convention). **Tier 1b** (public-facing benefit-accuracy claim).
- "Noise prevented per month" keeps a sender's full 90-day volume in its
  projection after the user undoes the archive that would have deflected it
  — the highest-magnitude overclaim of the set, since the error multiplies by
  sender volume, not action count
  (`apps/api/src/activity/activity.read-service.ts:1041-1065`). **Tier 1b.**
- Two of Autopilot's four dismiss-reasons (`superseded`, `entitlement`) are
  produced but accepted by no consumer — those matches vanish from both the
  Skipped/Protected tiles and the Activity feed entirely
  (`autopilot.read-service.ts:604-619,972`; consumers at
  `activity.read-service.ts:669,805` only accept `user`/`protected`).
  `entitlement` fires on a billing downgrade.
- The `Protected` tile (same row as Recovered) is narrow but not dead —
  reachable only via a race between an active-mode rule match and the sender
  becoming Protected before the sweep runs
  (`packages/workers/src/autopilot-action.worker.ts:929-933`) — same bare
  label, same absence of any explanation.

Six unmeasured per-instance counts (SQL provided by the sweeper) are needed
before any of the siblings move past "live in principle" — see the sweep
output; not reproduced here to keep this row's evidence to what was actually
re-verified.

**Regression test:** a spec on `summarizeActivity` (or wherever `byVerb` is
computed) that seeds one archived-then-reverted row and asserts the returned
count for that verb is 0, not 1 — must go RED against today's code first.

**Editor pass addendum (`usability-editor`, source-verified, not
independently re-refuted beyond the editor's own tracing):** the two panels
share a window label ("Your last 7 days" / "THIS WEEK") that is the actual
reason a reader assumes one denominator — propose distinguishing them
("Still in effect · last 7 days" / "THIS WEEK · ACTIONS TAKEN"), generated
from the same `windowToLabel` helper so "This window (30 days)" and "All
time" get the same qualifier for free. "Nothing needs your attention" is
true under the code's definition and false under the reader's — propose
"Nothing failed and nothing is waiting on you. Actions you undid are not
counted here." The `Skipped`/`Protected` tiles are a third population
entirely (`rule_match_log.dismiss_reason`, not an action outcome at all),
and "Protected · 0" collides head-on with D245's standing safety-state
name — propose "Skipped by you" / "Skipped: protected".

### QA-undo-20260828-02 — 375px hydration flash on the metrics grid

**Cause, corrected by `finding-refuter` using headless-Chromium frame
capture:** `apps/web/src/features/activity/activity-screen.tsx:686`'s
`MetricsHeader` gates its mobile restack on `useIsAtMost('sm')`, whose
`useState(false)` default means the server-rendered HTML ships the desktop
`repeat(5, minmax(0, 1fr))` grid at every viewport width. At a real 375×812
viewport the collision is visible for ~390ms in local dev (production window
unmeasured) before the client-side effect fires and the grid restacks to
`repeat(3, minmax(0px, 1fr))`, at which point Unsubscribes and Kept land on
separate rows and the layout is correct. Self-corrects; no persistent state,
no wrong number.

The fix shape is already written down: `LEARNINGS.md:1348` names CSS-driven
mobile restacking (inline `<style>` media queries, no JS-gated default) as
the pattern that avoids this class of post-hydration flash. Not a duplicate
finding — the fix is pre-decided, just not applied to this component.

**Not swept further this run** (scope discipline — one job per run): the
refuter noted 8 call sites across 7 screens gate `gridTemplateColumns` on
`useIsAtMost`, meaning all 8 ship desktop-first SSR markup by the same
pattern. Worth a dedicated `defect-class-sweeper` pass in a future run; not
run here since this component is adjacent to, not part of, the `undo` job.

**Regression test:** a Playwright/Storybook check that renders at 375px
before JS executes (or throttles to catch the pre-hydration frame) and
asserts no two stat labels' bounding boxes overlap — must go RED against
today's code first.

### QA-undo-20260828-03 — "Recovered" tile is permanently dead for Undo, and undefined

**Corrected by `finding-refuter`:** the original claim (undo caused a specific
"0 Recovered" a user would notice and misread) does not survive — this
account has zero `action_jobs` with `recovery_attempt > 0` ever, so the tile
was never going to move for any reason, and the surrounding screen gives the
user positive confirmation via the per-row `UNDONE` badge and, for Archive,
visibly-restored mail. What survives: the tile's _mechanism_ genuinely can
never be triggered by a user's own Undo — only by a failed action's retry
succeeding, a structurally different, currently-unused code path
(`apps/api/src/activity/activity.read-service.ts:1248-1266`, gated by the
`action_jobs` schema CHECK `recovery_attempt = 0 ⟺ root_action_id IS NULL`)
— and nothing in the product defines this anywhere a user could learn it: no
tooltip on the tile (`apps/web/src/features/activity/weekly-review-card.tsx:9`,
bare label), and the page's own contextual-help panel ("Which Undo or
recovery option applies?") describes exactly two recovery mechanisms
("Activity Undo" and "Gmail Trash recovery") and never uses the word
"Recovered" or ties it to either.

Downgraded from the original P1 framing to P3: a vocabulary gap, not a false
belief about what happened to the user's mail.

**Regression test:** none proposed — this is a copy/definition gap, not a
logic defect; the fix is a tooltip or glossary entry, not a code change with
a meaningful red/green assertion.

**Editor pass addendum (`usability-editor`):** proposed replacement label
"Fixed on retry" (states what the tile actually measures — a failed action
whose retry succeeded — instead of a word a reader maps onto Undo) and,
same tile, "Clear recovered filter" → "Show all outcomes" (drop the raw
wire-enum interpolation from user-facing copy).

### QA-undo-20260828-04 — Delete's result copy and undo deadline are each stated in two inconsistent forms

**Filed from `usability-editor`, not put through a dedicated
`finding-refuter`** (scope/budget call — see the run notes in the ledger;
each item below is independently source-traced by the editor with file:line,
not a raw screen impression). P2: friction and inconsistency, nothing
unreachable, nothing false.

- **Delete's own verb disappears from every result surface.** Button `🗑
Delete` → banner "Moved to Gmail Trash" → toast "Moved to Gmail Trash" →
  Activity row "Moved to Gmail Trash" → Activity tile "DELETED" → filter chip
  "Deleted". One shared string (`resultLabel`,
  `packages/shared/src/actions/activity-record-copy.ts:16`) feeds all of
  them; Archive/Later/Keep trace clean. Propose "Deleted to Gmail Trash".
- **Second live instance of `QA-triage-20260827-09`'s two-clock mechanism,**
  now on the undo surface itself rather than the triage preview: the banner
  states the deadline in the reader's zone
  (`receipt-strip.tsx:186-193`, matches `activity-screen.tsx`'s own
  `formatExpiry`, which has a test pinning that behavior,
  `activity-screen.test.tsx:996-1000`) while the toast hardcodes UTC
  (`undo-tray.tsx:343`). Same fix as the original row: drop the hardcoded
  `timeZone: 'UTC'`.
- Lower-priority, same pass, not separately verified against a live screen
  this run: verbosity trims on the Delete preview's recovery-facts banner
  and empty-state copy, and a computed (not measured) 375px stacking-order
  concern on `/activity`'s intro + help + weekly-card + metrics stack. Full
  detail, exact replacement text, and file:line for all of these are in the
  editor pass transcript; not reproduced here because they were not each
  independently re-verified live.

**Regression test:** none — copy consistency, not logic.

## archive

Rows accumulate across every `/ct-qa archive` run. Per-run counts are in the
ledger. First filed 2026-08-28 (6 survivors; 3 candidates refuted before
filing — a claimed D226 preview-bypass, a claimed triple last-seen
mismatch, and a claimed rationale-vs-stat mismatch; see the ledger's
Refuted table for the grounds on each).

**Shipped 2026-08-28, [PR #670](https://github.com/CT2689-Tech/DeclutrMail/pull/670):**
QA-archive-20260828-01, -02, -03, -04, -06 (5 of 6 — pushed, opened, Codex
round 2 clean, awaiting merge). **Not in that PR:** QA-archive-20260828-05,
attempted and reverted — stays 🔴, open for a founder design call, tracked
separately below.

|     | id                     | sev | one line                                                                                                                                                                                           | status                                                                                                                              | PR   |
| --- | ---------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🟡  | QA-archive-20260828-01 | P2  | The Triage volume tile shows a 90-day-derived average unlabelled as such, while the adjacent read-rate tile on the same row does label its window                                                  | PR #670 — Codex round 2 clean on `b369f4ab`, pushed & opened, awaiting merge                                                        | #670 |
| 🟡  | QA-archive-20260828-02 | P2  | The D226 action-preview dialog — the one screen a destructive mutation cannot skip — renders frozen LLM rationale text with no staleness indicator, unlike every other place the same text renders | PR #670 — Codex round 2 clean on `b369f4ab`; live-verified (Victoria's Secret Panty Party, "Scored today" now renders)              | #670 |
| 🟡  | QA-archive-20260828-03 | P2  | Sender Detail renders "today" and "yesterday" for the same last-seen fact via three independently-written day-math algorithms on one page                                                          | PR #670 — Codex round 2 clean on `b369f4ab`; live-verified (Pepperfry `updates.pepperfry.com`, a 14h-old message reads "yesterday") | #670 |
| 🟡  | QA-archive-20260828-04 | P3  | "Show this in the row next time" describes where the preview renders, not that it skips the dialog, and not that the choice is per-verb                                                            | PR #670 — Codex round 2 clean on `b369f4ab`, pushed & opened, awaiting merge                                                        | #670 |
| 🔴  | QA-archive-20260828-05 | P3  | The same "preview before anything changes" idea is worded three different ways across the Triage row, Triage modal, and Senders bulk modal                                                         | Attempted, reverted — see note below. **Not in PR #670.**                                                                           |      |
| 🟡  | QA-archive-20260828-06 | P3  | Activity's per-row source label uses the internal enum voice "VIA MANUAL" instead of "by you"                                                                                                      | PR #670 — Codex round 2 clean on `b369f4ab`, pushed & opened, awaiting merge                                                        | #670 |

**QA-archive-20260828-05, attempted and reverted.** The proposed fix
(matching the Triage row toolbar's static hint to the inline preview's
eyebrow, both "Preview · before anything changes") is unsafe as filed: the
toolbar hint and the inline preview render SIMULTANEOUSLY once a verb is
selected (`triage-row.tsx` mounts `ActionToolbar` on `expanded` and
`ActionPreviewPresentation` on `inlinePreview`, independently). Making the
two strings byte-identical broke `triage-screen.actions.test.tsx` with
`TestingLibraryElementError: Found multiple elements with the text: Preview
· before anything changes` — caught by running the existing suite, not by a
negative control, because the collision is a NEW defect the fix itself
would introduce, not the one being fixed. The original three-way "one
concept, three headers" framing also doesn't hold up: the toolbar hint has
no verb selected yet at its own render point (it renders before any K/A/U/L/D
press), so "PREVIEW · ARCHIVE" isn't a coherent target for it the way the
finding's proposed fix assumed. Reverted to the original `action-toolbar.tsx`
text in both files (Triage and Sender Detail) — net diff on those two files
is zero. Left `Open` would be wrong (nothing safe was identified to change);
marked 🔴 instead — this needs a design call (rename one of the two texts to
something that doesn't collide, or accept the toolbar hint is a different
kind of copy than a preview header and leave it as is), not a wording tweak.

### Review rounds — QA-01 / QA-02 / QA-03 / QA-04 / QA-06

One diff, reviewed as one unit (all five ride the same PR).

| round | ran against | verdict         | what it returned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ----------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `19f01ef6`  | **substantive** | Label missing "avg" + a stale doc comment (-01); zero test coverage for the new age-label branch (-02); the fix's own comments claimed a "Last seen" stat tile coexists on Sender Detail and that two lists share `last_seen_at` — both false (`StatsStrip` was replaced by `KpiStrip`, unmounted); a real hydration-mismatch risk left in place (`formatRelative` still called `Date.now()` ambiently on a page with no `ssr:false` boundary) (-03); mobile branch of the source-label fix had no test (-06). All fixed in `b369f4ab`. |
| 2     | `b369f4ab`  | **CLEAN**       | Independently re-verified the hydration fix is correct and complete, the TZ-independent test's math holds under 5 timezones tried by hand (UTC, Pacific/Kiritimati, America/Los_Angeles, Asia/Kathmandu, Australia/Lord_Howe), and agreed with all four declined-scope calls below. Nothing to act on — round ends here.                                                                                                                                                                                                                |

**Declined, on record (Codex agreed with each in round 2, flagged as separate pre-existing debt, not blockers):**

- `scoredAgeLabel` returning `null` for a future-skewed `scoredAt` — documented-intentional (`engine-read-age.ts`'s own comment), shared by the two pre-existing call sites this fix's third call site copies exactly.
- A `null` (not `undefined`) `scoredAt` rendering "Scored ~57 years ago" via epoch-zero — pre-existing gap in the shared helper (typed `string | undefined`, not `| null`, and no call site guards `null`). Worth its own fix; not touched here.
- The remember-preference checkbox's `aria-label` overrides its descendant explanation sentence for screen readers — the exact same structural pattern existed pre-`19f01ef6`; this diff changed only the string. A real accessibility gap, needs `aria-describedby`, not this diff's scope.
- An unawaited preference-persistence `PATCH` with no `onError` (`triage-screen.tsx`, `use-me-settings.ts`) can leave the checkbox's local state out of sync with what's actually persisted on failure — unrelated code path to the copy-only change QA-04 made.

### QA-archive-20260828-02 — frozen rationale, no age, inside the one dialog that gates a real mutation

**Not independently live-verified this run — sourced from `defect-class-sweeper`,
file:line only, no browser confirmation.** Flagged at P2 rather than dropped
because of where it sits: `apps/web/src/features/triage/action-preview-presentation.tsx:241`
and `apps/web/src/features/screener/decide-preview.tsx:297` render the frozen
`triage_decisions.reasoning` sentence with no `ageLabel`, while
`triage-row-expanded.tsx:121`, `triage-row.tsx:423`, `screener-row.tsx:347`,
and `recommendation-banner.tsx:60` all carry one for the identical text. The
seed for the wider class — a rationale's embedded numbers (`monthlyVolume`,
read rate, unsubscribe channel) freezing at score time while a live
recomputation of the same fact renders elsewhere — was independently
confirmed live this run for one instance (see Refuted table: the founder
run's own "36 vs 109" read was a misattribution, but the underlying
frozen-vs-live split is real and documented in ADR-0037's own "Negative"
consequences section). Re-scoring cadence: `RESCORE_TTL_MS = 7d`
(`score.worker.ts:112`), but the sweep found **no producer actually enqueues
the sweep** — refresh is lazy, on-open, once per sender per tab session
(`use-refresh-stale-read.ts:11`) — so a sender never re-opened can carry an
arbitrarily stale rationale into the one dialog a destructive verb cannot
bypass. **Needs a live re-drive before this moves past Open**, since the
sweeper has no shell/DB access to confirm the staleness magnitude on a real
row.

**Siblings, same mechanism, not independently filed (sweeper output, full
list in the agent transcript):** read rate stated in the frozen sentence vs.
`triage.read-service.ts:751`'s live figure on the same expanded row;
unsubscribe channel named in the frozen `ruleLabel` vs. `senders.unsubscribe_method`
(unmeasured — sweeper gave the exact SQL); the template-fallback path
(`generated_by='template'`) carries the identical two numbers, so it is not
LLM-only.

**Live-verified after the fix.** Opened the D226 preview for Victoria's
Secret Panty Party from `/triage` — "Why we suggested this:" now shows
"Scored today" beside it, matching the pattern already used on
`triage-row-expanded.tsx` and `triage-row.tsx`. The "needs a live re-drive"
condition above is satisfied; this moved to `PR ready` on the strength of
that plus Codex's round-2 clean (see Review rounds above).

### QA-archive-20260828-03 — three day-math algorithms disagreeing on Sender Detail

**Not independently live-verified this run — sourced from `defect-class-sweeper`,
file:line only.** `apps/web/src/features/senders/detail/sender-detail-page.tsx:1428`
uses `Math.round(ms/86400000)` (round-to-nearest, a fourth variant the sweep
had not seen elsewhere), `apps/web/src/features/senders/detail/data.ts:39`
uses `Math.floor(...)`, and `apps/web/src/features/senders/api/adapters.ts:111`
uses the calendar-midnight `daysSince` shared with the Senders grid
(post-#663). Three independent implementations on one page can render
"today" and "yesterday" for the same underlying `last_seen_at` value — the
sweeper's worked example: a message 13 hours old rounds to "yesterday" and
floors to "today". This is a sibling of the seed candidate filed this run
(Senders grid vs. action-preview header, ≤1-day disagreement near local
midnight — see the ledger's Refuted table, where the narrower claim survived
adversarial review but the reviewer doubted it cleared the filing bar on its
own). Sender Detail is a stronger instance because both numbers are visible
on ONE page with no user action between them, not two separate widgets a
reader might not compare. **Needs a live re-drive** (open Sender Detail for
a sender last seen 12-20 hours ago local time) before this moves past Open.

**Siblings, same mechanism, not independently filed:** Triage's "Scored
{today/yesterday}" engine-age line (`packages/shared/src/copy/engine-read-age.ts:39`,
24h-floor) beside `lastSeenLabel` (calendar-round) on the same row; Autopilot
match-reason copy (`score.worker.ts:995`, `autopilot-signals.ts:213`, both
24h-floor, rendered via `autopilot-presets.ts:305,330`) which never meets the
calendar-round card it explains; two byte-identical `relativeTime` helpers
(`activity-screen.tsx:3624`, `followups-screen.tsx:594`) that currently agree
but have no shared source; and unrounded fractional-day thresholds gating
`dormant`/quiet classification (`senders.read-service.ts:1987`,
`followup.read-service.ts:264`) — sizing needs
`SELECT count(*) FROM senders WHERE extract(epoch from now()-last_seen_at)/86400 BETWEEN 89.5 AND 90.5;`
per the sweeper, not yet run.

**Live-verified after the fix, and the original filing corrected.** The
"Last seen" stat tile claimed above does not actually coexist on this page —
`StatsStrip` was replaced by `KpiStrip` (which has no last-seen stat) before
this run; Codex caught the misattribution during round-1 review and the
worklist's own comments were corrected in `b369f4ab`. The real, narrower
claim — Recent Messages and the Decision Timeline disagree with each other,
not with a third tile — reproduced live: a message from `updates.pepperfry.com`
received 2026-08-27 22:21:08 PDT (14h before the check) read "yesterday" in
Recent Messages after the fix, where the pre-fix `Math.round` timeline
algorithm would have read "today." The "needs a live re-drive" condition is
satisfied; this moved to `PR ready` on the strength of that plus Codex's
round-2 clean (see Review rounds above).

### QA-archive-20260828-01, -04, -05, -06 — filed from `usability-editor`, not put through a dedicated `finding-refuter`

**Scope/budget call, same as `QA-undo-20260828-04`'s precedent** — each item
below is copy I drove and captured verbatim live this run, then handed to the
editor for source-tracing and exact replacement text; none of the four was
independently re-attacked by a `finding-refuter`. All are P2/P3: friction and
inconsistency, nothing unreachable, nothing false enough to block the job.

- **-01, P2 — "33 PER MONTH" is `round(last90d / 3)`** (`apps/web/src/features/triage/data.ts:149`)
  shown unwindowed, while the adjacent read-rate tile on the same row states
  its own window (`triage-row-expanded.tsx:62`, "READ RATE 90D"). Propose
  `"33 /mo avg · 90d"`.
- **-04, P3 — the remember-preference checkbox undersells what it does.**
  Current: "Show this in the row next time — the same preview will appear
  below the sender. You can change this in Settings." It flips
  `rememberPreference[verb]` to `'inline'` per verb
  (`apps/web/src/features/triage/triage-screen.tsx:1068`) — it skips the
  modal dialog, not just relocates it, and the choice is Archive-only, not
  global. Propose "Skip this dialog for Archive — the preview shows in the
  row instead. Change in Settings."
- **-05, P3 — one concept, three headers.** Triage row: "PREVIEW BEFORE
  ANYTHING CHANGES". Triage modal: "PREVIEW · ARCHIVE". Senders bulk modal:
  "PREVIEW · BEFORE ANYTHING CHANGES". Propose "PREVIEW · ARCHIVE" (or the
  active verb) on all three.
- **-06, P3 — Activity's source column reads "VIA MANUAL"**
  (`apps/web/src/features/activity/activity-screen.tsx:2219,2524`), the only
  enum-voice string on a page that otherwise speaks in plain sentences.
  Propose "by you".

Also observed, not filed as new: the toast's full timezone+minute timestamp
("ACTIVITY UNDO UNTIL SEP 27, 2026, 11:07 AM PDT") and the D226 dialog's
"Why do I review this before confirming?" disclosure (which restates
everything already on screen) are verbose but not incorrect — logged in the
editor's transcript, not given their own rows. The 375px Archive-preview
confirm-button-below-fold problem was independently re-observed this run but
is **not** re-filed here — it is the still-open `QA-triage-20260827-11`,
carried on the `triage` job since that is where it was first filed.

**Regression test:** none of the six — copy/labelling consistency and a
staleness gap, not logic defects with a clean red/green boundary.

## onboarding

Rows accumulate across every `/ct-qa onboarding` run. Per-run counts are in
the ledger. First filed 2026-08-28 (5 survivors; 4 candidates refuted before
filing — a claimed fake sync-stage checklist, a claimed wrong-button-primary
on the failed-sync screen, and two narrowed-to-nothing edges of the
fake-progress-on-error claim; see the ledger's Refuted table for the grounds
on each). Two of the five were caught, corroborated, or narrowed with the
help of `ct-qa-mailbox-switch-173132-64`, an independent peer QA session
running `/ct-qa mailbox-switch` concurrently on the same shared dev stack —
cited per row below.

|     | id                        | sev | one line                                                                                                                                                                                                                                                                                                                       | status                                                                                                                               | PR   |
| --- | ------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 🟡  | QA-onboarding-20260828-01 | P0  | `/senders` can assert something false about the user's own inbox during an active sync — it either denies any senders exist, or shows a stale pre-disconnect snapshot labelled with a "Synced through" time it never measured — reachable on ANY ordinary returning login mid-resync, not only reconnect                       | PR #673 — Codex 2 rounds (cap), both applied                                                                                         | #673 |
| 🟡  | QA-onboarding-20260828-02 | P1  | `AuthProvider`'s 401→OAuth redirect runs in the render body with no fire-once guard, duplicating an already-guarded sibling (`client.ts`'s `redirectToLogin`) — every session-expiry event fires 2 real navigations to Google's live OAuth start in production (3 in dev), burning the app's own rate-limit bucket meant for 1 | PR #673 — Codex round 1 found a real dead-end this fix introduced, fixed in `client.ts`, round 2 CLEAN on this row                   | #673 |
| 🔴  | QA-onboarding-20260828-03 | P1  | Refresh-token rotation revokes the whole session on any concurrent same-account refresh collision (two tabs racing the ~15-min access-token TTL edge) — no code path returns the same fresh tokens to the loser, and the DB schema has no column that could hold the value such a path would need                              | Open — founder deferred (Tier 1, needs a migration/grace-window design call, not folded into this batch)                             |      |
| 🟡  | QA-onboarding-20260828-04 | P1  | The `?mailbox=` secondary-connect gate shows a fake, never-resolving "Reading your inbox… 0%" scan instead of the reconnect gate when its target mailbox goes inactive out-of-band with no other active mailbox to escape to                                                                                                   | PR #673 — Codex round 1 found the guard was too broad (any sync error, not just NO_ACTIVE_MAILBOX), fixed, round 2 CLEAN on this row | #673 |
| 🟡  | QA-onboarding-20260828-05 | P2  | The no-active-mailbox gate's plain "Connect a Gmail account" button (not Reconnect) silently swallows a connect failure — same gate re-renders with no explanation and a stale `connect_error` param stuck in the URL; two dead copy keys exist for codes no path can emit, and one real code has no copy entry at all         | PR #673 — Codex round 2 found a history-state overwrite this fix's broadened reach exposed, fixed                                    | #673 |

**QA-onboarding-20260828-01.** Filed from a `flow-completeness-auditor` GAP,
adversarially confirmed (`SURVIVES`, no refutation ground applied) by a
`finding-refuter` pass that corrected the auditor's own cited evidence: a
fresh `/senders` load actually hits the "No active senders — No sender has
mailed you recently" branch (`senders-screen.tsx:2450-2466`), not the
syncing-aware empty state the auditor named — which is _worse_ for the
claim, not better, since it flatly denies data exists rather than
explaining why. Separately, the refuter traced that `markQueued`
(`apps/api/src/sync/sync.service.ts:123`) fires on **every** login, not just
reconnect, so this blind window opens on an ordinary returning sign-in
whenever a resync is in flight — a materially wider reach than the auditor
scoped. Readiness (`queued`/`syncing`) is surfaced nowhere in the app shell
except inside the collapsed account-menu dropdown
(`apps/web/src/features/mailboxes/account-menu.tsx:309-313`);
`SyncNowButton` returns `null` (absence, not a state) while not ready. The
sender index is torn down and reinserted in one transaction at the end of
initial sync (`initial-sync.worker.ts:1015-1027`), so a mid-resync list is
never partial — it is _stale-complete_, rendered under a "Synced through
&lt;asOf&gt;" strip whose `asOf` is server-compute time
(`senders.read-service.ts:1087,1413`), asserting a currency it never
measured. `STALE_SYNCING_AFTER_MS = 15 * 60 * 1000` is the system's own
statement that a legitimate sync can legitimately run 15 minutes — this is
not a narrow race.
**Regression test:** an e2e or component test asserting `/senders`'
first-paint copy for a mailbox with `readiness ∈ {queued, syncing}` and zero
`senders` rows — must go RED against current code (today it silently
renders "No active senders").

**QA-onboarding-20260828-02.** Filed from a live incident this run (network
log: `GET /api/auth/me → 401`, `POST /api/auth/refresh → 401`, then 3×
`GET /api/auth/google/start` — 2 `ERR_ABORTED`, 1 `429`), corroborated
independently by `ct-qa-mailbox-switch-173132-64` hitting the same shape on
its own run. Adversarially checked by two `finding-refuter` passes and a
`defect-class-sweeper`: the defect stands — `auth-provider.tsx:63-69` calls
`window.location.assign` directly in the render body, no `useEffect`, no
ref/module guard — but the severity claim narrowed twice. First refuter:
the observed `429` required prior consumption of the shared rate-limit
bucket this QA session generated itself (`dev-auth.controller.ts`'s own
`@RateLimit('auth')`), so "locks a legitimate user out" is unmeasured, not
shown; corrected claim is 2 navigations in prod (not "a lockout"). The
sweeper then proved the repeat-fire is a **production** path, not only
React StrictMode's dev double-invoke: `use-me.ts`'s `refetchInterval`
(15s while errored) and `refetchOnWindowFocus: true` both re-render
`AuthProvider` while the 401 persists, each re-firing the unguarded
`assign`. Zero sibling render-body-redirect instances found anywhere else
in `apps/web` (13 other navigation sites and 9 `router.replace`/`push`
sites all cleared with reasons) — this is one isolated instance, not a
class. `client.ts:310-315`'s `redirectToLogin()` already implements the
correct guarded pattern one file away.
**Regression test:** `auth-provider.test.tsx:128`'s
`toHaveBeenCalledOnce()` cannot fail against the current defect — `waitFor`
stops at the first poll where the count is 1. Needs: force a second settle
of the errored `me` query (fake-timer `refetchInterval` tick, or a second
`invalidateQueries`) and assert `assign` is STILL called exactly once —
must go RED against current code.

**QA-onboarding-20260828-03.** Filed from the same live incident as -02 plus
a direct read of `sessions.service.ts`'s doc comment (lines 130-132,
promising a "grace" branch) against its code (lines 149-214, one branch,
unconditional revoke). Corroborated independently by
`ct-qa-mailbox-switch-173132-64`'s own live repro ("two tabs racing
/api/auth/refresh... revoke the WHOLE session... hard-redirects to the real
live Google OAuth start with zero warning"). Two `finding-refuter` passes
and a `defect-class-sweeper` narrowed but did not kill it: no
`reuse detected` log line exists anywhere on this machine for THIS run's
specific incident, so the observed OAuth-redirect burst is not provably
attributable to this exact code path (could equally be `Missing refresh
cookie` / `Session not found or revoked`, which never reach the mismatch
branch) — and `sessions.service.spec.ts:220-225` states the revoke-on-any-
mismatch outcome is the intended defensive posture, not an oversight.
What survives: the sweeper proved the "grace" the comment promises is
**structurally unrepresentable**, not merely unwritten —
`packages/db/src/schema/active-sessions.ts` has exactly one
`refresh_token_hash` column, no slot for a prior value a grace branch could
compare against — and the FE's `pendingRefresh` single-flight
(`client.ts:260`) is per-tab, so it cannot prevent a genuinely
cross-tab/cross-device race. Reachable window: two tabs of the same real
user, both refreshing within the same ~15-minute access-token TTL
round-trip. The same sweep pass found two siblings, not filed as separate
rows this run pending their own refutation: a CSRF-token doc/code
contradiction (`csrf.service.ts` says the token is stable for the session's
life; `auth.controller.ts:196` reissues a new one on every refresh) and an
OAuth state-nonce single-cookie collision (`google-oauth.controller.ts`,
double-starting Gmail connect strands the earlier tab on raw API JSON) —
see the closing summary.
**Founder flag (Tier 1 — CLAUDE.md §9 token/session handling).** A real fix
needs a schema migration (a second stored hash, or a rotation grace window)
and touches D155's reuse-defense posture directly; the founder sets the
grace window, not the fixing session.
**Regression test:** two concurrent `rotate()` calls against the same
session row, presenting the SAME (still-valid) refresh token — today one
wins and one revokes the whole session; a fix should let both succeed (or
the loser get the winner's fresh tokens) without either being treated as
theft. Must go RED against current code.

**QA-onboarding-20260828-04.** Filed from a `flow-completeness-auditor` GAP,
narrowed hard by a `finding-refuter`: three of the four originally-claimed
triggers (a stale/foreign `?mailbox=` id, a 404 on a mailbox with no sync
row, an exhausted 5xx) are unreachable or self-healing — `markQueued`
inserts `provider_sync_state` in the same transaction as every mailbox
activation (no 404 is reachable), a `MAILBOX_NOT_OWNED` 409 only fires when
another mailbox IS active (exactly the condition under which the escape
hatch renders), and `refetchOnWindowFocus`/`refetchOnReconnect` both
default true so a transient 5xx self-heals on refocus. What survives: a
persistent `NO_ACTIVE_MAILBOX` 409 — the `?mailbox=` target went inactive
out-of-band (a disconnect or delete-indexed-data from another tab) with no
other active mailbox left to escape to. There, `escape` is `undefined`, the
focus-refetch keeps re-hitting the same 409, and the gate keeps asserting
`{queued, 0%}` — a progress bar for a scan that will never run — instead of
routing to the reconnect gate the rest of the app already has for this
exact account state.
**Regression test:** force `mailbox_accounts.status='disconnected'` for a
mailbox mid-`?mailbox=` visit with no other active mailbox on the account,
assert the reconnect gate renders instead of a progress bar — must go RED
against current code.

**QA-onboarding-20260828-05.** Filed from a `flow-completeness-auditor` GAP,
narrowed by a `finding-refuter`: the gate's **Reconnect** button actually
routes failures correctly (`?reactivateMailboxId=` → `/settings?
reconnect_result=…`, which mounts through Settings and fires its toast) —
the auditor's model matched dead copy keys
(`reconnect_account_mismatch`/`reconnect_target_invalid` in
`CONNECT_ERROR_COPY`) that no live code path can ever emit. What survives
is narrower: only the plain **Connect a Gmail account / Connect a different
Gmail account** button (no recovery target) redirects failures to
`/triage?connect_error=<code>`; since the mailbox still isn't active, the
app shell keeps rendering `NoActiveMailbox` instead of ever mounting the
triage page, so the toast hook that would explain the failure
(`useConnectResultToast`) never runs and the param dangles unexplained in
the URL. Reachable codes on this path:
`MAILBOX_OWNED_BY_OTHER_WORKSPACE`, `MAILBOX_DATA_DELETION_IN_PROGRESS`
(itself missing a `CONNECT_ERROR_COPY` entry — degrades further to a
generic "Could not connect that account"), and generic `connect_failed`.
**Regression test:** force a `connect_failed` redirect to
`/triage?connect_error=connect_failed` with `activeMailboxId=null`, assert
a toast (or equivalent explanation) renders on the no-active-mailbox gate —
must go RED against current code.

### Review rounds — QA-01 / QA-02 / QA-04 / QA-05

One diff, reviewed as one unit (all four ride the same PR; QA-03 is not in
this diff — founder-deferred, Tier 1).

| round | verdict         | what it returned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **substantive** | Real dead-end in -02's fix: removing `AuthProvider`'s own redirect left NO redirect path for a successful-refresh-then-still-401-replay, because `client.ts`'s own guard only fired on the FIRST 401, not the post-refresh replay — fixed in `client.ts`, both branches now redirect. Real over-broad guard in -04's fix: `trapped = sync.isError && !other` fired on any sync-status error, including a transient 5xx production keeps retryable — narrowed to the exact `NO_ACTIVE_MAILBOX` code via `apiErrorCode()`. Real test gap in -01: only `syncing` was tested, not `queued`, though the code checked both — added `queued` coverage. -05's toast-delivery concern investigated and NOT changed: the shared toast bus queues messages at a module level and delivers them to any `ToastHost` that mounts within the 3.6s expiry, so a not-yet-mounted host does not lose the toast in the common case; a narrow race (onboarding-state read hanging past 3.6s with no host ever mounting) is accepted, not fixed. |
| 2     | **substantive** | Two smaller findings: -01's "still syncing" copy promised growth ("will appear here" / "more will appear as it finishes") a resync hasn't earned — a mailbox with only dormant senders, or a resync that finds the same/fewer indexed senders, breaks the promise; reworded to "this list will update" / "this may change once it finishes". -05's URL-scrub overwrote `window.history.state` with `null` — harmless when the hook lived on one page, but it now mounts above the whole `(app)` branch ladder, so the overwrite reaches every route; fixed to preserve `window.history.state`, matching `settings-screen.tsx`'s own precedent for the identical pattern. Confirmed FIXED: -02 (redirect now fires on both terminal-401 paths) and -04 (guard now matches the exact error code).                                                                                                                                                                                                                             |

**Cap reached at two substantive rounds.** Both round-2 findings were
applied directly (small, well-scoped, verified by re-running the full
affected-area suite — 551/551 green — plus typecheck and lint) rather than
sending a third round, per the two-round cap. Founder sees this record
rather than a third Codex pass.
