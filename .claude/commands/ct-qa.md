---
description: Adversarial QA of one user job — drive it in the browser, try to break it, judge it as a stranger
argument-hint: "onboarding | undo | archive | delete | triage | mailbox-switch | billing | sync | … (bare /ct-qa lists all)"
---

Take **one user job**. Open the browser and do it the way a person would. Two
questions, nothing else:

1. **Can I break it?**
2. **Would this make sense to someone nobody explained it to?**

Only question 2 is asked nowhere else: no gate or test sees a screen that is
correct and incomprehensible.

## Argument

**Freeform, resolved, never rejected** (`archieve` → `archive`; "the sender
page" → `sender-detail`). State in ONE line which job and which screens, then
start. Never stop to ask. `/ct-qa status` prints the ledger and runs nothing.
**Bare `/ct-qa`** prints the menu below in order with each job's state
(`✔ last run <date>` from the ledger, `🐛 <n> open` from the worklist), then
starts the highest-priority job not yet done. Counts only: do not print or read
the open rows, or you have primed the run (§1).

## Safety — binds every job

**No run executes an unsubscribe, on any job, by any route, and `U` is never
pressed**: not the confirm control, the shortcut, a `POST` to the actions API
with that verb, or enqueueing / un-pausing the job by hand.

`UnsubExecutionWorker` sends a real RFC 8058 one-click `POST` to the sender,
with a per-send token, from the founder's address. It is irreversible; stopping
the worker only defers a queued send until a worker returns (this preflight
starts one). `U` is reachable from Triage, Senders, Sender detail, Brief and
Screener, so the rule binds every job: six earlier drafts scoped it to one job
while the break list said press `K/A/U/L/D`. **A safety rule scoped narrower
than its hazard is not one.**

**The kill switch does not authorise a press.** Sending needs
`UNSUB_SEND_ENABLED` exactly `true`, and the API refuses at enqueue before any
`action_jobs` row exists: real and fail-closed. A gate that lifted the ban
(2026-08-28) was withdrawn the same day; its "first press is safe" check passed
in four demonstrated cases where the app sends anyway:

1. `UNSUB_SEND_ENABLED="true"` (quoted) parses to `true` under
   `node --env-file`, while `grep -c '^UNSUB_SEND_ENABLED=true'` returns 0.
2. An exported shell variable beats `.env.local` saying `false`.
3. A worker booted while the flag was set keeps sending after the line goes.
4. "Press once, then confirm zero `action_jobs` rows" is circular: if 1–3 let
   a send through, the press already happened.

`ps eww` does not rescue it: config is injected by
`node --env-file-if-exists=../../.env.local` at boot, so its zero is vacuous.
Tested; do not re-propose. **Never set `UNSUB_SEND_ENABLED=true` in a QA run.**
Lifting the ban needs a mechanism (candidate: a dev-only target allowlist, open
in `FOUNDER-FOLLOWUPS.md`), not a firmer sentence.

So unsubscribe is **read, not driven**: the control is present, uses the
canonical verb and looks distinct from the safe ones; the sender row carries the
channel it claims; one-click is distinguished from `mailto:` (manual at launch,
CLAUDE.md §2.6). Its preview is checked in the Storybook story and the
component, never by trying to defeat it. Read an existing queued row; never
manufacture one. A probe that needs the verb does not run — the ledger says
`n/a — would fire a real unsubscribe`, **the one place an unexplored gap is the
right outcome.**

## The jobs, in QA order

Ranked by what a bug costs: lost mail › wrong money › can't start › a false
statement about their own data › friction.

- **Tier 0** — `onboarding` (no user exists if it fails; widest state machine:
  queued/syncing/ready/failed, scope=null, second account) · `undo` (**before
  the destructive verbs**: prove the net first) · `archive` (most-used; the §2.3
  lifecycle reference) · `delete` (the only verb that can lose real mail; 30-day
  Trash is the whole margin).
- **Tier 1** — `triage` · `mailbox-switch` (scoped-cache survivors have shipped
  green repeatedly) · `billing` (wrong money is P0) · `sync`.
- **Tier 2** — `senders` · `senders-filtering` · `sender-detail` (biggest
  numbers; "the number is right, the copy lies") · `activity` (the record of
  what the app did) · `protect` (the sole visible safety state) · then the
  unwatched automation: `screener` · `brief` · `autopilot` · `quiet`.
- **Tier 3** — `keep` · `later` · `followups` · `settings` · `export` ·
  `delete-account` · `connect-mailbox` · `disconnect-reconnect` · `sign-in` ·
  `marketing`. Final sweeps: `mobile`, `keyboard`.

## The read-only agents go out in ONE wave

`finding-refuter` (per candidate), `defect-class-sweeper` (per mechanism),
`usability-editor` (per screen set) and `flow-completeness-auditor` (lifecycle
jobs `onboarding`, `sync`, `mailbox-switch`: use its state table, do not
re-derive one) are dispatched **once, after the walk, in a single message**.
One at a time costs the same wall clock as no parallelism. None touches the
stack, DB or browser, so never interleave them with driving: the stack (one DB,
one mailbox, one worker, one `:4000`; Playwright pins `workers: 1`) is the
scarce resource. A candidate found at 10:00 is refuted after the walk, not at
10:01. Only vanishing evidence (screenshot, console line, an `action_jobs` row)
is captured in the moment.

## Preflight — each line has voided a past run

```bash
git branch --show-current                    # a closed PR silently moves you to main
lsof -p $(lsof -ti:4000) | awk '$4=="cwd"'   # is :4000 running THIS checkout?
./scripts/assert-dev-db.sh                   # informational only — see below
uptime                                       # before any "it felt slow"
grep DEV_AUTH .env.local                     # DEV_AUTH_ENABLED=true
./scripts/dev-up.sh --stop && ./scripts/dev-up.sh   # sweeps orphan workers
curl -s -c /tmp/dm.jar "http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com" -o /dev/null
CSRF=$(awk '/dm_csrf/{print $7}' /tmp/dm.jar)
# mutations: -b /tmp/dm.jar -H "x-csrf-token: $CSRF" -H "Idempotency-Key: $(uuidgen)"
# NEVER with the unsubscribe verb — the API is an execution route too
```

**Preflight fails → the run stops.** QA on the wrong checkout is worse than
none. **Step 0:** clear Outstanding restores in `docs/qa/launch-qa.md` (empty is
normal; a row means a run died with the DB dirty). Per row: run it via
`--exec`, re-query to prove the value is back, then delete the row. **A failed
or unclear restore stops the run and goes to the founder**: findings on a dirty
DB are someone else's damage under your name.

### Database rules

- **Every statement goes through `./scripts/assert-dev-db.sh --exec "…"`**,
  reads included; never `psql "$DATABASE_URL"`. `assert-dev-db.sh && psql …`
  resolves the target twice (with `DATABASE_URL` unset the guard checks
  `.env.local` while `psql ""` hits libpq defaults) and has reached another DB
  with the guard printing OK. `--exec` resolves once, asserts identity in the
  same session, and refuses backslash metacommands (`\c` reconnects after the
  check). One-time: `--record` if `.dev-db-identity` is missing.
- **Pin ids before forcing state.** `SELECT id, <column>` for the predicate;
  write the restore into Outstanding restores **by those literal ids, per-row
  values**, and save it *before* mutating (an interrupted run leaves only that
  line knowing the DB is dirty); mutate by the same ids, never the predicate;
  the row count must equal the pinned count, or stop. Never a broad `WHERE`.
  Say in the run that you pinned and the counts matched.
- **Probe rows** carry a marker (`ZZ-QA-PROBE-…`) so the restore is a DELETE
  that cannot over-match; re-query for zero remaining.
- **A restore proves the column, not the blast radius**: triggers, `updated_at`,
  outbox rows and worker side effects survive it. Record what it could not
  cover; stopping the worker before forcing keeps that empty.
- Never leave the founder trapped; never touch the Paddle sandbox sub rows.

## 1 — The browser is the instrument, not the evidence

Mouse and keyboard. **Reading source, specs or ADRs before a symptom is
forbidden** — you would QA the spec, not the product. Source explains only what
you already watched go wrong. Browser pane by default (it emulates viewport).
Harness artifacts, never bugs: `window.innerWidth` reads **0** and fakes a
crushed layout (**prove layout with screenshots, never
`getBoundingClientRect`**); polling pauses in an unfocused tab (check
`action_jobs`, reload); local hydration is far faster than prod (never call
perf fine locally).

## 2 — You may not explain the screen to yourself

If a number, label or state needed a file to understand, **that is a finding**:
write what a person would have concluded. Not one if the same flow taught it
earlier and they would plausibly remember.

## 3 — Four personas, every run

- **First-timer** (connected five minutes ago): does it explain itself; is the
  destructive thing obviously destructive; what happens next?
- **Scared user** (sure it will eat mail): can they see exactly what will happen
  and get it back; is undo findable *before* they need it?
- **Heavy user** (5,000 senders, 40k messages, both mailboxes): fast, honest,
  usable; do counts still mean what they say?
- **The editor**, **last**: capture screen text and screenshots, then
  `usability-editor` in the wave. The only persona that can be delegated.

## 4 — Try to break it

**Empty · one · enormous** (new mailbox, one row, biggest sender) · **Twice**
(double-click, re-send an `Idempotency-Key`, undo twice) · **Interrupt**
(refresh, Back, close mid-action) · **Two tabs** (same action from both; act in
one, undo in the other) · **Switch mailboxes mid-flow** (look for survivors) ·
**Take the floor away** (kill the worker mid-job; force
`mailbox_accounts.status` to `reconnect_required` / `disconnected` and
`sync_runs.status='failed'` via `--exec`; expire the session; a real 429 with
`RATE_LIMIT_ENABLED=true`) · **Reach past your data** (the other mailbox's id) ·
**Skip the preview** (§2.3; Archive, Later and Delete **only**) · **375px**,
then keyboard only: **K / A / L / D**.

None of these runs on unsubscribe. **Genuinely blocked** steps (real token
revoke, real OAuth connect) are said plainly and left undone, never simulated.

## 5 — Prove what you saw

A toast or a 200 is not proof. Use `--exec "SELECT …"` on `action_jobs`,
`undo_journal`, `activity_log`, `sync_runs`, `dead_letter_jobs`; the **Gmail
MCP** (`get_message`, `search_threads`, `list_labels`), the only proof a label
moved (not authorized? say so); `.local-logs/{api,worker,web}.log`
(`worker.succeeded` / `worker.failed`); a clean console. When nothing broke, say
**what the probe would have caught**: a check that cannot fail asked nothing.

## 6 — Every bug gets a sibling sweep

Name the **mechanism**; one `defect-class-sweeper` each, in the wave. Record
instances, do not fix them; hand the class to `/ct-class`. The sweeper must
rediscover the known instance before its silence counts. It has no shell or DB,
so run the SQL it returns for **unmeasured** instances via `--exec` and give it
the numbers (trust 8 → 10).

## 7 — What survived

**Nothing is filed unrefuted**: one `finding-refuter` per candidate, in the
wave, told to disprove it and default to REFUTED. Refuted ones get a one-line
ledger note. Survivors carry the refuter's strongest surviving objection. The
closing summary opens with (zero inherited is still stated):

```
New: <n>   Inherited and still open: <n>   Refuted or downgraded: <n>
QA-<job>-<YYYYMMDD>-01 · P1 · <one line> · <the refuter's strongest surviving objection>
```

Every survivor, every severity, gets a row in `docs/qa/qa-worklist.md`, the only
place tracking *fix* state. P0/P1 also go to the `FINDINGS.md` **Inbox**, in its
shape, for `/ct-finding triage`. The ledger records the run and never changes.
Run record, open question, work item: not duplicates.

**An id carries the date of the run that FIRST filed it**
(`QA-triage-20260827-01`), for life. A bare `QA-triage-01` collides with the
next run and re-points every PR, sweep and refutation citing it; re-dating an
inherited row does the same, slower.

**A repeat run reconciles at filing time, never at preflight** — the old list is
the strongest prime there is. Walk cold, refute, then for each of this job's
rows: still reproduces → keep the id, append `· re-confirmed <date>`; gone →
`Fixed <date>` if a PR is attributable, else `Gone <date>`, saying what you ran;
reproduces differently or refuted → `Refuted <date>` with the ledger grounds.
Rows are never deleted. Closing a row needs no founder; moving one toward a fix
does. Only a genuinely new survivor gets a new id.

**Severity:** **P0** mail lost with no way back, wrong money, or a false
statement about the user's own data · **P1** cannot finish, or finishes
believing something untrue · **P2** friction, ugly, slow · **P3** an idea that
needs evidence first.

```
P0|P1|P2|P3 · <job> · <one line a non-engineer understands>
Steps · Expected · Actual · Evidence (screenshot / SQL / Gmail / log)
Cause (path:line — only if actually traced)
Siblings: <same mechanism, other jobs>
Regression test: file, tier, and what the assertion must say to go RED today
```

## 8 — Fixing: approved, surgical, adversarially reviewed

**Ask per item**: a numbered list, a recommended order, one line of cost and
risk each. No answer → everything stays `Open`, a complete outcome; fix and hand
off nothing. **Tier 1** items (billing, OAuth scopes, token crypto, webhook auth,
prod migrations, deletion, privacy) are named as such and never bundled into a
"fix all". A refuted candidate is never offered.

**You write the fix**, only after the walk is done and survivors filed: editing
mid-walk blinds every persona after it.

- **Minimum surgical diff** (§1.2/§1.3): every line traces to an approved id.
  No adjacent cleanup; an unapproved P3 is an unreviewed change on a reviewed
  PR. Tier 1 stays hands-off unless that item was approved; §9 still applies.
- **Negative control per assertion**: revert, see RED, restore, say so (§8).
- **One PR per surface, not per finding**; each PR pays the full definition of
  done (#657–#660 spent four rounds on one sentence).
- **Never edit the finding to match the fix**; if it was wrong, `Refuted`.

**Codex attacks the diff before merge is proposed** (`codex:rescue` or
`codex:adversarial-review`), never waived for a small diff: a session that
argued itself into a finding grades its own fix generously. Send the diff, not a
brief (briefs were lossy twice: 111 lines compressed to 28; an uncommitted brief
missing from the worktree). Point at the branch, do not paste the diff, and give
only: the ids it closes with symptom and acceptance criterion; what you
deliberately did **not** change and why; the refuter's strongest objection to
each; a request for failure modes (what breaks it, what the negative control
missed), not a verdict.

**Act on what comes back**; where you disagree, say why in the PR body. Record
`Review passed` or `Review found <n>` and what you did on the row.

- A **substantive** response (logic, control flow, wire shape, rendered string,
  a test's assertion) invalidates the review and gets its own round.
  Mechanical ones (formatter, comments, behaviour-free rename, a rebase with
  identical resolved hunks) are noted on the row.
- A **CLEAN** round (nothing to act on) ends the loop; cite its commit. **Two
  substantive rounds is the cap**; a third goes to the founder with what each
  found. Once only: zero findings on a multi-file or wire-shape diff earns one
  targeted deeper pass; clean again → believe it.
- Merging is not substantive (squash, clean rebase); a hand-resolved rebase is.
- "The fix is wrong", not incomplete → row back to `Approved`, rewrite; never
  "done with caveats".

## Done — every box

- [ ] Four personas walked, editor last; read-only agents sent as ONE wave
- [ ] Break list exhausted, or each skip named with its reason
- [ ] Every finding has re-checkable evidence, survived a refuter, got a sweep
- [ ] Every forced value restored, re-queried, its Outstanding row deleted
- [ ] Worklist opened only after the walk; this job's rows reconciled first,
      no id re-dated; survivors counted new / inherited / refuted, each filed
- [ ] Approval asked per item; nothing unapproved touched; fixes after the walk
- [ ] Negative control per assertion; Codex review acted on and recorded; a
      CLEAN round on the final diff, or the cap hit and the founder told

## Output

- **Ledger** `docs/qa/launch-qa.md` (exists; append-only, one row per run; new
  and inherited kept apart so the yield is fixed):
  `| job | date | personas | broke it? | findings (new / inherited) | notes |`
- **Worklist** `docs/qa/qa-worklist.md` (exists). Its States table alone defines
  row states and who sets them.
- **Screenshots** to the scratchpad, sent inline, never committed.
- **Closing summary** in product terms, no paths: what a user would hit, how
  bad, what proved it; survivors block first, approval ask last; what the
  refuters killed and why.

## Boundaries

Mutations on the dev stack only; prod reads are fine. No laptop migrations,
cloud-resource deletion or credential rotation. One job per run. Changes only
for an approved id, Codex-reviewed: a run approving its own fix has no adversary.
