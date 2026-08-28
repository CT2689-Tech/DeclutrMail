---
description: Adversarial QA of one user job — drive it in the browser, try to break it, judge it as a stranger
argument-hint: "onboarding | undo | archive | delete | unsubscribe | triage | mailbox-switch | billing | … (bare /ct-qa lists all)"
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
5. `unsubscribe` — irreversible and outward-facing. See rule 7.

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
```

**Preflight fails → the run stops.** QA against the wrong checkout is worse
than no QA.

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
  get a mutation without it.
- **375px**, then keyboard only: K/A/U/L/D.

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

## 7 — Unsubscribe: you never press confirm

Drive intent → sheet → **preview**, and **stop there**. Do not click the
confirm/execute control on an unsubscribe. Not once, not to "see the queued
row", not with the worker stopped.

This is not a style preference. `UnsubExecutionWorker` performs a real RFC 8058
one-click `POST` to the sender's URL, carrying a per-send token, from the
founder's address. There is no dry-run flag and no kill switch — I looked. Once
confirm is pressed the job is in Redis, and **stopping the worker does not
prevent the send, it defers it**: the job fires the moment a worker comes back,
and this command's own preflight runs `dev-up.sh`, which starts one. An earlier
draft of this rule said "drive it to the queued row and record which mechanism
held the send back". There is no such mechanism. That draft instructed the
exact irreversible action it claimed to forbid.

All the QA value is at or before the preview, and none of it needs a send:

- Does the preview name the right sender, the right channel, and the right
  message count?
- Does it state the consequence honestly — that this leaves the sender's list
  and cannot be undone?
- Is the one-click path distinguished from `mailto:`, which is **manual at
  launch** (D230) and must never auto-send?
- Is the destructive control distinguishable from the safe one, and does the
  copy survive 375px?

To see the shape of a queued unsubscribe row, read an existing one or the
contract. Do not manufacture one.

If a probe seems to require confirming, that probe does not run. Write
`n/a — would fire a real unsubscribe` in the ledger and move on. This is the
one place in this document where an unexplored gap is the correct outcome.

## Done means done — six boxes, not vibes

- [ ] All four personas walked, the editor last (as `usability-editor`)
- [ ] Break list exhausted, or each skip named with its reason
- [ ] Every finding carries evidence a stranger could re-check
- [ ] Every finding survived a `finding-refuter`
- [ ] Every forced value restored, and the restore verified
- [ ] Every bug given its `defect-class-sweeper` pass

## Output

**Ledger** — `docs/qa/launch-qa.md`, append-only, one row per run:

```
| job | date | personas | broke it? | findings | notes |
```

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

P0/P1 are appended to the `FINDINGS.md` **Inbox** in its existing shape for
`/ct-finding triage`. P2/P3 stay in the ledger.

**Closing summary** is `/ct-status` shaped: what a user would have hit, how
bad, what proved it. Product language, no file paths in the body.

## Boundaries

Mutations are dev-stack only; prod reads are fine. No migrations from a laptop,
no cloud-resource deletion, no credential rotation. One job per run — never
bleed into the next one.
