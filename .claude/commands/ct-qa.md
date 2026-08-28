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
  each job's ledger state (`✔ done <date>` / `🐛 <n> open` / blank), then start
  the highest-priority job not yet done.

## Safety — read before the job list

**No run executes an unsubscribe, on any job, by any route — and `U` is never
pressed.** Not the confirm control, not the `U` shortcut at all, not a `POST`
to the actions API with that verb, not enqueueing or un-pausing the job by
hand.

`UnsubExecutionWorker` performs a real RFC 8058 one-click `POST` to the
sender's URL, carrying a per-send token, from the founder's address. There is
no dry-run flag and no kill switch. Once it is queued, stopping the worker does
not prevent the send — it defers it until a worker returns, and this command's
own preflight starts one.

This block sits above the job list because the hazard is not confined to one
job. `U` is a triage shortcut: it is reachable from Triage, Senders, Sender
detail, Brief and Screener. Six earlier drafts put this rule in a numbered
section scoped to the unsubscribe job while the break list told every run to
press `K/A/U/L/D`. **A safety rule scoped narrower than its hazard is not a
safety rule.**

**`U` is not pressed at all.** Not "far enough to see the preview" — an
earlier draft said exactly that, and it is circular: it assumes the preview
renders and gates on nothing, while whether the preview renders is one of the
things this tool exists to find out. If D226 is broken on that surface, or D34's
remember-preference has the sheet skipped, the keystroke IS the send. A probe
whose safety depends on the property it is testing is not a probe.

So the unsubscribe surface is reviewed by **reading, not driving**: is the
control present, labelled with the canonical verb, visually distinguished from
the safe ones; does the sender row carry the channel it claims; is one-click
distinguished from `mailto:`, which is manual at launch (D230). Whether the
preview actually renders for `U` is checked in the Storybook story and the
component, and recorded as read-not-driven. It stays that way until the kill
switch below exists.

There is no standalone `unsubscribe` job. The founder's original carve-out —
drive it to the confirm step, never send — could not be enforced by wording,
which is what six review rounds demonstrated. Restoring it needs a real
mechanism, not a firmer sentence: a dev-only refusal inside
`UnsubExecutionWorker`. Filed in `FOUNDER-FOLLOWUPS.md`.

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

## Shape of a run — five phases, and the run ships nothing

**A `/ct-qa` run produces findings. It does not produce commits.** No fix, no
PR, no file touched outside the ledger and `FINDINGS.md`.

Rule 6 has always said this. The 2026-08-27 triage run shipped nine fix PRs
anyway, and four of them — #657, #658, #659, #660 — rewrote the same sentence
in the Later preview, each a full round through typecheck, lint, tests, smoke,
gates, CI and merge before the next defect in that sentence was found. Ten
hours; the browser was driven for about one of them.

The cause is structural, not discipline. The stack is the only thing in this
pipeline that cannot be duplicated — one database, one Gmail mailbox, one
worker, one `:4000`. `playwright.config.ts` says it outright: *"Shared dev DB
and one Gmail mailbox — never parallelise."* Every minute spent fixing is a
minute that lock is held and no QA happens. So the run holds the lock as
briefly as it can and hands everything else off.

| Phase | Holds the stack? | What happens |
| ----- | ---------------- | ------------ |
| **A — Drive** | **Exclusively** | Preflight → Step 0 restores → the three using personas → the break list. Collect candidates. Fix nothing. |
| **B — Fan out** | No | Every read-only agent at once: all `finding-refuter`s, all `defect-class-sweeper`s, `usability-editor`, `flow-completeness-auditor`. |
| **C — Measure** | Brief, read-only | Run the sweepers' `unmeasured` SQL through `assert-dev-db.sh --exec`; hand the numbers back. |
| **D — File** | No | Ledger row, `FINDINGS.md` Inbox, closing summary. **The run ends here.** |
| **E — Fix** | Per fix | A SEPARATE session. See **Handoff** under Output. |

### Phase B goes out as ONE wave

Dispatch every Phase B agent **in a single message**, so they actually run
concurrently. Firing them one at a time — a refuter after each finding, a
sweeper after each mechanism — costs the same wall clock as no parallelism at
all. It is also the default mistake, because each rule below names its agent
at the point the finding appears rather than at the point the agent should
run. The rules describe *what* to dispatch; this section decides *when*.

Nothing in Phase B touches the stack, the database, or the browser. It can run
against the checkout with the stack already down.

