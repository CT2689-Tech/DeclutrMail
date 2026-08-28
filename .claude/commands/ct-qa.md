---
description: Adversarial QA of one user job — drive it in the browser, try to break it, judge it as a stranger
argument-hint: "onboarding | undo | archive | delete | triage | mailbox-switch | billing | sync | … (bare /ct-qa lists all)"
---

Take **one user job**. Open the browser. Actually do it, the way a person
would. Two questions, and nothing else:

1. **Can I break it?**
2. **Would this make sense to someone nobody explained it to?**

Question 2 is the one nothing else in this repo asks. Five must-pass gate
agents, 5,346 tests and a maximally-strict tsconfig cannot see a screen that
is correct and incomprehensible.

## Argument

**Freeform, resolved, never rejected.** `archieve` → `archive`; "the sender
page" → `sender-detail`. State in ONE line which job you took and which
screens that spans, then start. Never stop to ask.

- `/ct-qa <job>` — that job.
- `/ct-qa status` — print the ledger, run nothing.
- **Bare `/ct-qa`** — print the menu below in priority order, annotated with
  each job's state — `✔ last run <date>` from the ledger, `🐛 <n> open` from the
  worklist — then start the highest-priority job not yet done. Counts only: do
  not print the open rows themselves, and do not read them, or you have primed
  the run you are about to start (§1).

## Safety — read before the job list

**No run executes an unsubscribe, on any job, by any route — and `U` is never
pressed.** Not the confirm control, not the shortcut, not a `POST` to the
actions API with that verb, not enqueueing or un-pausing the job by hand. The
kill switch below is real but does not authorise a press; why not is stated
under it, with each hole demonstrated.

`UnsubExecutionWorker` performs a real RFC 8058 one-click `POST` to the
sender's URL, carrying a per-send token, from the founder's address. It is
irreversible, and stopping the worker does not prevent a queued send — it
defers it until a worker returns, and this command's own preflight starts one.

This block sits above the job list because the hazard is not confined to one
job. `U` is reachable from Triage, Senders, Sender detail, Brief and Screener.
Six earlier drafts put the rule in a section scoped to the unsubscribe job
while the break list told every run to press `K/A/U/L/D`. **A safety rule
scoped narrower than its hazard is not a safety rule.**

### `U` is not pressed — the gate was tried and it does not hold

A kill switch now exists: sending requires `UNSUB_SEND_ENABLED` to be exactly
`true`, read explicitly, and the API refuses at the ENQUEUE boundary before any
`action_jobs` row is written. That mechanism is real and it is fail-closed.

**It is still not enough to authorise a press.** A gate was written on
2026-08-28 that lifted the ban behind two checks. It was withdrawn the same day,
because the check meant to make the FIRST press safe passes in four situations
where the running app sends anyway. Each was demonstrated, not reasoned about:

1. **A quoted value defeats the grep.** `UNSUB_SEND_ENABLED="true"` in
   `.env.local` is parsed by `node --env-file` to the string `true`, so
   `unsubSendsEnabled()` returns true and the app sends — while
   `grep -c '^UNSUB_SEND_ENABLED=true'` returns **0** and the gate passes.
2. **An exported shell variable beats the file entirely.** `.env.local` may say
   `false` while the launching shell exported `true`; the process env wins and
   the file check never sees it.
3. **A stale process carries the old value.** A worker booted while the flag was
   set keeps sending after the line is deleted from the file.
4. **The ordering was circular.** The second check — press once, then confirm
   zero `action_jobs` rows — cannot make the first press safe, because if the
   first three holes let a send through, the press already happened. A probe
   whose failure mode is the hazard it screens for is not a probe.

**Reading the live process environment does not rescue it.** `ps eww` shows only
the exec-time environment; this app injects config via
`node --env-file-if-exists=../../.env.local` at boot, so `DATABASE_URL` and every
other runtime variable are invisible to it. A zero from `ps eww` is vacuous.
Tested — do not re-propose it.

So the surface is reviewed by **reading, not driving**: is the control present,
labelled with the canonical verb, visually distinct from the safe ones; does the
sender row carry the channel it claims; is one-click distinguished from
`mailto:`, which is manual at launch (D230). Whether the preview renders for `U`
is checked in the Storybook story and the component. Record it as read-not-driven.

**Never set `UNSUB_SEND_ENABLED=true` during a QA run, for any reason.**

