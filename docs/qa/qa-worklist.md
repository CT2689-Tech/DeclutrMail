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

| state                 | means                                                                                              | who can set it        |
| --------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| `Open`                | Filed and unapproved. The resting state.                                                           | a run                 |
| `Approved`            | Founder said fix it. Nothing is touched before this.                                               | founder only          |
| `Approved — queued`   | Approved, not yet started. Name what it is waiting on.                                             | a run                 |
| `Fixing`              | Diff in progress on a branch.                                                                      | a run                 |
| `In review`           | Diff sent to Codex for adversarial review.                                                         | a run                 |
| `Review found <n>`    | Review landed findings. Row returns to `Fixing`.                                                   | a run                 |
| `PR #n`               | A review passed against **this** diff, not an ancestor; branch proposed. Name the reviewed commit. | a run                 |
| `Fixed YYYY-MM-DD`    | Merged **and** a later run confirmed the symptom is gone.                                          | a run, after checking |
| `Gone YYYY-MM-DD`     | No longer reproduces, no fix attributable to it. Say what you ran.                                 | a run, after checking |
| `Refuted YYYY-MM-DD`  | New evidence killed the finding itself. Point at the ledger row.                                   | a run                 |
| `At review cap`       | Two substantive rounds ran. Goes to the founder to ship or keep reviewing. Name the last commit.   | a run                 |
| `Won't do YYYY-MM-DD` | Founder declined. Keep the reason.                                                                 | founder only          |

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

| id                    | sev                       | one line                                                                                                                                     | status                                      | PR  |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --- |
| QA-triage-20260827-01 | P1                        | The daily queue's `ORDER BY` has no tiebreak, so _which_ 12 senders appear is undefined and any write reshuffles the list under the reader   | **At review cap** (5bea2db0) — founder call |     |
| QA-triage-20260827-02 | P1                        | "LAST SEEN today" is false for 849 of the 954 rows that assert a recency; the open back-end half of merged PR #258                           | **At review cap** (5bea2db0) — founder call |     |
| QA-triage-20260827-03 | P1                        | "reduce future noise by ~10%" measures mail already received, while Archive and Later both declare future email unchanged                    | **At review cap** (5bea2db0) — founder call |     |
| QA-triage-20260827-04 | P2 · **Tier 1 (billing)** | The Free-tier cap is one `::int` from inverting, and its spec runs on PGlite rather than the production driver                               | Approved — queued behind the P1 branch      |     |
| QA-triage-20260827-05 | P2                        | D30's adaptive 5–12 queue size is dead code — no client ever calls `queue-size`, so everyone gets the hard max 12                            | Approved — queued behind P1s                |     |
| QA-triage-20260827-06 | P2                        | The Triage empty state says new decisions arrive after a sync; the queue refills from already-scored rows with no sync                       | Approved — queued behind P1s                |     |
| QA-triage-20260827-07 | P2                        | One measurement, two names on the same card: the row says "marked read", the tile and bullet say "read rate"                                 | Approved — queued behind P1s                |     |
| QA-triage-20260827-08 | P2                        | "You'll see the affected email before anything changes" names Keep first, and Keep has no preview by design (D40)                            | Approved — queued behind P1s                |     |
| QA-triage-20260827-09 | P2                        | The undo deadline renders in UTC in the toast and in the reader's zone in the preview, two clicks apart                                      | Approved — queued behind P1s                |     |
| QA-triage-20260827-10 | P2                        | Two stat tiles are windowed and two are not, with nothing saying so; at 375px "90D" orphans onto its own line                                | Approved — queued behind P1s                |     |
| QA-triage-20260827-11 | P2                        | The preview's footer — reversibility line, Cancel, confirm — sits below the fold on a 375px phone                                            | Approved — queued behind P1s                |     |
| QA-triage-20260827-12 | P3                        | The `K · A · U · L · D` legend renders from first paint, but the keys do nothing until a row is expanded                                     | Open                                        |     |
| QA-triage-20260827-13 | P3                        | Rows 2–12 show a bare `›` while row 1 shows a rationale, reading as "row 1 loaded and the rest failed"                                       | Open                                        |     |
| QA-triage-20260827-14 | P3                        | A sender with no inbox mail occupies a decision slot with no signal until the preview opens                                                  | Open                                        |     |
| QA-triage-20260828-03 | P2                        | The Today strip and the rows it summarises are two requests, so after a decision they can describe different 90-day windows and queue copies | Open — remedy named                         |     |
| QA-triage-20260828-02 | P3                        | "The last 90 days" is implemented independently in 4+ places with no shared definition; nothing makes them agree                             | Open                                        |     |
| QA-triage-20260828-01 | P2                        | "LAST SEEN today" is shown for mail that arrived yesterday — the label buckets by elapsed hours, not calendar day                            | Open                                        |     |
| QA-triage-20260827-15 | P3                        | The H1 and queue legend give an unscoped count, and no "done for today" state ever renders to correct it                                     | Open                                        |     |

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

The remedy is **one request, not one window rule.** `getBootstrap` already
returns queue + stats + summary from a single `listQueue` promise, so the SSR
first paint has no drift. Only the client refetch after a decision splits them:
`invalidateAfterDecision` marks `TRIAGE_QUEUE_KEY` and `TODAY_SUMMARY_KEY`
stale separately, and each refetches its own endpoint. Pointing that refetch at
`/bootstrap` removes the drift by construction — and closes the wider version
of it too, where the strip says "12 sender decisions" above 11 rendered rows
because the two calls saw different queue copies.

Not done here: it moves the query keys, the SSR boundary, the strip's fetching
half and their tests, on a branch already at its review cap. It is the natural
first item of the next branch, ahead of the two rows below it.

**QA-triage-20260828-02** is the class behind the over-correction above. "The
last 90 days" is spelled out separately in `score.worker.ts`,
`activity.read-service.ts`, `actions.service.ts` and `triage.read-service.ts`,
with nothing holding them to one definition — which is exactly why changing one
of them in isolation looked safe and was not. A shared constant would have made
the anchoring change fail loudly instead of silently disagreeing with the
sentence beside it. Not fixed here: it spans four modules well outside this
diff, and this branch is at its review cap.

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

**Sequencing.** QA-triage-20260827-05 through QA-triage-20260827-11 are approved but deliberately not handed off
yet: they edit the same files as QA-01/02/03 (`triage.read-service.ts`,
`triage-row-expanded.tsx`, `triage-row.tsx`), and two Codex runs in those files
at once produce conflicting branches rather than parallel progress. They go out
as one sweep once the P1 branch lands. QA-04 is isolated in the entitlements
service and runs alongside the P1s.

**Not offered, and why.** Four candidates died to the refuters and are not on
this list: the undo/category-label claim (the run compared a DB row against a
Gmail read whose tool strips `CATEGORY_*`), re-score-on-expand (D25
`stale_refresh`, built to a founder decision), the reorder's _named cause_ (real
symptom, wrong mechanism — the surviving version is QA-triage-20260827-01), and
"8,036 decisions hidden" (of 8,051 scored senders only 147 are actionable, so
printing the larger number would have been the bigger falsehood — the surviving
remnant is QA-triage-20260827-15). Detail in the ledger's Refuted table.

**Blocked, not findable.** Unsubscribe execution and the `U` keystroke were not
exercised, by any route. `UnsubExecutionWorker` performs a real one-click POST
from the founder's address with no dry-run and no kill switch, so the surface is
reviewed by reading until the dev-only send refusal in `FOUNDER-FOLLOWUPS.md`
exists. Nothing below the unsubscribe preview has been QA'd.
