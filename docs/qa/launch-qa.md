# Launch QA ledger

Written by `/ct-qa` (see `.claude/commands/ct-qa.md`). One row per run,
**append-only** — a job QA'd twice keeps both rows, because the interesting
thing is usually what changed between them.

This file is the tool's memory. A fresh session reads it to know what is done,
and bare `/ct-qa` starts the highest-priority job that has no passing row yet.
A job is not QA'd because someone remembers doing it; it is QA'd when it has a
row here.

**This file never changes after a run is written.** It records what happened.
What is being _fixed_ — approval state, the Codex handoff, the PR — lives in
`docs/qa/qa-worklist.md`, one row per surviving finding, and that is the only
one of the two that moves.

**Nothing is filed unrefuted.** Findings reach this table only after a
`finding-refuter` verdict. Refuted candidates get a line in Refuted below
rather than vanishing — the record of what was argued and killed is worth as
much as the findings that survived. P0/P1 survivors are also appended to the
`FINDINGS.md` Inbox for `/ct-finding triage`; P2/P3 live here only.

## Runs

| job    | date       | personas                                                   | broke it? | findings (new / inherited)                                                                                                              | notes                                                                                                                                                |
| ------ | ---------- | ---------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| triage | 2026-08-27 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 15 new / 0 inherited (first triage run); 4 refuted before filing. 3 P1 + 1 P2 also in `FINDINGS.md`; all 15 in `docs/qa/qa-worklist.md` | Drove list → expanded card → preview → mutation → undo on the real mailbox. D226 held on every reachable path. `U` never pressed. Full detail below. |

### `triage` — 2026-08-27

**Walked:** `/triage` list, expanded card, Archive preview (populated + zero-match),
confirm, post-action toast, `/activity` undo, mobile 375px, keyboard, mailbox switch.

**Filed (survived `finding-refuter`):**

- **P1 — queue `ORDER BY` is not a total order.** `case 'actionable': return null`
  (`triage.read-service.ts:301`) means the live ordering is
  `[verdictPriority, desc(confidence)]` with no tiebreak; the `senderKey` tiebreak
  is on the onboarding branch and never runs on `/triage`. Measured: 6 rows tie at
  `0.91`, 2 at `0.89`, **33 at `0.87`** for the last 4 of 12 slots — so queue
  _membership_ is undefined, not merely order. Observed: five untouched rows
  reshuffled at unchanged confidence; Classic Firearms went #2 → #12.
- **P1 — "LAST SEEN today" is false for 89% of the rows that assert a recency.**
  `sql<Date | null>` at `:541` is an unhonoured assertion; runtime probe of the
  live process returned `aggType:"string"`, so `instanceof Date` fails and the
  `: 0` branch renders "today". Measured: 849 of the 954 senders where the tile
  claims a day-value are wrong; 7,097 quiet senders are rescued by the FE guard,
  which is gated on `last90dMessages === 0` and so covers only the absurd cases.
  Already named in merged PR #258, unfixed ~8 weeks.
- **P1 — "reduce future noise by ~10%" measures the past.** `queuedNoise` is a
  90-day share of mail already received; Archive and Later both declare
  `futureMail: { effect: 'unchanged' }`. Only Unsubscribe changes future mail.
- **P2 — entitlements cap is one `::int` from inverting** (Tier 1 billing;
  surfaced, not decided). Its spec runs on PGlite, not the production driver.

**P2 / P3 kept here (from `usability-editor`, each verified against source):**

- **P2** — same card names one measurement twice: the collapsed row says
  "marked read" (with an explicit comment at `triage-row.tsx:97` — "VERB:
  'marked read', never 'opened'" — because Gmail only exposes the absence of
  `UNREAD`), while the tile says `read rate 90d` (`triage-row-expanded.tsx:64`)
  and the generated bullet says "Read rate". The looser name claims a human read
  it. Use "MARKED READ · 90D".
- **P2** — "How Triage works" promises "You'll see the affected email before
  anything changes" while naming Keep first; Keep dispatches with no preview by
  design (D40, non-destructive, `triage-screen.tsx:1043`). Behaviour is correct,
  the copy overclaims.
- **P2** — undo deadline is shown in two clocks two clicks apart: previews render
  in the reader's zone, the toast hardcodes `timeZone: 'UTC'`
  (`undo-tray.tsx:342`). Observed as "Sep 27, 8:04 AM UTC" for an
  `America/Los_Angeles` workspace.
- **P2** — stat grid is windowed in two tiles and unwindowed in two, with no
  labels saying so; the row reads "131 messages" (90d) and the card "283
  RECEIVED" (all time) for one sender. At 375px each tile gets ~44px, so "90D"
  orphans onto its own line.