Lifting this needs a mechanism, not a firmer sentence — the same conclusion six
earlier drafts reached. The open question is with the founder in
`FOUNDER-FOLLOWUPS.md`: the candidate is a dev-only target allowlist, so a press
cannot reach a real sender's host even when every flag is wrong.

## The jobs, in the order they should be QA'd

Ranked by **what a bug here costs the user**: lost mail › wrong money ›
can't start at all › a false statement about their own data › friction.

**Tier 0 — nothing else matters if these are broken**

1. `onboarding` — no user exists if this fails, and it is the widest state
   machine in the product (queued/syncing/ready/failed, scope=null, second
   account) with zero prior usage to lean on.
2. `undo` — **deliberately before the destructive verbs.** Undo is the safety
   net the whole promise rests on; testing destruction first is testing it
   without a proven net.
3. `archive` — most-used destructive verb and the D226 lifecycle reference
   implementation. A break here is a break in the pattern every verb copies.
4. `delete` — highest damage. The only verb where a bug loses real mail; the
   30-day Trash window is the entire margin.

**Tier 1 — the loop and the money**

6. `triage` · 7. `mailbox-switch` (this repo's most reliably-broken thing —
scoped-cache survivors have shipped green more than once) · 8. `billing`
(first paying customer; wrong money is P0 by definition) · 9. `sync`.

**Tier 2 — the surfaces carrying claims and counts**

`senders` · `senders-filtering` · `sender-detail` (the biggest numbers surface,
and where "the number is right, the copy lies" actually lives) · `activity`
(the record of what the app did to your mail — if it lies, trust is gone) ·
`protect` (the sole visible safety state; if Protected fails to exclude from
bulk, the safety promise is fiction) · then the automation that acts while
nobody is watching: `screener` · `brief` · `autopilot` · `quiet`.

**Tier 3** — `keep` · `later` · `followups` · `settings` · `export` ·
`delete-account` · `connect-mailbox` · `disconnect-reconnect` · `sign-in` ·
`marketing`.

**Final sweeps** — `mobile` and `keyboard` are inside every run's break list
already; standalone they are a last pass across everything.

## Preflight — six lines, each has voided a past run

```bash
git branch --show-current                    # a closed PR silently moves you to main
lsof -p $(lsof -ti:4000) | awk '$4=="cwd"'   # is :4000 running THIS checkout?
./scripts/assert-dev-db.sh                   # informational only — see below
uptime                                       # before any "it felt slow"
grep DEV_AUTH .env.local                     # DEV_AUTH_ENABLED=true
./scripts/dev-up.sh --stop && ./scripts/dev-up.sh   # sweeps orphan workers
```

Then sign in, keeping the session for API proofs:

```bash
curl -s -c /tmp/dm.jar "http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com" -o /dev/null
CSRF=$(awk '/dm_csrf/{print $7}' /tmp/dm.jar)
# mutations: -b /tmp/dm.jar -H "x-csrf-token: $CSRF" -H "Idempotency-Key: $(uuidgen)"
# NEVER with the unsubscribe verb — the API is an execution route too (rule 7)
```

**Preflight fails → the run stops.** QA against the wrong checkout is worse
than no QA.

### Step 0 — clear Outstanding restores before anything else

Open `docs/qa/launch-qa.md` and read **Outstanding restores**. Empty is the
normal case; a row means an earlier run died between forcing a value and
putting it back, and the database is still dirty.

For each row, in order:

1. Run its statement through `./scripts/assert-dev-db.sh --exec`.
2. Re-query to prove the value is back. A restore you did not verify is not a
   restore.
3. Only then delete the row.

**If a restore fails, or its statement is unclear, stop the run and tell the
founder.** Do not QA on top of it: findings gathered against a dirty database
are someone else's damage wearing your run's name, and you will file them as
product bugs.

### Forcing state — pin the ids first

Writing to that table is not bookkeeping you do at the end, and "write the
restore, then mutate" is not sufficient on its own: a restore written before
the mutation is a guess about what the mutation will touch. If the `WHERE`
matches five rows and the restore names one, the ledger holds a restore that is
wrong, and it looks right.

Pin the set instead, so before and after are identical by construction — the
same reason `action_jobs.resolved_message_ids` is captured *before* the Gmail
call rather than re-resolved after:

