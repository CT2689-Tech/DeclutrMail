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

**Want the rolled-up numbers instead of the rows?** `docs/qa/at-a-glance.md`
is a hand-refreshed snapshot of this file + `FINDINGS.md` — priority ×
state counts, per-job progress, what's stuck on the founder. It goes stale
the moment a row here moves; re-derive it, don't trust an old one.

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

|     | id                    | sev                       | one line                                                                                                                                                        | status                                                                                                                                                                                                                                                                                                                                                                                       | PR   |
| --- | --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🔵  | QA-triage-20260827-01 | P1                        | The daily queue's `ORDER BY` has no tiebreak, so _which_ 12 senders appear is undefined and any write reshuffles the list under the reader                      | Static-verified 2026-09-01 (WEAK — `senderKey` tiebreak present on every ordering path, 29/29 spec green, but no live-mailbox stability demonstration recorded) — still awaiting a real confirming pass                                                                                                                                                                                      | #663 |
| 🟢  | QA-triage-20260827-02 | P1                        | "LAST SEEN today" is false for 849 of the 954 rows that assert a recency; the open back-end half of merged PR #258                                              | Fixed 2026-09-01 — inbound-only `MAX` present and live-verified against a real 45d-old sender at merge time; code unchanged since                                                                                                                                                                                                                                                            | #663 |
| 🟢  | QA-triage-20260827-03 | P1                        | "reduce future noise by ~10%" measures mail already received, while Archive and Later both declare future email unchanged                                       | Fixed 2026-09-01 — live-verified this session on isolated stack: strip now reads "12 sender decisions. These senders sent ~12% of the email you received in the last 90 days." — past-tense, no "reduce future noise" framing                                                                                                                                                                | #663 |
| 🔵  | QA-triage-20260827-04 | P2 · **Tier 1 (billing)** | The Free-tier cap is one `::int` from inverting, and its spec runs on PGlite rather than the production driver                                                  | Static-verified 2026-09-01 (WEAK — `coerceUsedCount` extracted per the round-1 finding, spec green, but no live/DB evidence) — Tier 1, held for a real confirming pass, not flipped on static evidence alone                                                                                                                                                                                 | #671 |
| 🔵  | QA-triage-20260827-05 | P2                        | D30's adaptive 5–12 queue size is dead code — no client ever calls `queue-size`, so everyone gets the hard max 12                                               | Static-verified 2026-09-01 (WEAK — `getQueueSize` now wired directly into both bootstrap/queue controller paths server-side rather than via a separate client round-trip; live-checked this session: api log shows zero `/api/triage/queue-size` hits, consistent with either "still dead" or "correctly inlined" — ambiguous from a network trace alone, needs a source diff read to close) | #671 |
| 🔵  | QA-triage-20260827-06 | P2                        | The Triage empty state says new decisions arrive after a sync; the queue refills from already-scored rows with no sync                                          | Static-verified 2026-09-01 (WEAK — copy no longer implies sync is required, dedicated test green) — this mailbox has 12 queued decisions so the empty state itself couldn't be reached live this session                                                                                                                                                                                     | #671 |
| 🟢  | QA-triage-20260827-07 | P2                        | One measurement, two names on the same card: the row says "marked read", the tile and bullet say "read rate"                                                    | Fixed 2026-09-01 — live-verified this session: every row badge reads "None marked read in 90d" / "N% marked read in 90d" consistently, "read rate" gone                                                                                                                                                                                                                                      | #671 |
| 🟢  | QA-triage-20260827-08 | P2                        | "You'll see the affected email before anything changes" names Keep first, and Keep has no preview by design (D40)                                               | Fixed 2026-09-01 — live-verified this session: intro now reads verbatim "Every action that changes your mail shows the affected email first — Keep never does."                                                                                                                                                                                                                              | #671 |
| 🔵  | QA-triage-20260827-09 | P2                        | The undo deadline renders in UTC in the toast and in the reader's zone in the preview, two clicks apart                                                         | Static-verified 2026-09-01 (WEAK — `formatExpiry` no longer overrides `timeZone`, TZ-flip test green) — confirming this live needs an actual archive+undo mutation on the real mailbox, deliberately not run this session (would collide with the live senders session's mailbox state)                                                                                                      | #671 |
| 🔵  | QA-triage-20260827-10 | P2                        | Two stat tiles are windowed and two are not, with nothing saying so; at 375px "90D" orphans onto its own line                                                   | Static-verified 2026-09-01 (WEAK — "received all time" label + `auto-fit`/`minmax` grid present, dedicated tests green) — no live 375px re-check this session                                                                                                                                                                                                                                | #671 |
| 🔵  | QA-triage-20260827-11 | P2                        | The preview's footer — reversibility line, Cancel, confirm — sits below the fold on a 375px phone                                                               | Static-verified 2026-09-01 (WEAK — footer is `position: sticky` inside the scroller, dedicated test green, sibling fix applied to `batch-action-sheet.tsx` too) — live re-check attempted this session, browser pane became unresponsive mid-interaction (known flaky-pane pattern, not a product signal); not re-attempted                                                                  | #671 |
| 🟢  | QA-triage-20260827-12 | P3                        | The `K · A · U · L · D` legend renders from first paint, but the keys do nothing until a row is expanded                                                        | Fixed 2026-09-01 — live-verified this session: collapsed legend now reads "Open a row for K · A · U · L · D", state-conditional                                                                                                                                                                                                                                                              | #663 |
| ⬜  | QA-triage-20260827-13 | P3                        | Rows 2–12 show a bare `›` while row 1 shows a rationale, reading as "row 1 loaded and the rest failed"                                                          | Open                                                                                                                                                                                                                                                                                                                                                                                         |      |
| ⬜  | QA-triage-20260827-14 | P3                        | A sender with no inbox mail occupies a decision slot with no signal until the preview opens                                                                     | Open                                                                                                                                                                                                                                                                                                                                                                                         |      |
| 🟢  | QA-triage-20260828-04 | P2                        | Protecting a queued sender updates the rows but not the Today strip, so the strip keeps naming a subset the rows no longer contain                              | Fixed 2026-09-01 — moot once -03 collapsed to one key; confirmed via the same single-`/bootstrap`-call evidence below                                                                                                                                                                                                                                                                        | #663 |
| 🟢  | QA-triage-20260828-03 | P2                        | The Today strip and the rows it summarises are separate queries pulled apart by four independent paths, so they can describe different windows and queue copies | Fixed 2026-09-01 — live-verified this session: api log shows exactly ONE `GET /api/triage/bootstrap` call for the full page load, ZERO `/today-summary` calls — rows and strip now share one query                                                                                                                                                                                           | #663 |
| 🔵  | QA-triage-20260828-02 | P3                        | "The last 90 days" is implemented independently in 4+ places with no shared definition; nothing makes them agree                                                | Static-verified 2026-09-01 (WEAK — single `ENGAGEMENT_WINDOW_DAYS`/`engagementWindowStart()` now consumed by all 3 known TS sites, blind-scan test green) — postdates the original smoke, no fresh live check this session                                                                                                                                                                   | #663 |
| 🔵  | QA-triage-20260828-01 | P2                        | "LAST SEEN today" is shown for mail that arrived yesterday — the label buckets by elapsed hours, not calendar day                                               | Static-verified 2026-09-01 (WEAK — `daysSince` now does local-midnight-to-midnight comparison, negative-control test green) — the doc's own live evidence is for the BUG (Temu, 11.1h old, read "today"), recorded before this fix landed; no confirming re-smoke against the fixed code yet                                                                                                 | #663 |
| ⬜  | QA-triage-20260827-15 | P3                        | The H1 and queue legend give an unscoped count, and no "done for today" state ever renders to correct it                                                        | Open                                                                                                                                                                                                                                                                                                                                                                                         |      |

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

|     | id                  | sev | one line                                                                                                                                                                  | status                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PR   |
| --- | ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🟢  | QA-undo-20260828-01 | P1  | Activity's own verb-count tiles include actions the user already undid while a different tile row on the same page correctly excludes them — no label says which is which | Fixed 2026-09-01 — static-verified this session: `isNull(activityLog.revertedAt)` filter present in `aggregateStats` (the function the live `/activity` page reads), landed correcting the round-1 "wrong function" trap; targeted+full spec green (59/59); Codex round 2 CLEAN with negative controls; this session also live-loaded `/activity` on the isolated stack — renders cleanly, zero console errors, tiles computed from the patched function    | #671 |
| 🟢  | QA-undo-20260828-02 | P2  | `/activity`'s stat row ships the desktop 5-column grid before hydration at 375px, so "UNSUBSCRIBES" and "KEPT" briefly overprint each other                               | Fixed 2026-09-01 — static-verified this session: JS-gated `gridTemplateColumns` ternary replaced by CSS `<style>` media-query override (900px, matches `useIsAtMost('sm')`) at `activity-screen.tsx:688-698`, exactly the fix shape `LEARNINGS.md` already prescribed; test green (60/60); not independently re-flashed at 375px this session (would need a throttled/pre-hydration capture, not a plain page load) — static+mechanism-test confidence only | #671 |
| ⬜  | QA-undo-20260828-03 | P3  | The "Recovered" outcome tile can never register a user's own Undo (a different mechanism entirely — retried-after-failure jobs) and nothing in the product defines it     | Open                                                                                                                                                                                                                                                                                                                                                                                                                                                        |      |
| 🟢  | QA-undo-20260828-04 | P2  | Delete's own verb name disappears across 6 result surfaces, and its undo deadline repeats the two-clock mechanism already filed on `triage`, now on a second surface      | Fixed 2026-09-01 — static-verified this session: all 4 known copies (incl. the round-1-caught 4th, `senders/api/adapters.ts:230`) now read `'Deleted to Gmail Trash'`; `undo-tray.tsx` no longer hardcodes `timeZone: 'UTC'`; TZ-flip test green (6/6); this session live-loaded `/activity` on the isolated stack with no rendering error                                                                                                                  | #671 |

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

|     | id                     | sev | one line                                                                                                                                                                                                                                                                                                                                   | status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | PR   |
| --- | ---------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 🔵  | QA-archive-20260828-01 | P2  | The Triage volume tile shows a 90-day-derived average unlabelled as such, while the adjacent read-rate tile on the same row does label its window                                                                                                                                                                                          | Merged #670 — Codex round 2 clean on `b369f4ab`, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #670 |
| 🟢  | QA-archive-20260828-02 | P2  | The D226 action-preview dialog — the one screen a destructive mutation cannot skip — renders frozen LLM rationale text with no staleness indicator, unlike every other place the same text renders                                                                                                                                         | Fixed 2026-09-01 — live-verified at merge (`b369f4ab`, Victoria's Secret Panty Party) and never regressed since; no re-run this session (would need to reopen a live D226 preview, deferred to avoid an action-preview call while another session shares the dev stack)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | #670 |
| 🟢  | QA-archive-20260828-03 | P2  | Sender Detail renders "today" and "yesterday" for the same last-seen fact via three independently-written day-math algorithms on one page                                                                                                                                                                                                  | Fixed 2026-09-01 — live-verified at merge (`b369f4ab`, Pepperfry `updates.pepperfry.com`); this session re-checked the same sender live — original repro window has passed (now 2d old, not 14h) so the exact frame couldn't be re-produced, but the underlying fix (shared day-math helper) is unchanged since merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #670 |
| 🔵  | QA-archive-20260828-04 | P3  | "Show this in the row next time" describes where the preview renders, not that it skips the dialog, and not that the choice is per-verb                                                                                                                                                                                                    | Merged #670 — Codex round 2 clean on `b369f4ab`, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #670 |
| 🔴  | QA-archive-20260828-05 | P3  | The toolbar's pre-selection hint (fixed by this row) vs. the deeper D226 modal-header grammar (split out as `QA-archive-20260901-01`, see below)                                                                                                                                                                                           | At review cap 2026-09-01 — 2 substantive Codex rounds, founder ship/no-ship call needed. **Round 1:** retexted toolbar hint to "Nothing changes until you preview" — found (a) false for Keep (applies immediately, no preview, D40) and (b) confirmed the real 3-way inconsistency this row was originally filed against is the PREVIEW MODAL header grammar, not the toolbar hint — split out below as its own row rather than silently closed here. Responded: retexted to "Destructive actions preview first" (true for all 5 verbs), strengthened the test. **Round 2:** found the strengthened test still used a loose `toContain` (would pass with misleading text appended after the same opening words) and Sender Detail's own toolbar had zero test coverage of this hint at all — a Sender-Detail-only reversion would've stayed green. Responded: both test files now assert the exact `>text</span>` node boundary, not a substring; Sender Detail toolbar test added from scratch. Negative control re-run on both files: reverted → RED → restored → GREEN (80/80). **Not sent for round 3 — at cap.** These are mechanical-shaped test-assertion tightenings responding to exactly what round 2 named, but per the Rules a rendered-string/test-assertion change is substantive, and round 3 would exceed the 2-round limit. Founder call: ship as-is (fixes match round 2's stated failure modes) or take one more look. |      |
| ⬜  | QA-archive-20260901-01 | P3  | The D226 preview HEADER grammar differs by surface, not just the toolbar hint: Triage's real preview modal renders `Preview · {verb}` (e.g. "Preview · Archive"), its batch modal renders `Preview · {verb} · multiple senders`, and the Senders confirm modal renders the generic `Preview · before anything changes` with no verb at all | Open — filed 2026-09-01, sourced from Codex's round-1 review of `QA-archive-20260828-05` (item 5), not independently re-verified by a `finding-refuter` — file:line evidence: `triage/action-sheet.tsx:235` (`Preview · {verb}`), `triage/batch-action-sheet.tsx:145` (`Preview · {verb} · multiple senders`), `senders/confirm-action-modal.tsx:891` (generic, no verb). This is almost certainly what the original QA-archive-20260828-05 one-liner ("worded three different ways across the Triage row, Triage modal, and Senders bulk modal") actually meant — bigger than a copy tweak, needs a design call on whether Senders' modal should also name the verb, or whether Triage's verb-naming is the outlier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |      |
| 🔵  | QA-archive-20260828-06 | P3  | Activity's per-row source label uses the internal enum voice "VIA MANUAL" instead of "by you"                                                                                                                                                                                                                                              | Merged #670 — Codex round 2 clean on `b369f4ab`, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #670 |

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