- **P2** — the preview footer (reversibility line, Cancel, Archive) is an
  ordinary child of a `76vh` scroller, so on a 375×667 phone the primary action
  sits below the fold behind eight blocks of explanation. Hit during this run:
  the confirm button had to be scrolled into view before it could be clicked.
- **P3** — the `K · A · U · L · D` legend renders from first paint, but the
  keydown listener mounts only inside an expanded row, so the keys do nothing
  until one is open. Verified: pressing `a` with nothing expanded is a no-op.
- **P3** — rows 2–12 show a bare `›` while row 1 shows a rationale paragraph;
  reads as "row 1 loaded and the rest failed" rather than as collapsed.
- **P3** — a sender with 0 inbox mail occupies a decision slot with no signal
  until the preview opens. Defensible (Unsubscribe and Keep still apply) and the
  preview handles it correctly, so noted rather than filed.
- **P3** — the H1 and the "12 DECISIONS WAITING" legend give an unscoped count
  with nothing marking the 12 as a page, and there is no "done for today"
  moment to correct it: `TriageEmptyState` renders only at `rows.length === 0`,
  which this mailbox never reaches because the queue silently refills to 12
  after every confirmed decision. Session progress therefore never falls below
  "N decided · 12 to go". Downgraded from the P2 above once the pool's
  composition was measured.
- **P2** — **D30's adaptive queue size is dead code.** `GET /api/triage/queue-size`
  exists and the controller documents "the client should first hit `/queue-size`
  to pick the right limit", but nothing in `apps/web/src` ever calls it —
  confirmed by grep and by this run's own request log, where the only two hits
  were the QA session's curls. Every user always receives `QUEUE_HARD_MAX` = 12,
  so the D30 5–12 band never adapts to anyone. Found by a `finding-refuter`
  while refuting the item above.
- **P2** — the Triage empty state tells the user something false about how to
  get more work: "New decisions appear after a sync finds another repeated
  sender pattern" (`empty-state.tsx:62`). The queue refills from rows that are
  already scored, with no sync involved. Currently unreachable on a large
  mailbox (the empty state never renders) but reachable on a small one.

**Held up under attack (what the probes would have caught):**

- D226 preview renders on the mouse path, the `A` keyboard path, and the
  zero-match case — where the confirm button is correctly **disabled**. A
  mutation without a preview could not be produced from the UI.
- Preview honesty: card said "336 RECEIVED", preview said "2 matching emails ·
  2 in your inbox · 334 elsewhere" (2+334=336), named both subjects, and
  `LabelActionWorker` reported `affectedCount: 2`. Gmail confirmed both messages
  lost and regained `INBOX`.
- Idempotency: same `Idempotency-Key` twice → same `actionId`, one job row.
  Undo twice → `reverted: true`, no double-revert. Bogus undo token → 404.
- Authorisation: a sender id from the other mailbox and a zero-uuid both →
  404 `SENDER_NOT_FOUND`, no leak.
- Interrupt: refresh mid-preview left `action_jobs` unchanged at 118 — no
  orphan enqueue.
- Mailbox switch: eyebrow, sidebar counts (627→12, 99+→1) and the whole queue
  re-scoped with no survivors — the scoped-cache invariant held.
- Console clean; the three 401s are the normal `auth/refresh` retry cycle.