1. `SELECT id, <column> …` for the predicate. Read the **exact ids and their
   current values**.
2. Write the restore into Outstanding restores keyed by **those literal ids**,
   with the per-row values. Save the file.
3. Mutate **by those same literal ids** — never by the original predicate,
   which may match differently a second later.
4. Confirm the mutation's row count equals the number of ids you pinned. If it
   does not, stop: something moved underneath you and the restore no longer
   describes reality.

Never force state with a broad `WHERE`. Say in the run that you pinned ids and
that the counts matched.

### Touching the database — `--exec`, always

**Never `psql "$DATABASE_URL"`.** Not for writes, and not for reads either.
Every statement goes through the guard:

```bash
./scripts/assert-dev-db.sh --exec "UPDATE mailbox_accounts SET status='disconnected' WHERE id='…'"
./scripts/assert-dev-db.sh --exec "SELECT status, undo_token FROM action_jobs ORDER BY created_at DESC LIMIT 5"
```

The bare check is **informational**: it proves the destination at that instant
for the URL it resolved itself, and cannot vouch for a separate `psql`
invocation. `assert-dev-db.sh && psql "$DATABASE_URL" -c '…'` is the exact
unsafe pattern — the two halves resolve their target independently, so with
`DATABASE_URL` unset the guard validates `.env.local`'s cluster while `psql ""`
connects to libpq defaults. That has already been demonstrated reaching a
different database with the guard printing OK.

`--exec` closes it by construction: one resolution of the URL, and the identity
assertion runs in the same session as the statement. Backslash metacommands are
refused (`\c` can reconnect *after* the assertion passes). Reads go through it
too — a read-back that silently returns nothing pushes the next person to an
unguarded `psql`, which reopens the hole.

One-time, if `.dev-db-identity` is missing: `./scripts/assert-dev-db.sh --record`.

---

## 1 — The browser is the instrument, not the evidence

Do the job. Mouse and keyboard, the way a person would.

**Reading the source before a symptom appears is forbidden** — that is how you
talk yourself into believing a screen works. Source gets opened only to explain
something you already watched go wrong. Same ban on the spec: read the
D-decisions first and you QA the spec instead of the product.

Browser pane (preview MCP) by default — it can emulate viewport, real Chrome
cannot. Three harness artifacts that must never be filed as bugs:

- `window.innerWidth` reads **0** in the pane, collapsing every `1fr` track
  into the exact signature of a real crushed-layout bug. **Prove layout with
  screenshots, never `getBoundingClientRect`.**
- Polling pauses in an unfocused automation tab, so anything can look stuck
  busy. Check `action_jobs` and reload before believing it.
- Local hydration is much faster than production. Never declare hydration or
  perf fine from a local pass alone.

## 2 — You may not explain the screen to yourself

If understanding what a number, label, or state means required opening a file,
**that is a finding**. Write down what a person would have concluded instead.

Not a finding if the app taught them earlier in the same flow and they would
plausibly remember. A finding if the only teacher was the source code.

## 3 — Four personas, every run

The first three *use* it. The fourth *judges* it.

- **First-timer** — connected Gmail five minutes ago, read nothing. Does the
  screen explain itself? Is the destructive thing obviously destructive? Do
  they know what happens next?
- **Scared user** — convinced the app will eat real mail. Can they see exactly
  what is about to happen, and get it back? Is undo findable *before* they
  need it?
- **Heavy user** — 5,000 senders, 40k messages, both mailboxes. Does it stay
  fast, honest and usable? Do the counts still mean what they say?
- **The editor** — runs **last**, because you cannot judge whether the language
  matched the experience until you have had the experience. Capture the screen
  text and screenshots, then dispatch **`usability-editor`** — one per screen
  set, in parallel, nothing mutates. It is the only persona that can be
  delegated; the other three depend on the founder seeing what happened.

## 4 — Try to break it

- **Empty · one · enormous.** New mailbox; a single row; the biggest sender.
- **Twice.** Double-click. Re-send the same `Idempotency-Key`. Undo twice.
  Never on unsubscribe — see rule 7; every one of these is a send.
- **Interrupt.** Refresh mid-flow. Back button. Close the tab mid-action.
- **Two tabs.** Same action from both. Action in one, undo in the other.
- **Switch mailboxes mid-flow.** Look for survivors from the old one.
- **Take the floor away.** Kill the worker mid-job. Force
  `mailbox_accounts.status` to `reconnect_required` / `disconnected`, and
  `sync_runs.status='failed'` — each via `assert-dev-db.sh --exec`, never a
  bare `psql`. Expire the session. Reach a real 429 with
  `RATE_LIMIT_ENABLED=true`.