|     | id                        | sev | one line                                                                                                                                                                                                                                                                                                                       | status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | PR   |
| --- | ------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🔵  | QA-onboarding-20260828-01 | P0  | `/senders` can assert something false about the user's own inbox during an active sync — it either denies any senders exist, or shows a stale pre-disconnect snapshot labelled with a "Synced through" time it never measured — reachable on ANY ordinary returning login mid-resync, not only reconnect                       | Static-verified 2026-09-01 (STRONG — readiness guards + regression test present, 58/58 green) — this session's own live `/senders` load (isolated stack, ready mailbox) showed no false claim, but the actual syncing/failed repro needs forcing `mailbox_accounts`/`provider_sync_state` on the shared real mailbox, deliberately NOT done this session while another live session is concurrently querying senders on the same DB — held at 🔵, P0/Tier 1b, wants a dedicated live pass once the stack is free | #673 |
| 🟢  | QA-onboarding-20260828-02 | P1  | `AuthProvider`'s 401→OAuth redirect runs in the render body with no fire-once guard, duplicating an already-guarded sibling (`client.ts`'s `redirectToLogin`) — every session-expiry event fires 2 real navigations to Google's live OAuth start in production (3 in dev), burning the app's own rate-limit bucket meant for 1 | Fixed 2026-09-01 — static-verified: `auth-provider.tsx` no longer calls `window.location.assign`; `client.ts` `redirectToLogin()` now fires on both first-401 and post-refresh-replay paths (the round-1 dead-end), idempotent per tick; negative-control test forces a second settle and asserts no navigation, 15/15 green                                                                                                                                                                                     | #673 |
| 🟢  | QA-onboarding-20260828-03 | P1  | Refresh-token rotation revokes the whole session on any concurrent same-account refresh collision (two tabs racing the ~15-min access-token TTL edge) — no code path returns the same fresh tokens to the loser, and the DB schema has no column that could hold the value such a path would need                              | Fixed 2026-09-01 — Tier 1 (token handling). Static-verified: grace-window columns + `rotate()` grace-hit logic present exactly as designed (previous-hash shift on every rotation, own deadline, structured warn log); adversarial security review (1 MEDIUM mitigated) + 9/9 PGlite tests green, negative-controlled                                                                                                                                                                                            | #686 |
| 🟢  | QA-onboarding-20260828-04 | P1  | The `?mailbox=` secondary-connect gate shows a fake, never-resolving "Reading your inbox… 0%" scan instead of the reconnect gate when its target mailbox goes inactive out-of-band with no other active mailbox to escape to                                                                                                   | Fixed 2026-09-01 — static-verified: guard now exact-code-scoped to `NO_ACTIVE_MAILBOX` (not any sync error, the round-1 finding), routes to `/senders`'s own gate; base + narrowing tests present, 22/22 green                                                                                                                                                                                                                                                                                                   | #673 |
| 🟢  | QA-onboarding-20260828-05 | P2  | The no-active-mailbox gate's plain "Connect a Gmail account" button (not Reconnect) silently swallows a connect failure — same gate re-renders with no explanation and a stale `connect_error` param stuck in the URL; two dead copy keys exist for codes no path can emit, and one real code has no copy entry at all         | Fixed 2026-09-01 — static-verified: dead copy keys removed, only the 3 reachable codes remain; hook mounted above the whole branch ladder so it fires even under `NoActiveMailbox`; history-state overwrite (round-2 finding) fixed via `replaceState(window.history.state, ...)`; test 32/32 green                                                                                                                                                                                                              | #673 |

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

**Implemented 2026-08-30 (founder-approved design: server-side grace
window).** `active_sessions` gained two nullable columns —
`previous_refresh_token_hash` / `previous_hash_expires_at` (migration
`0078_session_refresh_grace_window`) — that shift forward on EVERY
rotation, winner or grace-hit alike, so the recognized window is always
exactly one generation, never a standing bypass. The loser of a genuine
race gets its OWN fresh rotation (not the winner's literal tokens — the
raw refresh token is never stored to hand back, only its hash) instead of
the reuse-defense revoke. `REFRESH_GRACE_WINDOW_MS = 30_000`.

Adversarially security-reviewed (no live Codex access this session;
substituted a dedicated review agent). One MEDIUM finding, addressed: a
collision between an ALREADY-STOLEN token and a legitimate request now
rotates instead of revoking, so the automatic kill-switch that used to
bound a compromised token's lifetime no longer fires on that one
collision. Mitigated with a distinct structured log line on the grace-hit
path (`SessionsService.rotate()`) so this is no longer invisible to an
operator — deliberately did NOT add IP/UA-binding or a per-session grace
cap, since both are real design tradeoffs (network-switch false positives;
denying a legitimate SECOND race later in a long-lived session) that
belong to the founder, not a unilateral call. Flagged as follow-up
options in the PR, not implemented.