### Phase A collects; it does not adjudicate

A candidate found at 10:00 is refuted in Phase B, not at 10:01. Stopping
mid-drive to prove or disprove something is the interleaving this structure
exists to remove. Write it down and keep driving.

The exception is evidence only capturable in the moment — a screenshot, a
console line, an `action_jobs` row a later query would no longer see. Capture
those as you go (rule 5); judge them in Phase B.

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
  set, in **Phase B's single wave**, nothing mutates. It is the only persona
  that can be delegated; the other three depend on the founder seeing what
  happened.

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
**`flow-completeness-auditor`** for the state table rather than re-deriving
one — in Phase B's wave, like every other agent in this document.

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
mechanism, in **Phase B's single wave**, never one after each bug is found.
Record the instances. Fixing is Phase E, in another session; hand the class to
`/ct-class`, which refuses to patch in the same pass for the same reason.

The sweeper must prove its query rediscovers the known instance before its
silence means anything.

It has no shell and no database by design, so it will hand back instances
marked **unmeasured** with the exact SQL it needed. Run those through
`assert-dev-db.sh --exec` and give it the numbers — that is what moves an
instance from trust 8 to trust 10.

## 7 — Unsubscribe

See **Safety**, above the job list. It is stated once, before the jobs, because
it binds every job — not only the one that was named after it.

To see the shape of a queued unsubscribe row, read an existing one. Do not
manufacture one. A probe that would require executing the verb does not run:
write `n/a — would fire a real unsubscribe` in the ledger and move on. This is
the one place in this document where an unexplored gap is the right outcome.

## Done means done — eight boxes, not vibes

- [ ] The run made **no commit and opened no PR**, and changed no file outside
      the ledger and `FINDINGS.md`
- [ ] Phase B went out as ONE wave, not agent-by-agent
- [ ] All four personas walked, the editor last (as `usability-editor`)
- [ ] Break list exhausted, or each skip named with its reason
- [ ] Every finding carries evidence a stranger could re-check
- [ ] Every finding survived a `finding-refuter`
- [ ] Every forced value restored, verified by re-query, and its Outstanding
      restores row deleted
- [ ] Every bug given its `defect-class-sweeper` pass

## Output

**Ledger** — `docs/qa/launch-qa.md`, append-only, one row per run. It already
exists; do not recreate it. Read **Outstanding restores** before you start and
clear anything there first — an interrupted earlier run leaves the database
dirty, and QA'ing on top of that files someone else's damage as your findings.

```
| job | date | personas | broke it? | findings | notes |
```

**Screenshots** to the scratchpad, sent to the founder inline — not committed.

**Nothing is filed unrefuted.** Every candidate goes to a **`finding-refuter`**
first — one per finding, all of them in Phase B's single wave — each told to
disprove it and to default to REFUTED when uncertain. Refuted candidates are dropped with a one-line note in
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

P0/P1 are appended to the `FINDINGS.md` **Inbox** in its existing shape for
`/ct-finding triage`. P2/P3 stay in the ledger.

**Closing summary** is `/ct-status` shaped: what a user would have hit, how
bad, what proved it. Product language, no file paths in the body.

### Handoff — how findings become fixes

Phase E is a separate session. Three rules govern it, all three learned from
#657–#660:

- **Group by surface, not by finding.** Nine findings on the Later preview are
  one PR, not nine. Every PR pays the full §8 definition of done — typecheck,
  lint, unit, e2e, smoke, gate agents, CI — and that cost is per PR, not per
  fix.
- **Adversarial review runs BEFORE the commit, on the working tree.** #658,
  #659 and #660 each open with "Codex stop-time review". The reviewer was
  right every time and was asked too late every time. The same reviewer, moved
  ahead of the PR, is one PR instead of four.
- **A claim about behaviour is checked against the code that implements it**,
  never against the other copy on the screen. #659 asserted a delivery
  guarantee `GmailClientService.batchModify` does not make; #660 asserted a
  moment `SnoozeWakeWorker`'s 15-minute sweep cannot promise. Both were copy
  read against copy.

## Boundaries

Mutations are dev-stack only; prod reads are fine. No migrations from a laptop,
no cloud-resource deletion, no credential rotation. One job per run — never
bleed into the next one.

**The run ships nothing.** No commit, no PR, no fix — not even a one-line one
that is "obviously right". The ledger row and the `FINDINGS.md` Inbox entries
are the entire output. A fix made here holds the stack lock, and the next
finding waits behind it.