- **Reach past your own data.** An id belonging to the other mailbox.
- **Skip the preview.** Every destructive verb must render one (D226). Try to
  get a mutation without it — on Archive, Later and Delete **only**. Running
  this on unsubscribe is an attempt to execute one without a preview, which is
  the send itself. Confirm D226 holds for unsubscribe by reading whether the
  preview renders, never by trying to defeat it.
- **375px**, then keyboard only: **K / A / L / D**. `U` is not pressed — see
  Safety, above.

On lifecycle jobs (`onboarding`, `sync`, `mailbox-switch`) call
**`flow-completeness-auditor`** for the state table rather than re-deriving one.

**Restore contract.** Write the restoring statement BEFORE you run the
mutation, and paste it into the ledger row at that moment — not after. If the
run is interrupted, that line is the only thing that knows the database is
dirty.

- Forcing an existing row: capture the pre-value **per row** (`SELECT id, status
  …` for the exact predicate), not one value for a set.
- Inserting a probe row: tag it with an unmistakable marker (`ZZ-QA-PROBE-…`)
  so the restore is a DELETE that cannot over-match, and re-query for **zero**
  remaining.
- Re-querying the column you restored proves you set the column. It does not
  prove the blast radius: triggers, `updated_at` bumps, outbox rows, and
  anything a worker did while it read the forced state all survive it. Say in
  the ledger what the restore could not cover — stopping the worker before
  forcing is usually how you keep that list empty.

Never leave the founder in a trapped state. Never seed or delete the real
Paddle sandbox subscription rows — they are live sandbox records.

**Genuinely blocked** (real Google token-revoke, real OAuth connect) is said
plainly and left undone. Never simulated and reported as covered.

## 5 — Prove what you saw

A toast is not proof. A 200 is not proof.

- `./scripts/assert-dev-db.sh --exec "SELECT …"` — `action_jobs`,
  `undo_journal`, `activity_log`, `sync_runs`, `dead_letter_jobs`. Guarded,
  including for reads.
- **Gmail MCP** (`get_message`, `search_threads`, `list_labels`) — the only
  thing that proves a label really moved. Not authorized? Say so; never
  quietly skip it.
- `.local-logs/{api,worker,web}.log` — `worker.succeeded` / `worker.failed`.
- Console must be clean.

When nothing broke, say **what the probe would have caught**. A check that
cannot fail did not pass — it asked nothing.

## 6 — Every bug gets a sibling sweep

Name the **mechanism** and dispatch **`defect-class-sweeper`** — one per
mechanism, in parallel. Record the instances; do not fix them here. Hand the
class to `/ct-class` for the fix.

The sweeper must prove its query rediscovers the known instance before its
silence means anything.

It has no shell and no database by design, so it will hand back instances
marked **unmeasured** with the exact SQL it needed. Run those through
`assert-dev-db.sh --exec` and give it the numbers — that is what moves an
instance from trust 8 to trust 10.

## 7 — Unsubscribe

See **Safety**, above the job list. It is stated once, before the jobs, because
it binds every job — not only the one that was named after it.

Unsubscribe is read-not-driven, on every job. `U` is not pressed and the verb is
not exercised by any route; the reasons are under Safety, with each one
demonstrated rather than argued. Whether the preview renders is checked in the
Storybook story and the component, never by trying to defeat it.

To see the shape of a queued unsubscribe row, read an existing one — do not
manufacture one. A probe that would require executing the verb does not run:
`n/a — would fire a real unsubscribe` goes in the ledger. **This is the one
place in this document where an unexplored gap is the right outcome.**

## 8 — What survived, and who fixes it

A run's product is not the findings you had. It is **the ones still standing
after the refuters**. Say so explicitly, in one block, before anything else in
the closing summary:

```
New: <n>   Inherited and still open: <n>   Refuted or downgraded: <n>
QA-<job>-<YYYYMMDD>-01 · P1 · <one line> · <the refuter's strongest surviving objection>
QA-<job>-<YYYYMMDD>-02 · P2 · …
```

On a job's first run the inherited count is zero and the block still states it —
a reader should never have to infer whether a run checked.