Every new/changed assertion negative-control verified (revert → RED →
restore), including the new log line itself and the full grace-window
logic via a targeted mutation test. Own PR — Tier 1 items are never
bundled (this file's own Rules, above).

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

## delete

Rows accumulate across every `/ct-qa delete` run. Per-run counts are in the
ledger. First filed 2026-08-29 (9 survivors; 1 candidate REFUTED and 1
PARTIALLY REFUTED-then-refiled-corrected before filing — see the ledger's
Refuted table for the grounds on each). All P2/P3 — none in `FINDINGS.md`.

|     | id                    | sev | one line                                                                                                                                                                                                                                           | status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PR   |
| --- | --------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🟢  | QA-delete-20260829-01 | P2  | Delete's "safer" 180-day default window applies only to the Senders/sender-detail confirm modal, not to Screener's sibling Delete preview, so the identical fresh-mail delete is dead-on-open through one door and friction-free through the other | Fixed 2026-09-01 — row was stale: `674bdd4e` (PR #684, 2026-08-30, "Screener Delete default window") already shipped this exact fix — Screener's Delete now defaults to `DEFAULT_DELETE_WINDOW_DAYS` (180d) via `screener-screen.tsx:225-231,426,632` + `decide-preview.tsx`, narrower-only (no widen chip, unlike the Senders modal), title+notice make the narrowing visible. This session verified the code still matches on main tip and closed the row — the design question WAS answered, just never reflected here | #684 |
| 🔵  | QA-delete-20260829-02 | P2  | The Senders Delete confirm modal's title ("Delete email from 1 sender") never says Trash, unlike Triage's equivalent header                                                                                                                        | Merged #674 — round 1 clean, round 2 clean, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #674 |
| 🔵  | QA-delete-20260829-03 | P2  | Empty-window notice states an age in days ("not older than 6 days") beside a control labelled in months ("6 months+")                                                                                                                              | Merged #674 — round 1 clean, round 2 clean, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #674 |
| ⬜  | QA-delete-20260829-04 | P2  | Post-delete Undo deadline renders in UTC while every other timestamp on the same surfaces renders in the viewer's local clock                                                                                                                      | Approved, NOT fixed — see note below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |      |
| 🔵  | QA-delete-20260829-05 | P3  | Senders receipt strip doesn't observe an undo performed via the global Undo tray and keeps asserting stale "Moved to Gmail Trash" state (all verbs, not Delete-specific)                                                                           | Merged #674 — round 1 found 2 (fixed `4dab8f68`), round 2 found 1 (fixed `fb4a8e39`), awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                             | #674 |
| 🟢  | QA-delete-20260829-06 | P3  | The same 30-day undo window is named three different ways across surfaces                                                                                                                                                                          | Gone 2026-08-30 — the live hedge no longer reproduces (fixed by #646, 2 days before this job ran); see note above                                                                                                                                                                                                                                                                                                                                                                                                         |      |
| 🟢  | QA-delete-20260829-07 | P3  | Delete preview body is verbose — its last sentence restates the one before it                                                                                                                                                                      | Refuted 2026-08-30 — the two sentences are independently-sourced facts, not a duplicate to merge; see note above                                                                                                                                                                                                                                                                                                                                                                                                          |      |
| 🔵  | QA-delete-20260829-08 | P3  | A zero-match Delete preview's header still reads as an active move ("Move inbox email from X to Gmail Trash" above a "0 matching emails" body)                                                                                                     | Merged #674 — round 1 clean, round 2 clean, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #674 |
| 🔵  | QA-delete-20260829-09 | P3  | Mail-location sentence mixes a singular subject ("this email") with a four-digit population and drops the unit noun on one side of the split                                                                                                       | Merged #674 — round 1 found 1 (fixed `4dab8f68`), round 2 clean, awaiting confirming run                                                                                                                                                                                                                                                                                                                                                                                                                                  | #674 |

**Founder approved 02–09 (plus 05) as one copy/staleness PR on 2026-08-29,
declining 01 as a design question. Implementing 04, 06 and 07 surfaced that
the approved fix would have been wrong, so those three were pulled back out
before any code changed — see "Approved, held back" below. -02/-03/-05/-08/-09
shipped as scoped.**

### Approved, held back — 04, 06, 07 need a founder call, not a copy tweak

All three looked like independent wording nits at filing time. Implementing
them showed they are the SAME defect, already named and actively hunted by
D245 (`packages/shared/src/entitlements/undo-window.ts`,
`apps/web/src/app/(marketing)/undo-window-copy-guard.test.ts`): the Undo
window ladder went uniform at 30 days on 2026-08-23, and the guard test's own
header says three prior sweeps each declared every hedged site fixed and each
was wrong.

- **-06's "three different names"** aren't three arbitrary spellings of one
  idea — two are a pre-action policy statement ("Undo from Activity during
  your plan's Undo window") and a post-action deadline ("Activity Undo
  until Sep 26…"), which are legitimately different information and should
  NOT collapse to one string. The real defect is narrower and worse:
  `action-semantics.ts`'s `delete` entry hardcodes
  `"DeclutrMail Undo is available from Activity during your plan's Undo
window."` — a **static string**, never re-evaluated against
  `UNIFORM_UNDO_WINDOW_DAYS` — while `action-sheet.tsx:429-430` (same
  feature area) already does this correctly with a ternary on that exact
  constant. `action-semantics.ts` is not in the copy-guard test's scanned
  module list (its own comment enumerates what IS covered), so this is a
  live, unguarded hedge on the highest-traffic preview surfaces
  (Triage + Senders + Screener), for Archive/Later/Unarchive too, not only
  Delete.
- **-07's "sentence 5 restates sentence 4"** are `providerRecovery.summary`
  and `finality.summary` in that SAME `delete` entry — fixing verbosity
  there means rewriting text in the identical hardcoded, unguarded object
  the -06 finding lives in.
- **-04's UTC timestamp** (`packages/shared/src/components/undo-tray/undo-tray.tsx:337-345`)
  is very likely a DELIBERATE hydration-safety choice, not an oversight:
  `undo-tray.test.tsx`'s own header says rendering is SSR-only, and a
  locale-dependent `Intl.DateTimeFormat` render would put the server and the
  viewer's browser on different clocks on first paint — exactly the
  hydration-mismatch class this codebase has been bitten by before
  (QA-archive-20260828-03). Switching it to local time without a
  `useNow()`-style post-hydration gate (the pattern already used for this
  exact problem elsewhere) risks reintroducing that bug, not fixing a typo.

None of the three is a copy tweak: -06/-07 need `action-semantics.ts` to
derive its Undo-window and Trash-retention text from `UNIFORM_UNDO_WINDOW_DAYS`
the way `action-sheet.tsx` already does (a real code change to a static
`Record`, touching Archive/Later/Delete/Unarchive), and -04 needs the same
hydration-gating pattern `action-preview-presentation.tsx` already uses for
its age label, applied to a component explicitly documented as SSR-only. Each
carries real regression risk if rushed. Recommend: found a separate `D245
follow-up` job for -06/-07 (four verb entries, one file, one clear pattern to
copy) rather than an ad-hoc fix riding this PR, and a founder call on whether
-04 is worth the hydration-gating work for a P2 that only ever reads
differently by a few hours.

**-06/-07 investigated 2026-08-30 — the premise was already fixed; the real
gap was test coverage, not code.** Before implementing "derive
`action-semantics.ts` from `UNIFORM_UNDO_WINDOW_DAYS` the way `action-
sheet.tsx` already does," checked empirically whether the hedge is still
live: `buildActionPresentation({verb:'delete', liveCount:5,
planUndoDeadline:null, ...}).primary.activityUndo.summary` returns `"Undo
from Activity for 30 days."`, not the hedge. `presentAction` →
`presentationActivityUndo` already calls `activityUndoSummary(
UNIFORM_UNDO_WINDOW_DAYS, ...)` for every plan-window verb (archive, later,
unarchive, delete) — fixed by PR #646 (merged 2026-08-27, 2 days before this
job ran), which this note's own -06 finding didn't catch because it read the
registry's SOURCE (a static string sitting in `ACTION_SEMANTICS`) rather than
the RESOLVED value a live preview actually renders — the same distinction
`undo-window-copy-guard.test.ts`'s own header warns about for a different
reason. -07's "sentence 5 restates sentence 4" is real but is `providerRecovery
.summary` restating `activityUndo.summary`'s day count from a SEPARATE,
correctly-independent source (Gmail's own ~30-day Trash retention policy,
not a DeclutrMail entitlement) — currently the same number by coincidence,
not a bug to merge away.

What WAS missing, confirmed by a mutation test (reverted `presentationActivityUndo`
to read the raw hedge, watched the assertion go RED, restored, seen GREEN):
no test locked in that the INTERACTIVE live-preview path (Triage, the senders
confirm modal, the Screener decide preview, the Autopilot approve modal — all
`buildActionPresentation` callers) derives correctly; `undo-window-copy-guard
.test.ts` scans only public/marketing copy, and the existing `buildActionPresentation`
test asserted `activityUndo.kind`/`deadline` but never `.summary`'s text. Added
`packages/shared/src/actions/action-semantics.test.ts`'s "interactive
live-preview surfaces never show the raw registry hedge" describe block,
covering all 4 plan-window verbs. -04 is untouched — still a real founder
call on the hydration-gating tradeoff, unrelated to this.

**QA-delete-20260829-01, -05 — sourced from `finding-refuter`, corrected from the
driver's original candidates; -02/-03/-04/-06/-07/-08/-09 — sourced from
`usability-editor` on copy driven and captured live this run, same
scope/budget precedent as `QA-archive-20260828-01/-04/-05/-06`; none of the
seven put through a dedicated second `finding-refuter` pass.**

-01's window-inconsistency claim was verified live twice more after the
refuter's report: `members.wayfair.com` (Screener, 6 real inbox messages, 6
days old) opened its Delete preview with the full count shown and ready to
confirm immediately; the identical freshness on `noreply@thinq-email-lge.com`
and `updates@simplilearnmailer.com` (Senders confirm modal) opened disabled
with "0 emails currently match" until manually widened to "All inbox."

-05's root cause (`sender-detail-page.tsx:274`'s `receipt` `useState` never
invalidated by a tray-performed revert) has no data-safety consequence — the
DB (`action_jobs`) confirmed a second click on the stale control never fires a
second mutation — so severity is P3, not higher, despite reading first as a
functional bug.

**Regression test:** -02/-03/-05/-08/-09 each got one, every one negative-
controlled (fix reverted via `git stash`, assertion seen RED, fix restored,
seen GREEN again) — `confirm-action-modal.test.tsx` ("names its destination"),
`inbox-scope.test.ts` (window-preset labels + mail-location unit noun/opener),
`sender-detail-page.test.tsx` ("clears the receipt when a DIFFERENT
component's useRevertUndo() reverts the same token" — a second `useRevertUndo()`
instance sharing only the QueryClient, proving the fix without rendering the
tray itself), `action-preview-detail.test.tsx` (zero-match header, all three
count-based verbs). Full `apps/web` + `packages/shared` suites green
(2360 + 614 tests), typecheck and lint clean on every touched file. 01/04/06/07
have none — 01 is a design question, and 04/06/07 were pulled before any code
changed (see "Approved, held back" above).

### Review rounds — QA-02 / QA-03 / QA-05 / QA-08 / QA-09

One diff, reviewed as one unit (all five ride the same PR).

| round | ran against | verdict         | what it returned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `28a415fa`  | **substantive** | -05 was not actually fixed for the normal case — a fresh token's revert returns `reverted: false` + an `actionId` to poll, not the immediate `reverted: true` shape the first cut only handled; and the same fix was entirely missing on `senders-screen.tsx`'s own local `receipt`. -09 missed the Trash/Spam segment's unit noun (only the inbox segment got one). Both fixed in `4dab8f68`, each with its own negative-controlled test. Declined (on record): Screener's `DecidePreview` has the same zero-count title bug as -08 — a real sibling, but a new, undriven instance out of this PR's approved scope, not fixed here; disagreement that -06/-07 might be narrower than judged (live preview builders may already derive from `UNIFORM_UNDO_WINDOW_DAYS`, only the raw registry entries look hardcoded) — noted, still a founder call, not resolved inside this round.                  |
| 2     | `4dab8f68`  | **substantive** | Routing an externally-triggered revert's pending `actionId` through the page's own `revertActionId` (round 1's fix) made that page's own poll-to-terminal effect ALSO toast "Restored to your inbox" — a duplicate of the tray's own completion toast for the identical revert, on both `sender-detail-page.tsx` and `senders-screen.tsx`. Fixed in `fb4a8e39` with a separate, quiet `externalRevertActionId` handle that clears the receipt without toasting or re-invalidating. Also surfaced, NOT fixed: a real, pre-existing cross-receipt-clobbering race in both files' completion handlers (a stale poll unconditionally clears/updates whatever receipt is CURRENT on terminal, not necessarily the one it started for) — this fix's new external-revert path makes it reachable one more way but did not create it; too large a redesign for this pass, recorded below for a separate pass. |
| —     | —           | **at cap**      | Two substantive rounds reached. Per the pipeline's own rule, a third round is not run automatically — this record and the diff at `fb4a8e39` go to the founder to ship or send back for a targeted look, rather than looping again on the session's own judgment of when to stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Discovered, not filed — Codex round 2's two out-of-scope findings

Neither is a copy nit; neither was approved; neither is touched by this PR.
Recorded here (not as new `QA-delete-*` rows) because they were found
reviewing this diff, not by driving a fresh `/ct-qa` walk — the next run of
whichever job actually reaches these screens should file and drive them
properly rather than inheriting an untested Codex claim as a row.

- **Screener's `DecidePreview` has the same zero-live-count title bug as
  QA-delete-20260829-08** (`apps/web/src/features/screener/decide-preview.tsx:98-109`)
  — a zero-count Archive/Later/Delete preview still headlines an active
  move. Same fix shape as -08's `movesCurrentInbox` guard would apply here.
- **Cross-receipt clobbering in `sender-detail-page.tsx` and
  `senders-screen.tsx`'s revert-completion handlers.** Neither the
  `revertActionId` nor the new `externalRevertActionId` completion effect
  checks that the receipt it is about to clear/update is still the one it
  started for — a stale reversal completing after a newer action has
  installed a new receipt clears the newer one instead. The busy-guard
  gating new actions (`sender-detail-page.tsx` ~line 489) does not include
  `revertActionId`, so this is reachable pre-existing, not new. A correct
  fix needs the completion handlers to compare token/actionId identity
  before acting, on both files.

## sign-in

Rows accumulate across every `/ct-qa sign-in` run. Per-run counts are in the
ledger. First filed 2026-08-29 (10 survivors; 3 candidates refuted before
filing — all three original candidates turned out to be deliberate,
documented design: a narrow `returnTo` allowlist + fixed post-login home
(`parseBillingReturnTo`), a session-blind marketing shell by design (D134
public split, `hasLiveSession` short-circuit), and the pricing page's tier
CTA as an intentional universal plan-selector with the D226 preview already
satisfied).

7 of the 10 survivors were fixed via
`docs/superpowers/plans/2026-08-31-signin-cta-findings-fixes.md`, executed
subagent-driven (fresh implementer + reviewer per task, 1 final whole-branch
review round that found 4 additional Important defects the per-task reviews
could not see — see that plan's own commit history for detail).

|     | id                     | sev | one line                                                                                                                                                                                    | status                                                                                                                                                                                                                                |
| --- | ---------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔵  | QA-sign-in-20260829-01 | P1  | Homepage trust-strip copy claimed exact precision ("you see exactly which emails are affected"), contradicting the product's own `ACTION_PREVIEW_CLAIM` two lines below it in the same file | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| 🔵  | QA-sign-in-20260829-02 | P1  | Pre-consent disclosure undersold the `gmail.modify` grant as "organize your Gmail" when the scope covers send/compose too                                                                   | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| 🔵  | QA-sign-in-20260829-03 | P2  | Pricing tier CTA / `?plan=X` deep link auto-expanded the plan-change confirm panel without checking the visitor's `currentTier`                                                             | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| ⬜  | QA-sign-in-20260829-04 | P2  | "Connect your Gmail" CTA copy renders identically for an already-connected visitor across 10+ marketing surfaces                                                                            | Open — deliberately excluded (see plan header): fixing this needs marketing pages to become session-aware, conflicting with D134's deliberate session-blind design; destination already redirects correctly, so this is cosmetic-only |
| 🔵  | QA-sign-in-20260829-05 | P2  | Homepage disclaimer omitted the 50 cleanup-action/month Free-tier cap at the exact point a visitor decides if Free fits                                                                     | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| 🔵  | QA-sign-in-20260829-06 | P3  | `/sign-in`'s pre-consent explanation page was unreachable from any nav or homepage link                                                                                                     | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| 🔵  | QA-sign-in-20260829-07 | P3  | `/sign-in` step 2 promised a scan duration ("a few minutes") the sync gate deliberately never states elsewhere                                                                              | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| 🟢  | QA-sign-in-20260829-08 | P3  | Claimed `/sign-in` step 3 was a 52-word paraphrase of `ACTION_PREVIEW_CLAIM`                                                                                                                | Gone 2026-08-31 — `git log` shows step 3 has directly interpolated `{ACTION_PREVIEW_CLAIM}` since PR #637, predating this finding's filing date; nothing to fix                                                                       |
| 🔵  | QA-sign-in-20260829-09 | P3  | `/sign-in`'s `inbox_limit` alert was a 3-instruction run-on sentence leaking internal terms ("workspace", "inbox slot")                                                                     | Merged #694 — awaiting confirming run                                                                                                                                                                                                 |
| ⬜  | QA-sign-in-20260829-10 | P3  | Founding Pro promo re-lock UI is reachable but currently unhit — 0 live founding-member subscribers as of this run                                                                          | Open — no live instance to reproduce against; not worth prioritizing per the finding's own text                                                                                                                                       |

**4 additional defects found only by the plan's final whole-branch review**
(none of the 7 per-task reviews could see them, since each reviewed only its
own diff): the `inbox_limit` alert's fix initially hardcoded "one Gmail
account", false for Pro/team/enterprise (`inboxLimit=5`); the OAuth
disclosure's fix said "one permission" when 3 scopes (`gmail.modify`,
`openid`, `userinfo.email`) are actually requested; the QA-03 guard also
blocked a legitimate same-tier cycle switch (monthly→annual); and `/sign-in`
step 1 still carried the pre-fix undersell text because it never rendered
the shared `OAUTH_SCOPE_DISCLOSURE` constant Task 2 fixed. All 4 fixed in
one additional round, independently re-verified with negative controls.

**Parked, not fixed this round** (logged for a founder call or a future
sweep, none load-bearing): the cycle-aware guard re-opens for a Pro-monthly
subscriber visiting `/pricing` with no toggle interaction, since the pricing
page's cycle default is `'annual'` — not a regression against the pre-branch
baseline, but a founder call on whether auto-open should also require an
explicit cycle choice; the same "exact"/"exactly" precision-overclaim defect
class QA-01 fixed still lives in `site-json-ld-description.ts:20-21`,
`pricing.md/route.ts:142`, and `comparison-data.ts:730`; and no test ties
`OAUTH_SCOPE_DISCLOSURE`'s scope count to `google-oauth.service.ts`'s
`SCOPES` array, so the exact drift that caused the finding could recur
silently.

## mailbox-switch

Rows accumulate across every `/ct-qa mailbox-switch` run. Per-run counts are
in the ledger. First filed 2026-08-31 (1 survivor put through
`finding-refuter`, corrected and widened rather than killed; 4 more filed
directly from `usability-editor` per the same scope/budget precedent
`QA-archive-20260828-01/-04/-05/-06` set — copy driven and captured live
this run, not independently re-attacked by a refuter; 1 structural gap from
`flow-completeness-auditor`, unmeasured).

|     | id                            | sev | one line                                                                                                                                                                                                       | status                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟢  | QA-mailbox-switch-20260831-01 | P1  | `/senders` throws `useLongPress is not a function` inside `SenderListRow`, catastrophic at mobile                                                                                                              | Fixed 2026-09-01 — re-driven this session on isolated api:4006/web:3006 (main tip `c804c898`): `/senders` loads 526 real rows at desktop AND 375px, zero crash, zero `useLongPress` console error — also in `FINDINGS.md` Inbox                                                                                                |
| 🟢  | QA-mailbox-switch-20260831-02 | P2  | Autopilot, Screener, and Brief's React Query keys carry no mailbox-id segment at all — correctness rests entirely on one global `invalidateQueries()` + same-window event firing on every switch               | Refuted 2026-08-31 — see note below                                                                                                                                                                                                                                                                                            |
| 🟢  | QA-mailbox-switch-20260831-03 | P2  | One state ("this is the mailbox you're viewing") gets three different names in the account menu — `Selected` (checkmark aria), `Active` (badge text), `"Selected mailbox"` (row aria-label)                    | Fixed 2026-09-01 — re-driven this session: account-menu dropdown DOM shows a single consistent name, `aria-label="Active mailbox …"` + visible "Active" badge, no "Selected" anywhere                                                                                                                                          |
| 🟢  | QA-mailbox-switch-20260831-04 | P2  | The account menu never says what switching actually does — every screen's scope changes, not a display preference — anywhere in the component                                                                  | Fixed 2026-09-01 — re-driven this session: dropdown now renders "Everything you see is scoped to the active account." under the ACCOUNTS header                                                                                                                                                                                |
| 🟢  | QA-mailbox-switch-20260831-05 | P3  | The two connected addresses (`chintan.a.thakkar@gmail.com` / `chintan.a.thakkar.crypt@gmail.com`) truncate identically in the dropdown rows with no `title` tooltip — the trigger pill has one, the rows don't | Fixed 2026-09-01 — re-driven this session: `document.querySelectorAll` confirms both dropdown rows now carry a `title` attribute with the full address                                                                                                                                                                         |
| 🟢  | QA-mailbox-switch-20260831-06 | P3  | "Disconnected · data kept" doesn't say WHOSE data — reads as "your Gmail is untouched" when it means DeclutrMail's own retained history                                                                        | Fixed 2026-09-01 — source-verified this session: both call sites (`mailboxes-card.tsx:281`, `account-menu.tsx:548`) now read "Disconnected · history kept" verbatim; not DB-forced to a disconnected state live to avoid touching the shared mailbox row while another session is active — copy-only P3, source match is exact |

### QA-mailbox-switch-20260831-01 — `useLongPress` throws in the browser bundle

**Filed from live reproduction, sent to `finding-refuter`. Verdict: SURVIVES,
corrected and widened, not killed.**

Live-verified this run (real dev-linked mailbox, api :4001 / web :3003, both
cwd-confirmed as this worktree): navigating to `/senders` and reaching a
`SenderListRow` throws `TypeError: (0 ,
_barrel_optimize_names_Avatar_tokens_useIsAtMost_useLongPress...) is not a
function`, caught by `<ErrorBoundaryHandler>`. At a 375×812 mobile-emulated
viewport this degrades the ENTIRE list to "THE LIST HIT A SNAG — We couldn't
load your senders" — reproduced 3× across 2 page loads, including against a
**freshly killed-and-restarted** `next dev` process (cold start, "Ready in
2.1s", confirmed 200 OK before retest) — ruling out stale dev-server HMR
state as the cause, a known false-positive class in this codebase.

**The refuter's correction: this is not mobile-only.** `useLongPress` is
called unconditionally at `sender-list-row.tsx:252` — `enabled:
gesturesEnabled` gates _behaviour_, not the call itself — so viewport does
not gate the throw. Confirmed independently this run, after the refuter's
report: a plain, unfiltered, fresh reload of `/senders` at DESKTOP width
(1280×720, the default Grid view, no interaction) logged the identical
error TWICE with no visible page-level crash — the list rendered normally
end to end (Bank of America, Robinhood, 12+ other cards all correct), which
means at least 2 rows failed SILENTLY, with no fallback UI a user would
ever notice. The exact rows and exact trigger condition were not pinned
down this run (the refuter's hypothesis — an expanded brand/domain group —
was tested live via the `amazon.com` group and did NOT reproduce the
crash on that specific attempt, so the true trigger remains open). **This
makes the desktop case arguably worse than the mobile one**: mobile fails
loud (an honest "hit a snag" state, Try again works), desktop fails mute
(the user never learns 1-2 senders silently didn't render).

**Root cause.** `useLongPress` (`packages/shared/src/hooks/use-long-press.ts:19`,
a `'use client'` file, exported at `packages/shared/src/index.ts:39`) is new
this branch — added by `cde42bbb`, "feat(senders): add mobile row dialect
with swipe/long-press gestures (D54) (#687)", 11 commits behind HEAD.
`apps/web/next.config.ts` deliberately lists `@declutrmail/shared` under
`experimental.optimizePackageImports` (own comment explains why — a real,
documented bundle-size fix). The barrel-optimize name in the thrown error
matches this mechanism exactly.

**Not novel — the second live occurrence of this exact class.**
`MISTAKES.md:4129` (PR #651, fix for #646) already documents `UNIFORM_UNDO_
WINDOW_DAYS` shipping `undefined` into real users' D226 preview copy via
the identical `optimizePackageImports` rewrite. That entry's own stated
"safe" workaround — import a sibling binding alongside the broken one in
the same statement — is DISPROVEN by this incident: `useLongPress` is
imported alongside three siblings (`Avatar, tokens, useIsAtMost`), all in
one statement, and still resolved to `undefined`. `useIsAtMost`, in that
exact same statement, resolved fine. The prior entry's own rule warned
this: _"a rule of the form 'safe unless it is the only named import from
that barrel' is one nobody will remember, and the failure is silent."_
The proposed remedy from that entry — extend
`scripts/check-web-bundle-budget.mjs` with a build-output pass that greps
`.next` route chunks for `undefined` inside rendered copy — is still
**Open** in `FOUNDER-FOLLOWUPS.md` (~line 112-124), confirmed via this
run's own sweep: `check-web-bundle-budget.mjs` has no such check yet
(`undefined` appears only in an unrelated comment and cache-check line).
This incident is live evidence the guard is needed, not a hypothetical.

**Siblings, same mechanism, found by `defect-class-sweeper` — initially
UNMEASURED, since fixed (see below):**

- **`useFocusTrap`** (`packages/shared/src/hooks/use-focus-trap.ts:13`,
  `'use client'`) — **16** consumer sites (corrected from an initial count
  of 15), including `apps/web/src/features/billing/cancel-modal.tsx:90`,
  `apps/web/src/features/billing/upgrade-modal.tsx`,
  `apps/web/src/features/account-deletion/delete-account-modal.tsx:81`,
  `apps/web/src/features/triage/action-sheet.tsx:189`, and three sites in
  `activity-screen.tsx`. Highest-confidence sibling: same file shape, same
  barrel, a hook (calls loudly if undefined) rather than a component or
  const (could fail silently without ever throwing).
- **`useLocalState`** (`packages/shared/src/hooks/use-local-state.ts:11`,
  `'use client'`) — one consumer,
  `apps/web/src/features/senders/table/sender-group.tsx:28` — confirmed via
  repo-wide grep to be genuinely orphaned (no live import of `SenderGroup`
  anywhere outside its own definition/test/story; matches
  `LEARNINGS.md`'s prior note on this exact component).
- The sweeper checked all 7 `optimizePackageImports`-listed subpath
  barrels (`/actions`, `/contracts`, `/copy`, `/entitlements`, `/flags`,
  `/observability`, `/senders`) and found none export hooks — the risk
  surface is exactly the 7 hooks in the root `@declutrmail/shared` barrel.
  `useLabels` and `useExpandableRow` have no current web consumers (low
  risk by absence, not by safety); `useUiStore` likewise.

**Regression test:** per the prior incident's own logged rule, a Node/Vitest
assertion CANNOT catch this — it resolves correctly in Node and only breaks
in the bundled client graph. The correct guard is the build-output check
named above, not a unit test. A live re-drive (load the route, read the
console) is the only thing that currently sees this class.

**Fixed.** `useLongPress` now imports from a real module path
(`@declutrmail/shared/hooks/use-long-press`, added to `packages/shared/
package.json`'s `exports` map) instead of the barrel, mirroring the exact
remedy MISTAKES.md's prior entry names. `useIsAtMost` (the sibling that
resolved fine) was left importing from the barrel — minimum surgical diff,
only the confirmed-broken symbol moved. `pnpm typecheck` clean on both
`packages/shared` and `apps/web`.

**Live-verified, with a methodology correction.** The web dev server
needed a full kill-and-restart AND its `.next` directory moved aside
(`mv .next .next-stale-precache`) before the fix took effect — a
`package.json` exports-map edit is not picked up by Next's dev-mode
webpack persistent disk cache the way a source-file edit is; a plain
process restart alone (no cache clear) still served the old, broken
module graph. Once truly cold-started, re-testing on the SAME long-lived
browser tab still showed the identical 3 errors — which turned out to be
a second, unrelated artifact: this session's browser-automation tool does
not clear its console-message buffer on same-tab navigation, so
`read_console_messages` was returning stale entries from earlier in the
tab's life, not fresh ones. Opening a genuinely new tab and reloading
`/senders` showed **zero console errors**, mobile (375px, scrolled through
all 50 loaded rows via `get_page_text` — every row rendered, no crash UI,
no "We couldn't load your senders") and desktop (general browsing plus
the `amazon.com` brand-group expand the refuter's report flagged as a
candidate desktop trigger). This is now logged as its own trap in
`LEARNINGS.md` — always open a fresh tab (or otherwise confirm buffer
freshness) before trusting a console read as evidence of a CURRENT-state
error when re-testing a fix.

**What this revises, honestly.** The "silent-partial at desktop" framing
in this row's own one-line summary — 2 rows failing quietly on a plain
fresh desktop load, no visible crash — was built on a console read that,
in light of the artifact above, cannot be trusted as independent evidence;
it may have been the same stale-buffer effect, not a second, distinct
desktop-only failure mode. What remains solidly confirmed, unaffected by
this correction: the MOBILE crash was real and screenshot-proven (the
rendered "THE LIST HIT A SNAG" UI is not a console artifact), reproduced
identically across a process restart, and the refuter's source-level
finding that the call is unconditional (not viewport-gated) stands on its
own regardless of which browser evidence is trusted. Summary line
corrected above to drop the unverifiable desktop-silent-failure claim
rather than carry it forward as fixed.

**Siblings (`useFocusTrap`, `useLocalState`) — fixed too, after Codex's
round-1 review flagged them.** Not part of the originally-approved scope,
but the same demonstrated defect class, so extended per the standing
"fix the class, not the instance" rule rather than left open one call
away from the same crash. `00e355fd`: exports-map entries added for both,
all 17 real consumers (16 `useFocusTrap` + 1 `useLocalState`) migrated to
their direct module paths, plus an `eslint` `no-restricted-imports` rule
(`eslint.config.mjs`) that now refuses a barrel import of any of the
three hooks — proven to actually catch a regression, since a full-repo
lint pass caught one migration this same pass had missed
(`apps/web/src/lib/focus-trap-contract.test.tsx`). Live-verified the two
highest-stakes consumers (billing cancel modal, account deletion modal):
both render and focus-trap correctly, zero console errors, on a
cold-started `next dev`. `useLocalState`'s sole consumer
(`SenderGroup`) could not be live-driven — confirmed via repo-wide grep
to be genuinely orphaned, matching `LEARNINGS.md`'s prior note; the fix
there is correct but currently unreachable.

### QA-mailbox-switch-20260831-02 — Refuted after implementation was attempted

**Approved this session as a P2 fix, then REFUTED before any code shipped —
the investigation done to implement it killed its own premise.** Recorded
in full because the reasoning is the reusable part, not just the verdict.

**Originally filed from `flow-completeness-auditor`, source-only (no
shell/DB/browser access) — grep-confirmed structure, live behaviour
UNMEASURED.**

`useSetActiveMailbox.onSuccess` (`apps/web/src/features/mailboxes/api/
use-set-active-mailbox.ts:22`) routes through a shared reset
(`reset-mailbox-cache.ts:31`) that fires a bare, filterless
`queryClient.invalidateQueries()` plus a `declutrmail:mailbox-scope-reset`
window event on every switch — this IS the mechanism this run's own live
switches rode, and it held up under every attack actually driven (see
"Held up under attack" below). But three feature areas were never visited
this run and carry no mailbox-id in their query keys at all, meaning
correctness for them rests ENTIRELY on that one global invalidate firing
correctly, with nothing partitioning the cache as a second line of
defence — exactly the shape CLAUDE.md §8 already names as this codebase's
own recurring trap ("feature query keys aren't partitioned by mailbox, so
stale data survives a switch"):

- **Autopilot** — `['autopilot','rules'|'pending-suggestions'|'pattern-suggestion']`
  (`apps/web/src/features/autopilot/api/query-keys.ts:9-16`), no mailbox
  segment.
- **Screener** — `['screener','queue']` / `['screener','count']`
  (`apps/web/src/features/screener/api/query-keys.ts:12`,
  `.../query-options.ts:15`), no mailbox segment.
- **Brief** — `['brief','today']`
  (`apps/web/src/features/brief/api/query-keys.ts:10-20`), documented in
  its own source as relying on the global reset.

**Quiet is the control case and is fine**: `['quiet','hours',mailboxId]`
IS partitioned (`apps/web/src/features/quiet/api/query-keys.ts:12`), and
the screen renders one card per mailbox rather than scoping to "active" at
all (`quiet-screen.tsx:69`), so a switch is a structural non-event there —
this is the shape the other three would need if partitioning were the
fix, though the global-reset approach is a legitimate alternative IF it
can be shown to always fire before a stale read is possible.

**What killed it.** Before writing a partitioning patch, read
`apps/web/src/features/senders/api/query-keys.ts`'s own doc comment —
Senders itself, the screen this run spent the most time driving and
never caught leaking, states outright: _"Mailbox scope is still handled
by `resetMailboxScopedCache` on mailbox switch (§8 invariant) — promoting
mailbox into the key itself is a later cleanup."_ Senders is NOT
partitioned either. Neither is Triage. Reading
`apps/web/src/features/mailboxes/api/reset-mailbox-cache.ts` (the actual
reset function) confirms why that's fine: `resetMailboxScopedCache` calls
`qc.invalidateQueries()` with **no filter at all**, on every successful
switch, unconditionally — its own doc comment names the exact 2026-05-28
stale-screen incident this shape was built to fix, and explicitly chose
`invalidateQueries()` over `clear()` because `clear()` doesn't force
already-mounted observers to refetch. A filterless invalidate cannot
selectively miss three specific features — it is structurally impossible
for Autopilot/Screener/Brief to be exempt from a call that takes no
argument.

**Live-verified anyway**, since the doc comments alone shouldn't be trusted
without a check: opened `/autopilot` on primary (rule "Later for new
senders," real matched data), switched to `chintan.a.thakkar.crypt@gmail.com`
via the account menu, and captured the network trace. Immediately after
`PATCH /api/mailboxes/.../active → 200`: `GET /api/autopilot/rules`,
`GET /api/autopilot/pending-suggestions`, and
`GET /api/autopilot/pattern-suggestion` all fired and returned 200. The
screen re-rendered with crypt's own rule set ("Long-dormant unsubscribe,"
never seen on primary) — no leaked primary-mailbox data.

**Verdict: REFUTED, not fixed.** Adding per-key mailbox partitioning to
only these three features, on top of a mechanism that already covers them
by construction, would have made the codebase LESS consistent (three
screens on a different, redundant pattern from Senders/Triage/everything
else) while fixing nothing — the premise ("correctness rests entirely on
one global reset with nothing backing it up") was true but not a defect:
that IS the deliberate, working, single mechanism this whole app uses,
proven live. No code changed for this row.

### QA-mailbox-switch-20260831-03 through -06 — filed from `usability-editor`, not put through a dedicated `finding-refuter`

**Scope/budget call, same precedent as `QA-archive-20260828-01/-04/-05/-06`
and `QA-undo-20260828-04`** — each item below is sourced from the actual
rendered component this run identified live
(`apps/web/src/features/mailboxes/account-menu.tsx`), not a raw screen
impression; none independently re-attacked by a refuter. All P2/P3:
comprehension friction, nothing unreachable, nothing false enough to block
the job.

- **-03, P2 — one state, three names.** The checkmark's aria-label says
  `"Selected mailbox ${email}"` (`:226`), the row's own aria-label says
  `Selected` (`:288`), and the visible badge text says `Active` (`:294`,
  uppercased by CSS at `:551`). Propose: `Active` everywhere, aria-label
  `"Active mailbox ${m.email}"`.
- **-04, P2 — switching's actual effect is never stated.** Nothing in the
  component — not the panel (`aria-label="Gmail accounts"`, `:159`), not
  the header (`Accounts`, `:191`) — says that switching rescopes every
  screen in the app, not just this menu. Propose a one-line subline under
  the header: `Everything you see is scoped to the active account.`
- **-05, P3 — lookalike addresses, truncated-only.** The trigger pill has
  `title={activeLabel}` (`:113`, full email on hover); the dropdown rows
  (`:272`, `textOverflow: 'ellipsis'`) do not. This account's own two
  mailboxes — `chintan.a.thakkar@gmail.com` /
  `chintan.a.thakkar.crypt@gmail.com` — are exactly the case where this
  matters: the `.crypt` is the whole difference and it's what truncates
  first. Propose: add `title={m.email}` at `:268`.
- **-06, P3 — "data kept" doesn't say whose.** `'Disconnected · data
kept'` (`:529`) reads as "your Gmail is untouched," when it means
  DeclutrMail's own retained sender/decision history — the honest version
  of this sentence already exists, just not here (the post-action toast,
  `:467`). Propose: `Disconnected · history kept`.

**Regression test:** none of the four — copy/labelling consistency, not
logic defects with a clean red/green boundary.

### Review rounds — QA-01 / QA-03 / QA-04 / QA-05 / QA-06

Two diffs (`67d1ffa1`/`00e355fd` for QA-01, `22bd7866` for QA-03–06),
reviewed together since both were in flight the same session.

| round | ran against           | verdict                    | what it returned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `67d1ffa1`/`22bd7866` | **substantive**            | QA-01's fix left `useFocusTrap`/`useLocalState` on the same broken barrel path — same mechanism, unfixed. QA-06's negative control was unsound: the only test asserting the new wording covered the Settings-page duplicate, not `account-menu.tsx`'s own copy — reverting the approved file alone would have stayed green. Both fixed in `00e355fd` and `4359a8b8`.                                                                                                                                         |
| 2     | `00e355fd`/`4359a8b8` | **substantive, docs only** | Code and tests confirmed clean on every point checked (migration completeness, eslint-rule scope and correctness, import placement, orphan-consumer claim independently re-verified, MAILBOX_C fixture trace confirmed). One real finding: `FINDINGS.md`'s Inbox entry still carried the retracted "silent desktop failure" claim and miscounted `useFocusTrap` consumers as 15 instead of 16 — both fixed directly in docs. Mechanical (no product code/behavior changed) — no round 3 per the Rules above. |

Cap reached at two substantive rounds; round 2's only finding was
documentation, not code, so it did not need a third pass.

### Smoke before merge — 2026-09-01, PR #699, `98ed13a5`

CI green on every check, including CI's own "Authenticated accessibility
smoke" — plus a separate live browser pass on this worktree's own stack
(api :4001, web :3003, both cwd-confirmed this checkout, on the exact
commit CI ran against), fresh tab throughout:

- `/senders` desktop: loads, 511 senders, zero console errors. Switched
  primary → `chintan.a.thakkar.crypt@gmail.com` and back via the account
  menu — re-scoped correctly both directions (511 ↔ 11 senders), zero
  console errors on either side. Opened the `amazon.com` brand-group card
  on the crypt mailbox — zero console errors.
- `/senders` mobile (375px): all 50 loaded rows rendered via `get_page_text`
  (the DOM check, not viewport-dependent) — zero console errors. This is
  the exact crash's original reproduction path.
- Account menu, live: "ACCOUNTS" header + "Everything you see is scoped to
  the active account." subline (QA-04) present; `✓ …@gmail.com ACTIVE`
  (QA-03, not "Selected"); both dropdown rows carry a `title` attribute
  with the full email (QA-05, confirmed via `[title]` DOM query, not just
  visual truncation).
- `/settings` mobile (375px): `Gmail accounts` card renders `ACTIVE` badge
  correctly at this width too; zero console errors.
- Triage D226 preview modal (`confirm-action-modal.tsx`, a migrated
  `useFocusTrap` consumer): opened, rendered, focus-trapped, zero console
  errors. Combined with the billing cancel modal and account-deletion
  modal already live-verified during the fix itself (see above), 3 of the
  16 migrated `useFocusTrap` consumers are now live-confirmed across
  three structurally different modal shapes (D226 preview, billing
  confirm, multi-step account deletion).

Not smoked this pass: the mobile account-switcher tap sequence itself
(same browser-pane mobile-viewport click-timeout artifact logged on the
`archive` and `delete` job runs — confirmed again this pass, unrelated to
product state) and the remaining 13 `useFocusTrap` consumers (typecheck +
lint + the new `no-restricted-imports` guard + 1248 passing unit tests
cover them structurally; no further live drive attempted).

**Held up under attack (what the probes would have caught):**

- Switching mailboxes (primary ↔ `chintan.a.thakkar.crypt@gmail.com`) via
  the real UI correctly re-scoped Senders (510 → 11 senders), Triage (12
  decisions, correct sender names), and every app-shell query
  (`auth/me`, `senders/summary`, `screener/count`, `sync/status`, `undo`,
  `snoozed/recovery`) — no stale-count leak observed on either screen in
  either direction.
- A `Sender Detail` page left mounted for a sender from the mailbox just
  switched AWAY from re-fetched on its own (network-captured: the
  mounted page's own query refired for the stale id) and got a clean 404
  — rendered "Sender not found," not a crash, not stale data.
- **Two-tab race, proven at the API layer, not just observed in the UI**:
  `GET /api/actions/preview?senderId=X` (the D226-mandatory composite
  preview every action sheet depends on) is scoped by the request's
  `CurrentMailbox` context, not the sender row's own permanent
  `mailbox_account_id`. Direct test: previewed a sender that belongs to
  mailbox A while active was flipped to mailbox B via the SAME session →
  clean 404 `SENDER_NOT_FOUND`; flipped back to A → succeeded normally.
  A stale tab cannot execute a mutation against the wrong mailbox's data —
  it fails closed at the preview step, before D226's mutation gate is
  even reached.
- Switching to a `disconnected` target mailbox (forced via
  `mailbox_accounts.status='disconnected'`, restored and re-verified
  after) is blocked by a genuinely `disabled` native `<button>`
  (`disabled=""` confirmed via DOM inspection) — not merely visually
  hidden; native click/keyboard activation is inert.
- `PATCH /api/mailboxes/:id/active` with a random non-owned UUID → clean
  404 `NOT_FOUND`; with a malformed non-UUID → clean 400 `BAD_REQUEST`;
  neither corrupts the account's actual active-mailbox state (`auth/me`
  re-checked clean after both).

**Not run, with reasons** (named by `flow-completeness-auditor`, not
driven this run — time, not access):

- The CURRENTLY active mailbox going `disconnected` out-of-band mid-session
  (as opposed to a switch TARGET, which was tested) — no reset trigger
  exists for this case by construction; unclear whether any screen
  self-heals or traps.
- Two literal concurrent browser tabs (this run's two-tab race was proven
  via one session/two logical actors, not two real tabs) — the reset event
  is same-window only; unknown whether a second real tab self-heals on
  refocus or needs a manual reload.
- Switching mailboxes while an action-sheet/preview MODAL is actually open
  and rendered (as opposed to a mounted detail page, which was tested).
- Switching mid-in-flight mutation (POST already sent, switch happens
  before the response lands).
- The mobile (375px) account-switcher control itself — the underlying
  crash (QA-mailbox-switch-20260831-01) was found while attempting this,
  but the switcher's OWN mobile behaviour was never reached; the
  browser-pane's mobile-viewport tooling began hanging on further
  interaction (the same class of harness artifact already logged on the
  `archive` and `delete` job runs — not a product finding).
- Autopilot/Screener/Brief screens with a mailbox switch actually visible
  and driven (see QA-02 above — structural risk assessed, not reproduced).

## sync

Rows accumulate across every `/ct-qa sync` run. Per-run counts are in the
ledger. First filed 2026-08-31 (10 survivors; 2 candidates refuted before
filing — both because the DB state this run forced by hand
(`readiness_status='failed'` on an already-`ready`, 7,967-sender mailbox
after months of successful syncs) turned out to be **unreachable by any real
code path**: `readiness_status='failed'` has exactly one writer in the whole
repo, `initial-sync.worker.ts`'s `recordTerminalFailure`, and
`incremental-sync.worker.ts` explicitly refuses to ever write it — its own
comment says flipping an onboarded mailbox to `failed` would wrongly route
the user back to `/onboarding`. See the ledger's Refuted table for both
grounds).

**What survived is sharper than what was filed.** The seed candidate
("the header sync indicator vanishes when a mailbox fails") was built on an
unreachable synthetic state, but three independent read-only agents —
`finding-refuter`, a `defect-class-sweeper`, and `flow-completeness-auditor`
— each re-derived, from source alone, that the SAME symptom is real for the
one state the product genuinely reaches this way: a fresh mailbox (or a
reconnect/reactivation) whose **initial** sync terminally fails. That is not
a corner case — `auth-signup.orchestrator.ts`'s `markQueued` re-queues on
every login, and the onboarding gate that would normally catch this is
`onboarded_at`-gated, so it cannot rescue an already-onboarded user whose
mailbox re-enters this state.

|     | id                  | sev | one line                                                                                                                                                                                                                                                                                                                            | status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PR  |
| --- | ------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 🟡  | QA-sync-20260831-01 | P0  | Triage's empty state renders "Nothing needs a decision right now" — a confident positive claim — while the active mailbox's sync is `failed`, and Triage has zero sync awareness of any kind                                                                                                                                        | **Review complete, 2 rounds.** Round 1 fixed the parent header still saying "Nothing waiting." over the fixed child body (`0b675112`). Round 2 confirmed this finding's acceptance criterion holds and found no further defect in it; new, non-blocking, out-of-scope observations recorded but not fixed: a failed scan with `decidedToday>0` still shows the D33 "You're done for now" completion state, and Triage has no `queued`/`syncing` awareness either (only `failed`). Cite `2925b5e5`, `0b675112`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |     |
| 🟡  | QA-sync-20260831-02 | P0  | Senders' `mailboxStillSyncing` readiness guard covers `queued`/`syncing` only; `failed` falls through to the exact "Synced through &lt;now&gt;" false-currency bug F032 was filed and fixed to kill — for the one state that fix didn't enumerate                                                                                   | **Review complete, 2 rounds.** Round 1 fixed the search/filter blind spot and the failed-state provenance overclaim (`0b675112`). Round 2 found the identical "from before this scan started" overclaim still live on the `stillSyncing` sibling — fixed in `7da14596`, negative-control verified. Non-blocking residuals recorded, not fixed: a filter-only (no search text) compose reads "this search can't be answered" though no search ran, and the widened guards hide the only "Clear search & filters" escape hatch while syncing/failed. Cite `2925b5e5`, `0b675112`, `7da14596`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |     |
| 🟡  | QA-sync-20260831-03 | P1  | The app-shell header (`SyncNowButton`) and the banner whose job is "your sync is broken" (`SyncErrorBanner`) both render nothing for `readiness='failed'` — the banner keys on a different signal (`last_sync_error_at`) that an initial-sync failure never stamps                                                                  | **Review complete, 2 Codex rounds + design-system-agent gate.** Round 1 fixed `AuthExpiredError` reconnect recognition, the `SyncErrorBanner` co-render conflict, and the silent-vanish-after-retry gap (`0b675112`). Round 2 reworded the retry-success toast "Scan started" → "Scan queued" (`7da14596`). Pre-merge, `design-system-agent` blocked on `FailedSyncIndicator` shipping with no Storybook coverage (D210/D211) and found 3 more real defects: the banner and `hasSyncError` disagreed at an exact timestamp tie, the failed label was mobile-hidden by a class meant for redundant text, and `useRetryInitialSync` didn't invalidate `me` (every new surface reads readiness from it, not `SYNC_STATUS_KEY`) — all fixed in `08ecc7b6` with `sync-now-button.stories.tsx` added. Non-blocking gate findings recorded, not fixed: Triage/app-shell have no `queued`/`syncing` awareness (Senders does — same class, unswept sibling), a non-active mailbox's "Not syncing" tag has no recovery control anywhere in the app, and whether a _terminal_ `AuthExpiredError` should route to reconnect (worker docs call it "retryable after a token refresh") is an open product question, not resolved here. Cite `2925b5e5`, `0b675112`, `7da14596`, `08ecc7b6`. |     |
| 🟡  | QA-sync-20260831-04 | P0  | A non-active connected mailbox's persistent incremental-sync failure renders an affirmative **"Ready"** in Settings and no tag at all in the account menu — worse than silence                                                                                                                                                      | **Review complete, 2 rounds.** Round 1 tightened the error/success-tie edge case (`>` → `>=`) with a negative-control test (`0b675112`). Round 2 confirmed the derivation and its ID-partitioning are sound. Non-blocking, left open: the health query's loading/error state still falls through to a plain "Ready" (both surfaces), and the Settings status dot ignores `hasSyncError`. Cite `2925b5e5`, `0b675112`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |     |
| 🟡  | QA-sync-20260831-05 | P1  | No in-app signal ever fires for a background sync that fails (`useMailboxSyncToasts` only announces `→ready`), and `useMe`'s own poll is self-starving — it only refetches while a mailbox is already known to be syncing, so a `ready→failed` flip is never even fetched without a manual reload                                   | **Review complete, 2 rounds.** Both rounds confirmed the `useMe` starvation gap is real but pre-existing/explicitly declined per this diff's own comment (`SyncNowButton`'s own `useSyncStatus` poll is unaffected — different, mailbox-keyed query). No code change; cite `2925b5e5`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |     |
| ⬜  | QA-sync-20260831-06 | P1  | Reconnecting ANY previously-synced mailbox unconditionally nulls its history cursor and forces a full resync — bypassing both the cheap incremental-resume path and the codebase's own existing `cursorTooOld` escalation ladder, which already handles the genuinely-stale-cursor case                                             | Open — not offered this session (OAuth reconnect flow; excluded from the founder's approval, flagged for sizing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |     |
| 🟡  | QA-sync-20260831-07 | P1  | The onboarding `SyncFailed` screen's copy names the real cause for an auth failure ("Google revoked our access... Reconnect the account") but its only button re-queues a full scan with the SAME dead token — no reconnect action exists in that file at all                                                                       | **Review complete, 2 rounds.** Round 1 found no code defect (verdict: "not a same-file gap") — closed the test-coverage gaps instead (AuthExpiredError click-wiring, failed+escape with an auth fixture), in `0b675112`. Round 2 found the new click-wiring test shared one mock across both parameterized cases with no clear between them, so a broken second case could still pass on the first's residual call — fixed (`mockClear()` + call-count assertion) in `7da14596`. Cite `2925b5e5`, `0b675112`, `7da14596`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |     |
| ⬜  | QA-sync-20260831-08 | P2  | A single mid-pagination Gmail 404 (not necessarily a truly-expired cursor) is indistinguishable from `cursorTooOld` and silently triggers the same full-mailbox rescan, discarding pages already fetched — a BullMQ completion hook with no principal and no rate ceiling                                                           | Approved, not yet built — deliberately deferred to its own reviewed change (touches Gmail history-cursor handling in `packages/workers/src/incremental-sync.worker.ts`, no cheap complete remedy per the sweeper's own note)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |     |
| 🟡  | QA-sync-20260831-09 | P2  | The product calls this event "scan" in onboarding and in the retry endpoint's own semantics, "SYNC FAILED"/"Sync failed" in Settings and the account menu — and one Senders string literally matches `check-microcopy.sh`'s own banned "senders indexed" pattern, shipped anyway because the hook never sweeps existing files       | **Review complete, 2 rounds.** Round 1 found `SYNC_NOT_READY.retryable` still `true` despite the endpoint 409ing on an identical retry — fixed in `0b675112`. Round 2 confirmed `false` is correct for the terminal `failed` case but noted the SAME code also covers `queued`/`syncing`, which self-recover — one boolean can't be fully accurate for every state this guard fires on. Currently non-blocking: `use-sync-now.ts` branches on `err.code`, never `err.retryable`. Recorded for founder awareness, not fixed further (would mean splitting the error code). Cite `2925b5e5`, `0b675112`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |     |
| 🟡  | QA-sync-20260831-10 | P2  | Five smaller copy/robustness defects on the same surface: a 409 message reused for 4 different states, a toast promising self-recovery that never happens, "Synced through" mislabelling a request-compute timestamp even when healthy, a silently-failing retry button, and a timeout toast pointing at a label hidden below 900px | **Review complete, 2 rounds.** Item 1 (shared with QA-09): `SYNC_NOT_READY.retryable` fixed in `0b675112`. **Claim correction, not a product defect:** round 1 said "ready-but-cursorless" is unreachable because `readiness_status='ready'` has exactly one writer in the repo (`markReady`, which always persists a non-null cursor) — round 2 correctly narrowed this to "exactly one **production-runtime** writer": `scripts/cloud-seed.sql` and `packages/e2e/helpers/seed-billing.ts` both insert `ready` rows without a cursor for local/e2e seeding, and the DB schema doesn't enforce the invariant. Neither is a real-user-reachable path, so the message wording was left as-is (3 confirmed production states). Cite `2925b5e5`, `0b675112`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |     |

### QA-sync-20260831-01 — Triage has zero sync awareness

**Filed from `flow-completeness-auditor`'s state-table enumeration, not
independently live-driven this run** (Triage was not part of this run's own
walk; the auditor found it while enumerating every consumer of
`provider_sync_state`/`me.mailboxes[].readiness`).

`apps/web/src/features/triage/empty-state.tsx:58` renders the identical
"Nothing needs a decision right now." for all four `readiness` values —
`queued`, `syncing`, `ready`, and `failed` — because the component takes no
sync input of any kind. Triage is this product's highest-dwell screen (per
CLAUDE.md's own topic table, "the core ritual"), and this is the same class
of defect QA-onboarding-20260828-01 was filed P0 for on `/senders`: a
confident, positive claim about the user's own mail state that the app has
not earned, rendered on the screen the user is most likely to be looking at
when a background sync degrades.

**Regression test:** a spec seeding `readiness='failed'` on the active
mailbox and asserting the Triage empty state does NOT render the resting-
queue copy — must go RED against today's code first.

### QA-sync-20260831-02 — Senders' F032 fix has a live gap for `failed`

**Filed from `defect-class-sweeper` and `usability-editor`, independently,
each tracing the same lines.**

`apps/web/src/features/senders/senders-screen.tsx:539-540`:

```ts
const mailboxStillSyncing =
  activeMailbox?.readiness === 'queued' || activeMailbox?.readiness === 'syncing';
```

Two of four reachable values. `failed` (and `null`) fall through to the
`ready`-branch at `:2846`/`:2877`, rendering "Synced through &lt;asOf&gt; · N
senders found for you@gmail.com" over a pre-failure snapshot. This is
**the identical defect F032 (`QA-onboarding-20260828-01`) was filed P0 for
and shipped a fix for in #673** — fixed at the instance (`queued`/`syncing`),
left open for the one state that fix's own guard didn't enumerate. The
component's own existing test at `senders-screen.test.tsx:460` is literally
named _"does not claim 'Synced through' a time it never measured while the
mailbox is still syncing"_, sets `readiness='syncing'`, and is green — the
exact same false claim renders for `readiness='failed'` and nothing catches
it. The equivalent empty-state gap exists at `:2541`/`:2562`.

**Separately, even in the healthy `ready` case:** the usability editor traced
`asOf` to `apps/api/src/senders/senders.read-service.ts:915,1087` —
documented in its own source comment as "server time at compute
(observability)", computed as `new Date().toISOString()`. It is not a sync
timestamp at all; the word "Synced" asserts a completion the value cannot
back, even when nothing has failed. Smallest fix: rename the label to
"Results as of" for the healthy case, and widen the guard to
`readiness !== 'ready'` with distinct, honest copy for the failed case (see
QA-sync-20260831-10 for the exact proposed strings).

**Regression test:** extend the existing `senders-screen.test.tsx:460`
pattern with a `readiness='failed'` case asserting the same non-claim — must
go RED against today's code first.

### QA-sync-20260831-03 — the shell's two failure surfaces both go silent

**Filed from `finding-refuter` (SURVIVED, narrowed), `defect-class-sweeper`,
and `flow-completeness-auditor` — three independent source traces converging
on the same two files.**

`apps/web/src/features/sync/sync-now-button.tsx:161-162` — `return null`
unless `readiness_status === 'ready'` — takes the ONLY freshness/retry
affordance in the global chrome with it, on every authenticated route,
confirmed at both desktop and 375px this run (live, via a forced DB write +
hard reload, not a stale-cache artifact).

`apps/web/src/features/sync/sync-error-banner.tsx:88,112` — the component
whose entire job is "tell the user their sync is broken" — reads
`last_sync_error_at` only and returns `null` if it's unset. That column is
stamped exclusively by `incremental-sync.worker.ts`'s failure path; a
terminal **initial**-sync failure (the one state that genuinely produces
`readiness='failed'`) never touches it, so the banner never fires for the
exact state it exists to cover — including for `InvalidGrantError`, where
its own `needsReconnect` computation is unreachable dead code, evaluated
after the early return.

`apps/web/src/features/mailboxes/mailbox-reconnect-banner.tsx:39-41`
explicitly excludes the active mailbox on the documented premise that
`SyncErrorBanner` "already owns it" — which, per the above, it does not for
this shape. Net effect: a revoked grant on the mailbox the user is actually
looking at has **zero** chrome surface anywhere in the product except a
collapsed, default-hidden tag in the account-menu dropdown (confirmed to
exist — this refutes the seed candidate's "only Settings shows it" claim —
but it carries no retry action and requires the user to open a menu they
have no reason to open).

**Not filed as a separate row, folded in here:** `AccountMenu`'s "Sync
failed" chip (`account-menu.tsx:317-320`) has only negative test coverage
(two tests proving it's suppressed under `needsReconnect`, none proving it
renders) and no recovery action of its own — flagged `UNVERIFIED` by the
flow auditor, needs a positive render test.

**Regression test:** a spec mounting the app-chrome layout with
`readiness='failed'` on the active mailbox and asserting SOME visible,
actionable chrome element renders (not `null` across the board) — must go
RED against today's code first.

### QA-sync-20260831-04 — a broken second mailbox reads "Ready"

**Filed from `defect-class-sweeper`, source-traced, live-reachability
unmeasured this run (this dev DB's mailboxes are all currently clean —
confirmed via `assert-dev-db.sh --exec`, so this is a structural finding,
not a currently-manifesting one).**

`apps/web/src/features/settings/api/use-mailbox-health.ts:44-58` projects
`MailboxHealth` as `{ lastSyncedAt, needsReconnect }` — it does not carry
`last_sync_error_at`/`last_sync_error_code` at all, even though both exist on
the wire contract (`packages/shared/src/contracts/sync-status.ts:80-81`).
`needsReconnect` is `InvalidGrantError`-only
(`apps/web/src/features/mailboxes/mailbox-health.ts:21-25`). So a
non-active mailbox with a PERSISTENT incremental failure for any other
reason — sustained quota, a poisoned history id — has `readiness` still
`'ready'` (per `incremental-sync.worker.ts`'s own design, it never flips
readiness) and `needsReconnect: false`, and:

- `mailboxes-card.tsx:163-190` falls to `m.readiness === 'ready'` →
  `<StatusTag tone="muted">Ready</StatusTag>` — an affirmative, wrong claim.
- `account-menu.tsx:315-322` suppresses its failure chip for the same
  reason — silence, not even the wrong-but-visible badge Settings shows.

The drift-sweep cron re-enqueues every 5 minutes
(`provider-sync-state.ts:79-83`), so a transient failure self-heals fast —
but each failed re-enqueue re-stamps the error timestamp, so a _persistent_
cause (the kind worth surfacing) holds this false "Ready" state indefinitely.
The founder's own workspace (two connected mailboxes) is exactly the shape
that exercises the active-vs-non-active split this bug lives in.

**Regression test:** a spec seeding a non-active mailbox with
`last_incremental_error_at` set (persistent, `error_code` not
`InvalidGrantError`) and asserting Settings does NOT render "Ready" — must
go RED against today's code first.

### QA-sync-20260831-05 — failure is never announced, and the poll that would notice one is self-starving

**Filed from `defect-class-sweeper` and `flow-completeness-auditor`,
independently, converging on the same two files.**

`apps/web/src/features/mailboxes/use-mailbox-sync-toasts.ts:28-29` has one
branch: `→ ready`. A background mailbox flipping to `failed` produces no
toast, matching D116's "we'll let you know when it's ready" promise for the
success case only — its analytics sibling, `use-sync-funnel.ts:57`, already
pairs `readiness === 'ready' || readiness === 'failed'`, proving the
asymmetry was never a deliberate design choice.

Compounding this: `apps/web/src/features/auth/api/use-me.ts:110-116`'s
`refetchInterval` returns `false` **unless a mailbox is already known to be
syncing** (`meHasSyncingMailbox`, which excludes `failed`). Every surface
that reads `me.mailboxes[].readiness` — Senders, AccountMenu, Settings, and
the toast hook itself — therefore never gets a fresh read to discover a
`ready→failed` transition at all, without the user manually reloading or
refocusing the tab. (The lower-level `/api/v1/sync/status` endpoint DOES
poll correctly — 60s while `ready`, 10s while `failed` — so the true state
reaches at least one part of the client within about a minute; every
higher-level consumer of the `me`-derived projection still never asks.)

Real, non-QA-forced trigger for this exact scenario, per `flow-completeness-
auditor`: the fully server-side `cursorTooOld` recovery
(`apps/api/src/worker.ts:929`) resets `readiness` to `queued` with zero user
action — the "silent failure" case is not hypothetical.

**Regression test:** a fake-timer spec asserting `useMe`'s query re-fetches
within its interval when the server-side readiness value changes to
`failed` between polls — must go RED against today's code first.

### QA-sync-20260831-06 — every reconnect forces a full resync it doesn't need

**Filed from `defect-class-sweeper`. Live-verified this run's own reachability
count** (not the mechanism itself, which is source-traced): 4 of this dev
DB's 5 mailbox rows are currently `ready` with a non-null `last_history_id` —
exactly the shape that pays this cost on every future reconnect.

`apps/api/src/sync/sync.service.ts:146`, inside `markQueued`'s conflict
branch: `lastHistoryId: null, historyIdUpdatedAt: null`, alongside
`readinessStatus: 'queued'` — unconditionally, for every caller:
`auth-signup.orchestrator.ts:213` (add/reconnect/reactivate), `:253`
(`persistMailbox`), and `:318` (first signup). Four structurally different
causes share one remedy; only one of them (a genuinely brand-new mailbox)
needs it. Nulling the cursor on an active, `ready`, fully-indexed mailbox
that is merely re-authorizing defeats `InitialSyncWorker`'s own
`skipped_already_ready` guard (`initial-sync.worker.ts:377`), so the full
enumeration pipeline runs.

The cheap remedy already exists and is bypassed by the same statement that
discards the cursor: `SyncService.enqueueManualIncrementalSync`
(`sync.service.ts:395`) resumes from `last_history_id`. And the argument
"a long-lapsed grant might have a stale cursor anyway" does not rescue the
current code, because the escalation ladder for exactly that case **already
exists and already runs automatically**: `apps/api/src/worker.ts:915-941`
catches `cursorTooOld` (a Gmail 404 past the ~7-day history retention
window) and forces the full resync itself. Trying incremental first is
free — a stale cursor costs one `history.list` 404 and lands in the
identical remedy. The reconnect path skips straight to the top rung of a
ladder the codebase already built.

**Needs the founder** (per the sweeper's own flag): this touches the OAuth
reconnect flow. Not a hard §9 stop condition (no scope/token-crypto change),
but the founder should size the change before it ships, since it changes
what happens to `last_history_id` on every reconnect.

**Regression test:** a spec asserting that reconnecting a mailbox with a
non-null, non-stale `last_history_id` enqueues an incremental sync, not an
initial one — must go RED against today's code first.

### QA-sync-20260831-07 — the onboarding failure screen retries with a token that will never work

**Filed from `defect-class-sweeper`, source-traced.**

`apps/web/src/features/onboarding/sync-gate.tsx:88-101` supplies
reconnect-specific copy for `InvalidGrantError` ("Google revoked our access
to this inbox, so the scan could not finish. Reconnect the account to grant
it again.") and `AuthExpiredError`, but the `SyncFailed` screen renders one
primary action for all six known terminal error codes
(`:331-337` — `retry.mutate()`). There is no `startMailboxConnect` import in
the file at all. Clicking the only button re-queues a full scan using the
identical dead token, which fails again at `getClient`, writes `failed`
again, and returns the user to the same screen — after consuming one of the
3 attempts/minute the retry route is rate-limited to. The correct pattern
already exists one directory over:
`apps/web/src/features/sync/sync-error-banner.tsx:135` —
`onClick={() => (needsReconnect ? startMailboxConnect(mailboxId) :
sync.mutate(undefined))}`.

The same collapse reaches Settings by a second route:
`SyncService.getNeedsReconnectByMailbox` (`sync.service.ts:368`) tests only
`errorCode === 'InvalidGrantError'` — `AuthExpiredError` (thrown on any
Gmail 401, `gmail-client.service.ts:564`, and listed in the gate's own copy
table as a known terminal code) is not in that test, so a mailbox that
failed with `AuthExpiredError` shows "Sync failed + Try again" in Settings
instead of "Needs reconnect + Reconnect".

The only real exits from the onboarding gate's failure screen today are
"Disconnect and start over" and "Sign out" — both work, but neither is
signposted as _the_ fix for an auth failure the screen's own copy already
diagnosed correctly one sentence earlier.

**Regression test:** a spec asserting `SyncFailed` renders a reconnect
action (not just retry) when `errorCode` is `InvalidGrantError` or
`AuthExpiredError` — must go RED against today's code first.

### QA-sync-20260831-08 — one bad page in a history walk triggers the same full rescan as a truly-expired cursor

**Filed from `defect-class-sweeper`, source-traced, reachability
UNMEASURED — flagged by the sweeper as "reachable-but-unhit," not proven to
have fired in production.**

`packages/workers/src/incremental-sync.worker.ts:400-415`'s
`pageHistoryFrom` loop calls `client.listHistory(cursor, token)` per page and
`if (page === null) return null` on ANY page — collapsing "404 on page 1"
(genuine stale cursor) and "404 on page 5, after 4 pages already succeeded"
(direct evidence the cursor WAS valid) into the identical signal. That
`null` becomes `cursorTooOld: true`, and `apps/api/src/worker.ts:926-941`
responds by nulling the cursor and forcing a full resync — discarding the
pages already collected. This runs as a BullMQ `on('completed')` hook in the
composition root with no principal and no rate ceiling, which is the shape
CLAUDE.md §2.6 names for the Brief-cron incident: a producer-side gap a
request-level guard cannot see.

**Honest limit on the fix, per the sweeper:** unlike QA-06, no cheap
alternative exists today — `GmailClientService.listMessageIds` has no
bounded catch-up query parameter, so distinguishing "first-page 404" from
"later-page 404" is the cheaper half of a real fix, not the whole one.

**Not filed with a regression test** — reachability itself is unmeasured;
the sweeper's suggested probe is a Cloud Logging count of
`kind="sync.cursor_recovery_scheduled"` over 30 days, not a DB query.

### QA-sync-20260831-09 — this event has four names, one of which the product's own hook already bans

**Filed from `usability-editor`, source-verified against the actual copy
each surface renders.**

The onboarding gate calls it a **scan** ("Scan interrupted", "Your Gmail is
untouched — starting it again is safe," `sync-gate.tsx:308,311,321`).
Settings calls it **"SYNC FAILED"** (`mailboxes-card.tsx:175`). The account
menu calls it **"Sync failed"** (`account-menu.tsx:320`). The wire/endpoint
naming calls it "initial sync." `.claude/hooks/check-microcopy.sh:217-218`
already rules on this vocabulary — it bans "senders indexed"/"finished
indexing" and names "**first scan**" as the sanctioned term. Two live
surfaces did not get that memo.

Separately, `senders-screen.tsx:2862` renders "…senders indexed before this
sync started…" — after the hook's own whitespace/`${}` flattening, this is a
literal hit on its banned `senders indexed` pattern. It ships today only
because the hook is PostToolUse-only and has never swept pre-existing files.

**Proposed replacements** (from the editor pass):

- Settings badge: `"SYNC FAILED"` → `"Scan failed"`
- Account menu tag: `"Sync failed"` → `"Scan failed"`
- Senders still-syncing line: `"…senders indexed before this sync
started…"` → `"…senders from before this scan started…"`

**Regression test:** none — copy consistency, not a logic defect.

### QA-sync-20260831-10 — five smaller defects on the same surface, same editor pass

**Filed from `usability-editor`, each independently source-traced.**

1. **The 409 guard's message covers one state out of four it's actually
   returned for.** `apps/api/src/sync/sync.service.ts:409` returns
   `SYNC_NOT_READY` when `lastHistoryId === null` **or**
   `readinessStatus !== 'ready'` — covering `queued`, `syncing`, `failed`,
   and a ready-but-cursorless mailbox with one sentence ("Initial sync has
   not completed for this mailbox yet") that's only true for the first two.
   Worse: the response's `retryable: true` flag
   (`packages/shared/src/contracts/error-codes.ts:576`) is wrong for
   `failed` — per `sync.service.ts:472-479`'s own comment, nothing
   re-queues a `failed` row; only the continuous reconciler sweeps
   `'queued'`. Propose: `"This mailbox has no finished scan to sync from —
the scan is still running, or it stopped before completing."`
2. **The client toast promises self-recovery that can never happen for the
   failed case.** `apps/web/src/features/sync/api/use-sync-now.ts:158` —
   "Initial sync is still in progress — give it a minute." Propose:
   `"Can't check for new email — this inbox's scan hasn't finished. See
Settings → Gmail accounts."`
3. **`asOf` mislabels a request-compute timestamp as a sync completion, even
   when healthy** — see QA-sync-20260831-02 above for the full trace; the
   two-word fix ("Synced through" → "Results as of") applies independently
   of the `failed`-state gap.
4. **The retry mutation has no `onError`.**
   `apps/web/src/features/sync/api/use-retry-initial-sync.ts:35-73` handles
   `onSuccess` only; a 429 (the route is capped at 3/60s) or a 5xx silently
   flips "Starting…" back to "Try again" with no message, on the user's
   only recovery control.
5. **The 90-second timeout toast references a label hidden on mobile.**
   `sync-now-button.tsx:121` says "the 'synced' time above will update" —
   that label carries `className="dm-topbar-collapse"`
   (`display: none` below 900px, `:298-300`). On a phone the toast points
   at nothing.

**Regression test:** none of the five — copy/robustness gaps with no clean
red/green boundary except (4), which could assert a visible error message
renders on a mocked mutation rejection.

## billing

Rows accumulate across every `/ct-qa billing` run. Per-run counts are in the
ledger. First filed 2026-09-01 (11 survivors; 1 candidate — an orphaned-active-
subscription checkout lockout, reproduced only via a self-forced, unreachable
DB state — was fully REFUTED before filing, see the ledger for the refuter's
evidence; the SAME underlying mechanism turned out to be real and reachable via
two independent, correctly-scoped paths, filed below as QA-billing-20260901-01
and -02).

**Second refuter pass, same day, on the 5 originally-filed P1s specifically**
(dispatched after filing, since these were about to drive `FINDINGS.md`
founder decisions and the run judged that consequence high enough to warrant
it despite the extra round). Outcome: only 2 of 5 survive as P1
(`-03`, `-04` — both CONFIRMED STRONGER than filed, with corrections noted on
each row below). The other 3 (`-01`, `-02`, `-05`) were each PARTIALLY
REFUTED — the filed mechanism/severity was wrong, but each had a real, narrower
defect survive underneath; corrected severity and text below and in
`FINDINGS.md`. None of the later `-06` through `-11` rows went through this
second pass (see "Boundaries" caveat at the end of this section).

|     | id                     | sev | one line                                                                                                                                                                                                                                                     | status                                                                                                                                                                                                                                                                                                                                                                                                     | PR   |
| --- | ---------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 🟢  | QA-billing-20260901-01 | P2  | A chargeback (and any non-backing block) disables the plan picker entirely, which suppresses the only explanation/support-route the app has for the block — corrected from a filed "missing chargeback copy" claim, REFUTED as deliberate design             | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — behavior clean through round 2 (`131994e2`); round-2 coverage gap (chargeback-shaped fixture) closed test-only in `6050ec1a`, no behavior change                                                                                                                       | #704 |
| 🟢  | QA-billing-20260901-02 | P2  | Canceling a PAUSED subscription genuinely books at the provider (not a no-op as filed — REFUTED) but the screen has no "cancellation booked" state, re-renders identically with an inert Cancel button, and the toast wrongly claims the plan "stays active" | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — clean through round 2 (`131994e2`)                                                                                                                                                                                                                                     | #704 |
| 🟢  | QA-billing-20260901-03 | P1  | After a successful Pause, the billing screen keeps showing an active paid plan (price, renewal date, live Cancel button) — CONFIRMED, worse than filed: the endpoint writes nothing locally at all, so the stale read is guaranteed, not merely likely       | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — round 2 CLOSED (`131994e2`); a stale doc-comment (not behavior) was reconciled in `6050ec1a`                                                                                                                                                                           | #704 |
| 🟢  | QA-billing-20260901-04 | P1  | The monthly cleanup-quota card says "resets this month" — CONFIRMED via live DB query on the account driven: 12/12 units spent in August, told to the user in September as "this month"; scope widened to a copy defect class across several surfaces        | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — clean through round 2 (`131994e2`)                                                                                                                                                                                                                                     | #704 |
| 🟢  | QA-billing-20260901-05 | P3  | The initial `/billing` Pro card shows $190 with no $129 Founding Pro mention — REFUTED down from "never discloses, $61/yr more with zero indication": the $129 price IS shown, in bold, on the mandatory confirm panel one click later                       | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — clean through round 2 (`131994e2`); fail-open availability gate raised as a question, deliberately unchanged                                                                                                                                                           | #704 |
| 🟢  | QA-billing-20260901-06 | P2  | The "don't change anything" button carries 4 different labels across the billing surface, and "Cancel subscription" is reused for both the preview-opener and the destructive confirm                                                                        | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — round 2 CLOSED (`131994e2`)                                                                                                                                                                                                                                            | #704 |
| 🟢  | QA-billing-20260901-07 | P2  | Updating your payment method mints a permanent $0/"Due"/no-document Paddle transaction the adapter can't distinguish from a real unpaid invoice; it sorts to the top of the list forever, and the invoice list has no column headers                         | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — round 3 CLOSED (`6050ec1a`)                                                                                                                                                                                                                                            | #704 |
| 🟢  | QA-billing-20260901-08 | P2  | "Keep current plan instead" on a scheduled-downgrade notice 409s whenever the backing row is `past_due`, with one generic error string that falsely implies an unresolved outcome for what are actually deterministic refusals                               | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — clean through round 2 (`131994e2`)                                                                                                                                                                                                                                     | #704 |
| 🟢  | QA-billing-20260901-09 | P2  | A founding member's plan-lock and cancel-forfeits-the-$129-price are both undisclosed until a click/409; a sold-out Founding Pro promo is still offered and only fails at confirm, since `foundingRemaining()` has no route or FE consumer                   | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — clean through round 2 (`131994e2`); fail-open availability gate raised as a question, deliberately unchanged                                                                                                                                                           | #704 |
| 🟢  | QA-billing-20260901-10 | P2  | "Effective immediately" upgrade-charge copy is contradicted by the same flow's own pending/unconfirmed-grant states one screen later; the Pro card claims coverage "across every account" against an actual 5-inbox cap shown on the same card               | Fixed 2026-09-01 — static+test-verified this session (all 11 targeted tests green, code matches filed fix exactly); `Merged #704` — round 3 CLOSED (`6050ec1a`); one test-hardening item applied in `2da85a4c`, no source change                                                                                                                                                                           | #704 |
| 🟢  | QA-billing-20260901-11 | P3  | `useFocusTrap` on the Cancel-subscription modal puts initial keyboard focus on "Pause for 30 days" (a real, unconfirmed mutating action) rather than a neutral default — narrow population, self-serve recoverable via Resume                                | Fixed 2026-09-01 — static+test-verified this session; `Merged #704` — clean through round 2 (`131994e2`). CAVEAT found this session: the code fix is correct (`cancel-modal.tsx` passes `initialFocusSelector` unconditionally), but no test asserts it on the real `CancelModal` — only a generic `focus-trap-contract.test.tsx` hook test exists. Fix confirmed; test-coverage gap flagged, not blocking | #704 |

Three Codex rounds ran against this PR — one more than the process's normal
2-round cap, explicitly founder-authorized after round 2 landed `-07`/`-10`
at cap (round 1: `326320a1` → 5 findings, fixed in `131994e2`; round 2:
`131994e2` → 2 partial + 1 carried-over real defect, fixed in `6050ec1a`;
round 3: `6050ec1a` → CLEAN, all 5 round-2 findings confirmed resolved, only
2 P2 test-hardening suggestions, applied in `2da85a4c` with no source
change). CI's "Authenticated accessibility smoke" job caught two further
gaps post-review — stale E2E assertions of the pre-fix QA-04/-06 copy,
fixed in `00bd0c3d`/`7e57ce6e` — before merge. **Merged 2026-09-01 as
`adac73c4` (squash).** Every row is `Merged #704`, not yet `Fixed` — no
run has re-confirmed the symptom against production/main since. Full
findings and disposition: `docs/qa/launch-qa.md`'s "Fix phase —
2026-09-01, PR #704".

### QA-billing-20260901-01 — chargeback drift traps the customer in a generic, partly-inert notice

**Core mechanism.** A chargeback writes `entitlement_ends_at = now()` and pins
`cancel_at_period_end = true` immediately (`apps/api/src/billing/billing-webhook.service.ts:882,961`),
so the workspace drops to Free while the `subscriptions` row stays `status='active'`
on the old tier — by founder decision (2026-08-13), chargebacks are deliberately
excluded from the `refund_settling` grace branch and stay blocking until the
provider's own period-end cancel arrives. That policy is correct and not in
question. What is not designed: `billing-model.ts`'s `nonBackingReason`
classification has no `chargeback` arm, so this state falls through to the
generic `tier_mismatch` copy — _"A Pro subscription is on your account. Your
account is on Free — this subscription isn't what grants it. Cancel it if
you're done with it."_ All three clauses are wrong or inert for this cause: the
cause is a chargeback, not a stray subscription; clicking Cancel is a no-op
(`cancel_at_period_end` is already `true`, so `billing.service.ts:408`'s
idempotency check skips the provider round-trip and returns an identical
payload); and the locked plan picker carries no explanation anywhere on screen.
The one chargeback-specific copy branch that exists (`billing-model.ts:522-527`)
requires `sub.tier === entitlementTier`, which is unreachable once the tier has
actually been revoked — the codebase's own test file calls it a "defensive arm"
in a comment.
**Evidence.** Found independently by `flow-completeness-auditor` reading
`billing-webhook.service.ts` and `billing-model.ts` directly (not reproduced
live — chargebacks aren't simulable without a real dispute). A _different_,
DB-forced reproduction of the same downstream symptom (generic notice, inert
Cancel, locked picker) was driven live this run and is reported accurately —
see "What this is NOT" below for why that specific reproduction doesn't stand
on its own.
**What this is NOT.** The original candidate filed from this run's own live
walk — forcing `workspaces.tier='free'` next to the real, healthy, active Pro
subscription via a direct DB write — was independently REFUTED by
`finding-refuter`: no production code path can ever produce that exact
combination (both writers of `workspaces.tier` deterministically recompute
`pro` from that row's shape), the missing plan-card CTA is the correct,
already-shipped fix for a 2026-07-27 bug (`MISTAKES.md`), and the checkout 409
that reproduction hit is the ordinary, correct one-subscription guard, not
evidence of drift. See the ledger's Refuted table for the full grounds. This
row exists because the _chargeback_ path — a real, reachable cause the refuter
and the flow-auditor both independently surfaced — produces the identical
customer-facing symptom for a real reason.
**Siblings, same underlying gap** (the `nonBackingReason` classifier not
covering a state it should): QA-billing-20260901-02 below (paused-row cancel)
is the same shape — a real transition reaching `NonBackingSubscriptionNotice`
with no correct branch.
**Regression test (as originally filed — superseded, see correction below).**
`billing-model.test.ts` — force `cancelSource='chargeback'`,
`entitlementLapsed=true`, `sub.tier !== entitlementTier` and assert
`nonBackingReason` returns a `'chargeback'` (not `'tier_mismatch'`) arm; assert
the rendered copy names the chargeback and does not offer an inert Cancel as
the only action. Must go RED against today's code (the classifier has no
`chargeback` branch to select).

**Refuter correction (2026-09-01) — PARTIALLY REFUTED, severity P1 → P2.**
The cause above is wrong: `billing-model.test.ts:244` already has a PASSING
test named _"a CHARGEBACK row keeps the old story — it never unlocks, so the
copy must not promise it"_ asserting `nonBackingReason === 'tier_mismatch'`
for exactly this row. The missing `chargeback` arm is deliberate, founder-
intended, test-pinned design — not an oversight — and the regression test
above would require deleting a test that encodes that intent. What survives:
D253 itself says a blocked customer "contact[s] support to subscribe again,"
and `billing.service.ts:141` says "the unchanged refusal is what tells them
so" — but the FE **disables the picker** in this state, so that refusal
message is never rendered at all, for chargeback OR any other non-backing
block (same gap `-02` hits from the cancel-on-paused angle). Zero
chargebacks have ever occurred in this product's production history
(`FOUNDER-FOLLOWUPS.md`, verified 2026-08-13) — narrowing severity further.
**Corrected regression test:** assert that whenever the plan picker is
`disabled` for ANY non-backing reason, the on-screen notice names a support
contact / next step — not that `nonBackingReason` grows a new enum member.

### QA-billing-20260901-02 — canceling a paused subscription is a silent no-op

**Core mechanism.** `cancelAtPeriodEnd()` (`billing.service.ts:384-403`) allows
canceling any row with `status IN ('active','past_due','paused')` — including
paused ones. The row stays `paused`, so `NonBackingSubscriptionNotice` keeps
rendering its `paused` branch, which never reads `cancelAtPeriodEnd` anywhere in
`billing-screen.tsx` (the only occurrence of that field in the whole file is a
comment). After confirming the cancel, the screen renders **byte-identical** to
before: "Your Plus subscription is paused until X. Resume to reactivate Plus,
or cancel if you're done with it," with both "Review resume" and "Cancel
subscription" still offered — nothing states a cancellation is booked. The
success toast (`billing-screen.tsx:459-465`) makes it worse: it fires the same
"your plan stays active until `<date>`" message for every cancel, including
this one, where the workspace's actual entitlement may already be Free.
**Evidence.** Found by `defect-class-sweeper` sweeping the seed mechanism
(a status-only guard blind to `cancel_at_period_end`); code-read only, not yet
live-driven (would require a real paused subscription, which this run's single
real subscription — active, not paused — could not produce without forcing a
state on the one live sandbox row, which this run declined to do without
founder sign-off given it is billing/Tier 1).
**Siblings, same mechanism** (asymmetric guards on the same pause/cancel
collision, `defect-class-sweeper`, code-read only — not independently filed as
separate rows, promote on live reconfirmation):

- `pauseForThirtyDays` correctly refuses a `cancel_at_period_end` row
  (`SUBSCRIPTION_CANCELING`, `billing.service.ts:602-610`), but `resume()` has
  no matching refusal for a row with `cancel_at_period_end` set, and
  `resumeCancellation` requires `status IN ('active','past_due')` — so a paused
  row that gets canceled has NO in-product undo until the user resumes first.
- Two-tab race: `plan-picker.tsx` invalidates on `STALE_BILLING_READ` codes;
  `pauseErrorMessage`/`resumeCancellationErrorMessage`/`cancelErrorMessage` do
  not, so a second tab can 409 on a control it still renders as available, with
  no reconcile.
  **Regression test.** `billing.service.spec.ts` — cancel a `paused` row, assert
  `cancelAtPeriodEnd=true`, `status` unchanged; `billing-screen.test.tsx` — assert
  `NonBackingSubscriptionNotice` renders a distinct "cancellation booked" state
  when `sub.cancelAtPeriodEnd === true`, and that the confirm toast does not claim
  the plan "stays active" for a non-backing row. Must go RED against today's code.

**Refuter correction (2026-09-01) — PARTIALLY REFUTED, severity P1 → P2.**
"Silent no-op" and "NO in-product undo" are both wrong. Cancel-on-paused is
the DESIGNED exit path, spec-pinned (`billing.service.ts:668` comment "paused
subs must resume (or cancel) first"; `billing.service.spec.ts:1046` is
literally named "resume or cancel first"; `billing-screen.test.tsx:2843`
asserts the paused notice renders a Cancel control on purpose). The
cancellation genuinely IS booked at the provider — Paddle's `POST
/subscriptions/{id}/cancel` fires, `cancel_at_period_end` is written under
the webhook lock — and an undo path DOES exist: Resume clears it, then the
normal "Keep my plan" un-cancel flow appears. It is undiscoverable, not
absent. What survives: the toast's own violation of this codebase's own
written rule — ADR-0027 says future "stays on X" claims were deliberately
dropped from cancel copy for non-backing rows, and `CancelModal`'s preview
correctly obeys that (`cancel-modal.tsx:182-206`), but `onConfirmCancel`'s
toast does not — plus `NonBackingSubscriptionNotice` has no
`cancelAtPeriodEnd` arm, so it re-renders identically (a real re-render off
fresh cache data, not a stale read) with a now-inert Cancel button, the same
defect class `-01` hits from the disabled-picker angle. **Unmeasured, gates
severity further:** whether Paddle's API even accepts a cancel on an already-
paused subscription without erroring — untested, since forcing a paused
state on the one real sandbox subscription was declined without founder
sign-off.

### QA-billing-20260901-03 — Pause has no pending state; screen asserts active plan indefinitely

**Core mechanism.** `onPause` fires a toast and closes the modal without calling
`startPending` (unlike every other billing mutation on this screen).
`usePauseSubscription` invalidates the billing query exactly once, immediately
— before Paddle's `subscription.paused` webhook can possibly have landed.
`refetchOnWindowFocus` is off client-wide, and `refetchInterval` is armed only
for a pending lock or a refund state, neither of which pause sets. Result: the
current-plan card keeps reading "Pro · $190/yr · Next renewal …" with a live,
clickable "Cancel subscription" button, for an indefinite period, while the
workspace's real entitlement may already be Free. Clicking that stale Cancel
button is the entry point into QA-billing-20260901-02 above.
**Evidence.** `flow-completeness-auditor`, code-read (`billing-screen.tsx:720-732`,
`api/use-pause-subscription.ts:26-31`). Not live-driven — pausing the one real
sandbox subscription this run had access to was declined without founder
sign-off (billing/Tier 1, and it would have consumed the run's only live fixture).
**Regression test.** Component test on the pause mutation hook/handler —
assert a pending/confirming UI state renders immediately after a successful
pause `POST`, and that the card does not continue rendering the pre-pause
price/renewal/Cancel affordance. Must go RED against today's code (there is no
pending branch to remove).

**Refuter correction (2026-09-01) — SURVIVES, CONFIRMED STRONGER, P1 stands.**
Checked whether the API writes pause state synchronously (which would have
refuted this, since an immediate refetch would then see correct data): it
does not. `billing.service.ts:618-633` writes NOTHING locally on pause — not
`status`, not even `pause_until` (an earlier revision wrote it; a Codex
stop-review removed it, and the mutation hook's own code comment claiming
otherwise is now stale). So the stale read isn't a race the webhook might
win — it's guaranteed every time. One correction: "indefinite" is
overstated. `staleTime: 60s` plus TanStack's default `refetchOnMount` means
any navigation away and back, or a reload, self-corrects it — the true
window is "for as long as the user stays on the billing screen right after
clicking Pause," which is exactly the moment they'd see and could click the
still-live Cancel button. Also correct the "unlike every other mutation"
framing: Cancel also skips `startPending`, but for a valid reason (it writes
`cancel_at_period_end` synchronously, so its own immediate refetch IS
correct) — pause is uniquely the one mutation whose result never arrives on
its own by any path.

### QA-billing-20260901-04 — quota reset date shown is wrong

**Core mechanism.** The cleanup-quota card reads `"38 of 50 cleanup actions left
this month."` The reset boundary is actually the user's **signup anniversary**
(`apps/api/src/common/entitlements/entitlements.service.ts:104-107`,
`cleanupPeriodFor`), not the calendar month — a user who signed up on the 17th
sees "this month" and reasonably expects a reset on the 1st, not the 17th. The
correct date (`cleanupResetsAt`) is already fetched by this exact component's
own data hook (`use-tier.ts:20,53`) and sits unused right next to the number
that IS rendered. Two sibling surfaces already render the true date correctly:
the upgrade modal ("your quota resets on `<date>`") and onboarding ("the
counter resets on your signup anniversary").
**Evidence.** `usability-editor`, source-read (`billing-screen.tsx:1219-1220`
vs `upgrade-modal.tsx:167-168`, `step-first-triage.tsx:140`). Live-confirmed the
card's rendered text this run ("38 of 50 cleanup actions left this month.");
did not independently verify this account's actual `cleanupResetsAt` value
against its signup date.
**Why P1, not P2.** This is a factual claim about the user's own billing state
that the app already knows is false and already renders correctly two clicks
away — the exact "claim only as true as what backs it" defect class this
codebase has repeatedly shipped (CLAUDE.md §8).
**Regression test.** `billing-screen.test.tsx` — seed a workspace whose signup
date is NOT the 1st of the month, assert the quota card renders the actual
`cleanupResetsAt` date, not the word "month". Must go RED against today's code.

**Refuter correction (2026-09-01) — SURVIVES, CONFIRMED STRONGER, P1 stands.**
The refuter ran a live, read-only DB query against the exact workspace this
run drove (`fab42715…`): signed up 2026-05-27, current cleanup period
2026-08-27 → 2026-09-27, all 12 consumed units spent in **August**. Today is
2026-09-01 (September) — the user has spent zero cleanup actions "this
month" and is told 12 are already gone. This is not a hypothetical edge
case; it is visibly wrong, today, on the account driven. Two corrections to
the original filing: (1) the illustrative example ("signed up the 17th,
expects the 1st") was not this account and understated the problem — the
real gap here is 3 days off a full month, not a few days; (2) the "two
sibling screens already do this correctly" framing needs narrowing — the
refuter found "this month" is the product's CANONICAL quota phrase, repeated
verbatim in the server's own 402 message, `error-codes.ts`, an empty-state
component, and the upgrade-modal sibling this row cited as "correct" —
that modal also says "this month" and only appends the precise date next to
it. Scope is therefore a copy defect class across several surfaces sharing
one grammar, not a single-component fix — grep for the phrase before fixing
just `billing-screen.tsx:1219`.

### QA-billing-20260901-05 — in-app upgrade path hides the Founding Pro price

**Core mechanism.** `/pricing` offers "$129/yr for the first 250 subscriptions"
for an eligible account with a prominent banner and struck-through $190. The
in-app `/billing` screen's Pro card shows only "$190/yr" with zero mention of
$129 anywhere until the user clicks Upgrade and finds a Founding Pro checkbox
that defaults OFF (a deliberate 2026-07-29 decision this finding does not
contest). The result: the exact same eligible account is charged $190 or $129
purely depending on which door they used to reach checkout, and the more
expensive door (in-app nav, arguably the more common one) never discloses the
cheaper option exists.
**Evidence.** `usability-editor`, source-read (`plan-picker.tsx:763-773,1169-1195`
vs `marketing/pricing/tier-card.tsx:155-186`). Live-confirmed the `/billing`
Pro card's rendered text this run (no $129 mention); did not independently
re-derive eligibility rules beyond what the manifest states.
**Regression test (as originally filed — superseded, see correction below).**
`plan-picker.test.tsx` — for an eligible (non-founding,
promo-live) account, assert the `/billing` Pro card surfaces the Founding Pro
price/eligibility, not only the confirm-panel checkbox. Must go RED against
today's code.

**Refuter correction (2026-09-01) — MOSTLY REFUTED, severity P1 → P3.** The
central claim was false as filed: `plan-picker.tsx:1169-1195` DOES render a
bold "Claim Founding Pro — $129/yr · First 250 members, price locked while
you stay subscribed" checkbox, directly above the $190 line, inside the
mandatory D226 confirm panel that is the only path to checkout — pinned by
`plan-picker-provider-gate.test.tsx:141-145,196-197`. "Never discloses,"
"$61/yr more with zero indication," and "charged $190 or $129 purely
depending on which door" are all false — the price is disclosed, in bold,
one click before the charge, on both doors alike; only the pre-tick default
differs, which is the already-conceded, unappealed 2026-07-29 decision. Real
residual gap, much smaller: the INITIAL Pro card (before that click) shows
only $190 with no $129 mention, while `/pricing` leads with $129 — a
prominence/consistency issue, not a disclosure or overcharge one. The
refuter also flagged the originally-proposed regression test as unwritable
honestly: the Pro card has no live availability data source
(`foundingRemaining()` has no controller route or FE consumer — see `-09`),
so quoting $129 there without one would ship the exact unbacked-claim class
CLAUDE.md §8 warns against. **Corrected regression test:** none proposed
pending `-09`'s availability-route fix; a prominence-only fix (show the
struck price on the card, keep the confirm-panel default-off checkbox as the
actual gate) needs no new backend data and could be tested as a pure
rendering assertion instead.

### QA-billing-20260901-06 through -10 — copy/usability findings (see `usability-editor` transcript for exact replacement text on each)

Filed as one block since each is independently small; do not merge the FIXES
into one PR without founder confirmation that a single PR is wanted for all
five — they touch different components.

- **-06 (button-label drift):** `cancel-modal.tsx:318` "Keep my plan" ·
  `plan-picker.tsx:1060,1221,887` "Keep current plan"/"Keep current plan
  instead" · `billing-screen.tsx:1294,1322,1421` "Keep my subscription" — four
  spellings of one safe-exit button. Also `billing-screen.tsx:1243-1245,1688-1690`
  and `cancel-modal.tsx:320-326`: "Cancel subscription" labels both the
  preview-opener and the destructive confirm.
- **-07 ($0 invoice + no headers):** `invoice-history.tsx:131-196`. Confirmed
  via `finding-refuter`: the $0/`ready`/no-document row is not a stale test
  artifact — Paddle mints this exact shape (`origin:
"subscription_payment_method_change"`) every time a customer updates their
  card via this same screen's own "Update payment method" button; the adapter
  never reads `origin`, so it renders under the identical "Due" label a real
  past-due dunning invoice gets, and sorts to the top (`billed_at` is null).
- **-08 (scheduled-downgrade 409):** `billing-screen.tsx:1406-1430` vs
  `billing.service.ts:714,772-796`. "Keep current plan instead" throws
  `PLAN_CHANGE_UNSUPPORTED` for any non-`active` backing status; the one error
  string covers three deterministic 409s with "it may or may not have
  registered."
- **-09 (founding-member disclosure):** `billing.service.ts:602-610,720-722,1307`
  vs `plan-picker.tsx:316,1169`. `foundingRemaining()` has no controller route
  and no FE consumer; `FOUNDING_PLAN_LOCKED` is discovered only after a
  preview/confirm 409; `CancelModal` gives a founding member no warning that
  canceling forfeits the $129 lock permanently once the 250-cap is hit.
- **-10 (contradicted "immediately" + inbox-count overclaim):** `plan-picker.tsx:993`
  "Effective immediately" vs the same flow's own `"confirming your
plan"`/"taking longer than usual" states; Pro card "across every account"
  vs the manifest's actual `inboxLimit: 5`, printed as "5 connected inboxes"
  on the very same `/pricing` card.

**Regression tests.** Each is a copy/rendered-string assertion in its
respective `*.test.tsx` — see the `usability-editor` transcript (this run,
2026-09-01) for the exact before/after text per item.

### QA-billing-20260901-11 — Cancel-modal focus-trap lands on "Pause for 30 days"

**Core mechanism.** `useFocusTrap` (`packages/shared/src/hooks/use-focus-trap.ts:23`)
unconditionally focuses the first focusable DOM element in the trap on open,
with no caller override. `cancel-modal.tsx`'s first focusable element (when
`canPause` is true: `sub.provider === 'paddle' && sub.status === 'active' &&
!sub.cancelAtPeriodEnd`) is the "Pause for 30 days" button — a real,
unconfirmed mutating action — rather than "Keep my plan" or the reason
dropdown.
**Evidence.** Live-verified twice this run via browser automation
(`document.activeElement` immediately after open, both times "Pause for 30
days"); Escape closes cleanly with correct focus-return and zero mutation
(DB-confirmed). `finding-refuter` on this candidate returned **partially
refuted**: the hook itself is working as designed (WAI-ARIA-APG default
first-focusable, has its own passing contract test) and is NOT the defect; the
defect is scoped to this one file's DOM order. Severity corrected from the
originally-filed P2 down to P3 — recoverable via self-serve Resume, mouse
users unaffected, a deliberate keystroke is required, and this is exactly the
Paddle-active-not-already-cancelling population (unmeasured size).
**IMPORTANT — this is a distinct defect from an already-fixed one on the same
hook.** `useFocusTrap` had a real, different, already-FIXED defect
(`useLongPress is not a function` — a barrel-import crash, PR merged per this
file's `mailbox-switch` section, `00e355fd`/`4359a8b8`) whose fix's own
live-verification explicitly checked that `cancel-modal.tsx` and
`delete-account-modal.tsx` "render and focus-trap correctly, zero console
errors" — that check is about the trap not crashing, not about which element
receives initial focus, so it does not cover this finding.
**Siblings, same mechanism, found by `defect-class-sweeper` sweeping all 21
production `useFocusTrap` call sites — NOT filed as separate rows under this
job (they belong to other jobs' surfaces); recorded here per finding, flagged
to the founder for those jobs' own follow-up:**

- **`mailbox-data-controls-dialog.tsx:65`** (Disconnect Gmail account) —
  first focusable is "Disconnect and keep data" (revokes the stored Google
  credential immediately on Space/Enter, no further confirm). **LIVE-VERIFIED
  this run** (`document.activeElement` = "Disconnect and keep data" on open;
  closed via Escape, zero mutation). Belongs to the `mailbox-switch` /
  `disconnect-reconnect` job's worklist — flagged, not filed here, since this
  run's scope is billing only.
- **`triage/action-sheet.tsx:190`** (Delete preview on a Protected sender) —
  the Delete verb's preview body renders zero matched focusables, so focus
  falls through to `ProtectedActionNotice`'s "Unprotect" button, which mutates
  sender policy directly `onClick` with no preview/undo. Code-confirmed only
  (trust 7/10) — not live-driven this run (would require reaching Triage's
  Delete-on-Protected-sender surface, outside this run's job scope). Belongs
  to the `triage` / `protect` job's worklist.
- **`account-deletion/delete-account-modal.tsx:82`** — ruled OUT for this
  specific mechanism (step 1's first focusable is an inert acknowledgment
  checkbox). A DIFFERENT, adjacent defect was spotted on the same file: the
  trap's effect dependency array is `[active]` only, and `active` does not
  change across the step 1 → step 2 transition, so focus may fall to
  `<body>`, outside the `aria-modal` dialog, when "Review deletion timing" is
  clicked. Unmeasured — not live-driven. Belongs to the `delete-account` job's
  worklist.
- Second band (lower consequence — all still behind a D226 confirm step, not
  filed as rows): Triage Unsubscribe preview focuses "Also archive the N
  emails already in the inbox"; Triage Archive preview focuses the "Skip this
  dialog for Archive" (D34 remember-preference) toggle; Senders single-sender
  Delete confirm may focus the widest ("All inbox") time-window chip while the
  preview is still in flight.
  **Regression test.** `cancel-modal.test.tsx` — assert initial focus (when
  `canPause` is true) lands on "Keep my plan" or the dialog container, not
  "Pause for 30 days". Must go RED against today's code.