**Not run, with reasons:** unsubscribe execution and the `U` key (Safety §, and
no kill switch exists yet); worker-kill, forced `reconnect_required` /
`sync_runs.status='failed'`, and a real 429 (belong to the `sync`,
`disconnect-reconnect` and rate-limit jobs — one job per run); two-tab
concurrency (not reached before the run's budget).

**Method note worth keeping.** Two of this run's own candidates died to the
refuters, both from the same error — comparing two sources that do not speak the
same vocabulary, then treating agreement across repeated reads as proof. The
category-label "finding" compared a DB row against a Gmail read whose tool
strips `CATEGORY_*`; the reorder cause treated "stable across 3 API calls" as
determinism when a non-total `ORDER BY` is stable only until the next write. A
check that cannot fail did not pass.

## Outstanding restores

**Check this section before starting any run, and clear it first.**

Every forced value gets its restoring statement written here _before_ the
mutation runs, not after. If a run is interrupted — the session dies, the
context fills, the founder stops it — this table is the only thing that knows
the database is dirty, and the next run would otherwise QA a database someone
else broke and file the damage as findings.

A row is deleted only when the restore has run **and** been verified by
re-query. Empty is the correct steady state.

| run | statement to restore | why it was forced | cleared |
| --- | -------------------- | ----------------- | ------- |

_Empty._

Cleared during the 2026-08-27 `triage` run: Gmail messages `19cb4856014df770`
and `19db0a9129e5e588` (sender `classicfirearms.com`) were archived and undone
twice as the D226 lifecycle test. Both were re-queried after the final undo and
match their pre-run label sets exactly — `{CATEGORY_PROMOTIONS, UNREAD,
IMPORTANT, INBOX}` and `{CATEGORY_PROMOTIONS, IMPORTANT, INBOX}`.

**What the restore could not cover.** The product's own undo restored `INBOX`
but not `CATEGORY_PROMOTIONS`; that label was put back by hand via the Gmail
API (which is itself the evidence for finding T-04 — the label is settable, so
undo could have restored it). Also permanent and deliberately not reverted:
three `action_jobs` rows plus their `activity_log` / `undo_journal` entries for
this sender, and re-scored `triage_decisions` rows for `Thomas Dixon | Red
State Legacy` and `Classic Firearms` (expanding a card rewrites its decision —
finding T-02). The worker was live throughout, so those are the record of what
the run actually did rather than residue to clean.

## Refuted

Candidates that did not survive a `finding-refuter` pass. Kept so they are not
re-found and re-argued next quarter.

| date       | job            | claim                                                                            | grounds | verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | -------------- | -------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 | observability  | Watch-renewal partial failure hides mailboxes losing push sync                   | 2, 3, 4 | REFUTED — documented failure-isolation contract pinned by a test; the drift sweep polls independently, so mail does not stop                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-27 | delete-account | One successful purge marks a failed deletion sweep as succeeded                  | 2, 4    | REFUTED — failures are non-terminal and retried on the next sweep; D232 scheduling untouched                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-27 | billing        | GCP row reports "budgets armed" without checking notifications                   | 3, 5    | PARTIALLY REFUTED — Google's default IAM recipients mean it IS armed; the surviving half (zero budgets grades WARN, WARN exits 0) is filed in `FINDINGS.md`                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-27 | triage         | Undo restores INBOX but not the Gmail category, so undone promos land in Primary | 3, 4    | REFUTED — instrument artifact. The "before" was a DB row and the "after" a Gmail read; the Gmail MCP `get_message` tool does not surface `CATEGORY_*` at all. Control: an untouched message reads `{CATEGORY_PROMOTIONS,UNREAD,IMPORTANT,INBOX}` in the DB and `["UNREAD","IMPORTANT","INBOX"]` from `get_message`. Archive is `remove INBOX` / undo is `add INBOX`; no code path touches a category label, and 910 messages archived 2026-06-06 kept theirs for three months                                                      |
| 2026-08-27 | triage         | Expanding a card silently re-scores it and rewrites the rationale mid-read       | 2       | REFUTED — this is D25 `stale_refresh`, founder decision 2026-08-19 option 1A, built to spec: fires only when `expires_at <= now`, once per sender per tab-session, off during onboarding. The "Scored a week ago" label in the evidence is the TTL gate firing correctly. Surviving objection recorded: 8,087 of 8,129 decisions are past TTL, so it fires on essentially every first expand — "designed", not "rare", is the defence                                                                                              |
| 2026-08-27 | triage         | Queue reorder is caused by re-scoring changing a sender's confidence             | 4       | PARTIALLY REFUTED — the reorder is real but the cause was wrong, and the corrected version is worse: the daily path's `ORDER BY` has no tiebreak at all. Filed in `FINDINGS.md` as the non-total-order defect                                                                                                                                                                                                                                                                                                                      |
| 2026-08-27 | triage         | "12 DECISIONS WAITING" hides a backlog of 8,036 eligible senders                 | 2, 3, 5 | PARTIALLY REFUTED — the 8,036 is the entire indexed sender population: only **147** are `unsubscribe`; 5,254 are `later`/insufficient-signal and 2,728 the engine's own `keep` (verified independently). Printing "8,036 waiting" would be the larger falsehood, and 147 clears at 12/day in ~12 days, inside D30's stated pacing. No rendered string asserts totality — the legend counts the twelve cards beneath it — and the population is one nav click away ("8,051 senders found"). Downgraded to a P3 copy gap, kept below |

## Out of scope

| surface                                   | why                                                                                                                                                                                                                | what would restore it                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unsubscribe execution (below the preview) | `UnsubExecutionWorker` performs a real RFC 8058 one-click POST from the founder's address. No dry-run, no kill switch, and stopping the worker only defers a queued send. The `U` keystroke is not pressed at all. | The dev-only send refusal specified in `FOUNDER-FOLLOWUPS.md` (2026-08-27). Then restore the `unsubscribe` job and the `U` keystroke. |