Every survivor has an id and a row in the **QA worklist**,
`docs/qa/qa-worklist.md` — a new id if this run found it, its existing one if
this run inherited it. That file is the only place that tracks a finding's
*fix* state; the ledger records what happened in a run and never changes, and
`FINDINGS.md` holds the P0/P1 subset as open product questions. So a P0/P1 sits
in all three and a P2/P3 in two, and none of those are duplicates — run record,
open question, work item.

**The id carries the date of the run that FIRST filed it**
(`QA-triage-20260827-01`) — never the run that last touched it. A job is QA'd
more than once and the ledger keeps every run, so a bare `QA-triage-01` collides
with the next triage run and silently re-points every PR, sweep and refutation
that cited it. Re-dating an inherited row does the same damage more slowly, so
an inherited row keeps its original id for life.

### A repeat run inherits before it files — but after it walks

**Read the worklist at filing time, not at preflight.** "Inherits first" means
first in the *filing* step, never first in the run. §1 and §2 forbid priming
yourself before the walk, and a list of fifteen findings someone already wrote
is the strongest prime there is — read it beforehand and you will spend the run
confirming it, notice only what is on it, and call the screen fine everywhere
else. Walk the job cold, gather candidates, refute them, and only then open the
worklist to reconcile.

The second run of a job does NOT start from an empty page. Before filing
anything, read that job's existing worklist rows and settle each one, because a
row still `Open` from last time is the same defect — re-filing it under a fresh
id fakes a discovery and doubles the backlog:

- still reproduces → leave the row and its id, append `· re-confirmed <date>`;
- no longer reproduces → `Fixed <date>` if a PR is attributable to it, `Gone
  <date>` if not, and say what you ran to check either way. A fix you did not
  verify is not a fix, whoever wrote it, and "it stopped happening and nobody
  knows why" is a different fact worth keeping separate;
- reproduces differently, or new evidence refutes it → `Refuted <date>` on the
  row, pointing at the ledger entry with the grounds. The row stays; rows are
  never deleted.

Closing a row this way does **not** need the founder — recording that work is
unnecessary is not doing work. Moving a row toward a fix does.

Only a genuinely new survivor gets a new id. Say in the closing summary how many
were inherited versus new — a run that reports twelve findings when nine were
already on the list is inflating its own yield.

### You fix it. Codex reviews it adversarially.

The run finds, the founder approves, **you write the fix**, and then **Codex
attacks it**. The independent check does not disappear — it moves from writing
the fix to reviewing it, which is the stronger place for it. A reviewer reading
real code can see what a brief cannot describe: what you actually changed, what
you did not, and what you broke on the way past.

This replaces an earlier arrangement where Codex wrote the fix from a written
brief. That failed twice for the same reason — the brief is a lossy channel. The
runtime silently compressed a 111-line handoff to 28 lines, and an uncommitted
brief did not exist inside the worktree at all. Reviewing a diff has no such
channel: the diff **is** the artifact.

What does not change is the reason the check exists. A session that has spent an
hour arguing itself into a finding is the worst-placed reader to decide whether
its own fix is right, and it will grade its own homework generously every time.
So the review is not optional, not advisory, and not something you may waive
because the diff is small.

**The review runs before the PR is proposed for merge, and it must actually
pass.** A run that fixes and self-approves has removed the only adversary in the
loop.

### Fixing, without becoming the thing you were measuring

The QA walk and the fix are separate acts. Finish the walk, file the survivors,
get approval — **then** touch code. Never fix mid-walk: the moment you start
editing you stop being able to see the screen as a stranger, and every remaining
persona is compromised.

Rules for the fix itself:

- **Minimum surgical diff** (CLAUDE.md §1.2/§1.3). Every changed line traces to
  an approved worklist id. No adjacent cleanups, no refactors, no "while I'm
  here" — a QA fix is the highest-temptation moment in this repo for scope creep,
  because you have just spent an hour cataloguing everything that is wrong.
- **Negative control, per assertion.** Revert the fix, watch the new test go RED,
  restore it. A test that never failed against the old code proves nothing, and
  this repo has shipped three of them (CLAUDE.md §8).
- **Fix only what was approved.** A P3 you did not get approval for is not a
  freebie; it is an unreviewed change riding a reviewed PR.
- **Tier 1 stays hands-off** unless the founder approved that specific item, and
  the §9 stop conditions still apply — billing, OAuth scopes, token crypto,
  webhook auth, prod migrations, deletion, privacy.
- **Do not edit the finding to match the fix.** If the fix reveals the finding
  was wrong, say so and move the row to `Refuted`. Rewriting the symptom so your
  diff looks correct is the worst available outcome.

### Ask the founder, per item

When the survivors are recorded, ask — do not assume, and do not batch a Tier 1
item in with the rest. Present the numbered list and ask which to hand off.
Recommend an order, and say what each fix costs and risks in one line.

- **No answer, or the founder is away** → every item stays `Open` in the
  worklist. That is a complete, correct outcome. Do not fix, and do not hand
  off anything to warm the queue.
- **Tier 1 items** (§2 of CLAUDE.md — billing, OAuth scopes, token crypto,
  webhook auth, prod migrations, deletion, privacy) are named as Tier 1 in the
  ask and never bundled into a "fix all of these" approval.
- **A refuted candidate is never offered.** It lost. Offering it anyway
  launders an argument the run already failed.

### Send the diff to Codex for adversarial review

When the fix is written and green, hand the **diff** — not a brief — to Codex
via the `codex:rescue` skill or `codex:adversarial-review`. Tell it to attack the
change, not to admire it. It has the repo, so it needs from you only:

- the approved worklist ids this diff claims to close;
- for each, the symptom in one line and the acceptance criterion;
- what you deliberately did **not** change, and why — otherwise a reviewer
  reports your restraint as an omission;
- the refuter's strongest surviving objection to each finding, because a fix
  that does not survive it is fixing the wrong thing;
- that you want the failure modes named, not a verdict: what input breaks this,
  what did the negative control not cover, what did the diff miss.

Keep the message short and point at the branch. The diff is already in the repo;
do not paste it, and do not restate the finding at length — that is what put a
111-line brief through a 28-line hole last time.

**Then act on what comes back.** A review that finds something and changes
nothing is theatre. Fix what it lands, and where you disagree, say why in the PR
body rather than silently declining — the disagreement is part of the record.
Record the outcome on the worklist row: `Review passed`, or `Review found <n>`
with what you did about each.

**A SUBSTANTIVE response to a review invalidates it.** The code written in
response is the least-scrutinised part of the change — authored under time
pressure, by the author, after the reviewer stopped looking — so it gets its own
round. Substantive means it changes behaviour: logic, control flow, a wire
shape, a rendered string, a test's assertion.

Mechanical changes do not: a formatter or lint autofix, a comment or docstring,
a local rename with no behaviour change, a rebase whose conflict resolution
leaves the resolved hunks identical. Note them on the row and move on. Requiring
a fresh round for a prettier pass is how a review gate becomes a ritual nobody
finishes.

**It terminates, and here is exactly how.** A round is CLEAN when it returns
nothing you had to act on. A clean round ends the loop — a pass is a pass, and
treating every pass as presumptively shallow removes the only exit the process
has. Cite that commit on the worklist row.

Two substantive rounds is the cap. If a third would be needed, stop and take it
to the founder with what each round found: at that point the diff is either
bigger than one change should be, or the finding underneath it is wrong, and
another lap will not tell you which.

One calibration, used once and not as a standing objection: if round one returns
zero findings on a diff that touches several files or a wire shape, ask for one
targeted deeper pass naming the riskiest area. If that also comes back clean,
believe it.

**Merging is not a substantive change.** The review attaches to a commit, not to
whatever git produces at merge time. A squash, or a rebase onto a moved `main`
that resolves cleanly, does not invalidate it — otherwise nothing could ever be
merged, since the merged artifact is never byte-identical to the reviewed one.
A rebase you had to resolve by hand is substantive; say so and take the round.

If the review says the fix is wrong rather than incomplete, the row goes back to
`Approved` and the diff is rewritten. It does not go to the founder as "done
with caveats".

## Done means done — thirteen boxes, not vibes

- [ ] All four personas walked, the editor last (as `usability-editor`)
- [ ] Break list exhausted, or each skip named with its reason
- [ ] Every finding carries evidence a stranger could re-check
- [ ] Every finding survived a `finding-refuter`
- [ ] Every forced value restored, verified by re-query, and its Outstanding
      restores row deleted
- [ ] Every bug given its `defect-class-sweeper` pass
- [ ] Worklist opened only AFTER the walk (never at preflight — it primes),
      then that job's existing rows reconciled before anything new is filed:
      each re-confirmed, or closed as `Fixed` / `Gone` / `Refuted` with the
      check stated, and no inherited row re-dated or re-numbered
- [ ] Survivors counted against refuted and against inherited, each given a
      `QA-<job>-<YYYYMMDD>-<nn>` id and a row in `docs/qa/qa-worklist.md`
- [ ] Approval asked per item, and **nothing touched that was not approved** —
      no unapproved P3 riding along, no adjacent cleanup
- [ ] Fixes written only after the walk was finished and the survivors filed —
      never mid-walk, which blinds every persona that comes after
- [ ] Negative control run per new assertion: fix reverted, test seen RED,
      fix restored — and said so out loud
- [ ] Diff sent to Codex for adversarial review, its findings acted on, and the
      outcome recorded on the worklist row
- [ ] A review came back CLEAN against the final diff — or the two-round cap was
      hit and the founder was told what each round found. Mechanical-only
      changes since that commit are named on the row; substantive ones took
      another round

## Output

**Ledger** — `docs/qa/launch-qa.md`, append-only, one row per run. It already
exists; do not recreate it. Read **Outstanding restores** before you start and
clear anything there first — an interrupted earlier run leaves the database
dirty, and QA'ing on top of that files someone else's damage as your findings.

```
| job | date | personas | broke it? | findings (new / inherited) | notes |
```

The findings column separates the two on purpose. A repeat run that reports
twelve when nine were already on the worklist is inflating its own yield, and
the ledger is the one place that number is fixed forever.

**Worklist** — `docs/qa/qa-worklist.md`, one row per surviving finding at every
severity, grouped by job and carried across runs. Its states, and who may set
each, are defined in that file's own States table and **nowhere else** — do not
restate them here. The ledger is frozen once written; this file and
`FINDINGS.md` both keep moving. It already exists; do not recreate it.

**Screenshots** to the scratchpad, sent to the founder inline — not committed.

**Nothing is filed unrefuted.** Every candidate goes to a **`finding-refuter`**
first, in parallel, one per finding, each told to disprove it and to default to
REFUTED when uncertain. Refuted candidates are dropped with a one-line note in
the ledger, not silently. Survivors are filed carrying the refuter's strongest
surviving objection, so the founder sees what was argued.

**Each finding:**

```
P0|P1|P2|P3 · <job> · <one line a non-engineer understands>
Steps · Expected · Actual · Evidence (screenshot / SQL / Gmail / log)
Cause (path:line — only if actually traced)
Siblings: <same mechanism, other jobs>
Regression test: which file, which tier, and what the assertion must say
  to have gone RED against today's code
```

**Severity, calibrated once so it is not invented per run:**

- **P0** — mail lost with no way back, wrong money, or the app states something
  false about the user's own data.
- **P1** — they cannot finish the job, or finish it believing something untrue.
- **P2** — friction, ugly, slow; they still get there.
- **P3** — an idea that needs evidence first.

**Every** survivor, at every severity, gets a worklist row — that is where the
fix pipeline lives. On top of that, P0/P1 are appended to the `FINDINGS.md`
**Inbox** in its existing shape for `/ct-finding triage`, because they are also
open product questions. P2/P3 get no `FINDINGS.md` entry; the ledger and the
worklist carry them.

**Closing summary** is `/ct-status` shaped: what a user would have hit, how
bad, what proved it. Product language, no file paths in the body. It opens with
the survivors block (§8) and ends with the approval ask — those are the two
things the founder acts on, so nothing goes between them and the end.

Say what the refuters killed and why, in the founder's summary and not only in
the ledger. A run that reports four findings and hides that three others died is
selling a hit rate it did not earn, and the deaths are usually the more useful
half — they are where the run's own reasoning was wrong.

## Boundaries

Mutations are dev-stack only; prod reads are fine. No migrations from a laptop,
no cloud-resource deletion, no credential rotation. One job per run — never
bleed into the next one.

**Fixes are approved-only, and never self-signed.** Product code, tests and
migrations are touched only for a worklist id the founder has approved (§8), and
the resulting diff goes to Codex for adversarial review before it is proposed
for merge. A run that fixes and approves its own fix has removed the only
adversary in the loop, which is the entire point of the arrangement.
