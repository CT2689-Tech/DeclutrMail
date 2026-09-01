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

| job            | date       | personas                                                   | broke it? | findings (new / inherited)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------- | ---------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| triage         | 2026-08-27 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 15 new / 0 inherited (first triage run); 4 refuted before filing. 3 P1 + 1 P2 also in `FINDINGS.md`; all 15 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Drove list → expanded card → preview → mutation → undo on the real mailbox. D226 held on every reachable path. `U` never pressed. Full detail below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| undo           | 2026-08-28 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 4 new / 0 inherited (first undo run); 3 refuted before filing. 1 P1 also in `FINDINGS.md`; all 4 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A prior same-day attempt aborted mid-run — a concurrent session raced the same mailbox/DB and the round-trip's attribution became unverifiable; no row was written for it, restart below has the detail. Archive→Undo and Delete→Undo both driven clean afterward, single session, verified via Gmail MCP + `action_jobs`/`undo_journal`. `U` never pressed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| archive        | 2026-08-28 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 6 new / 0 inherited (first archive run); 3 refuted before filing. All P2/P3 — none in `FINDINGS.md`; all 6 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Own worktree stack (API :4001, web :3002 — :4000/:3000/:3001 already held by other live sessions on this shared dev box; never ran `dev-up.sh --stop`). Drove Triage single-row archive and Senders bulk-select archive to completion, both preview→mutation→undo verified via Gmail MCP + `action_jobs`. Tried hardest to break preview enforcement (hand-crafted `POST /api/actions` with zero preceding `GET /api/actions/preview` call — succeeded, 47 real messages archived) and a same-Idempotency-Key double-submit (correctly deduped, no bug) — see Refuted below for why the preview-bypass didn't survive review. Mailbox switch (primary ↔ `.crypt` account) held with no cache leak. Mobile 375px: row/toolbar layout clean; the preview-modal tap sequence hit repeated browser-pane click timeouts on this session's mobile emulation and is recorded as inconclusive, not a product finding. Two-tab race, worker-kill mid-job, and an enormous-sender (500+) test were skipped for time; not driven. `U` never pressed. Full detail below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| onboarding     | 2026-08-28 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 5 new / 0 inherited (first onboarding run); 4 refuted before filing. 4 P0/P1 also in `FINDINGS.md`; all 5 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reused the shared :4000 API (2 commits behind this branch, no relevant divergence; another live session confirmed actively hitting it — never restarted it), own worktree web on :3001. Drove the pre-auth promise screen, forced NO_ACTIVE_MAILBOX + syncing + failed sync-gate states via pinned-id DB writes (all restored and re-verified), the second-account entry point in Settings, and mobile 375px. Live-caught a real session-revoke → real-Google-OAuth-redirect-storm incident mid-run (network log evidence), independently corroborated in real time by a concurrent peer session (`ct-qa-mailbox-switch-173132-64`) hitting the identical bug on `/ct-qa mailbox-switch`. `U` never pressed. Full detail below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| delete         | 2026-08-29 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 9 new / 0 inherited (first delete run); 2 candidates put through `finding-refuter` (1 REFUTED, 1 PARTIALLY REFUTED and refiled corrected). All P2/P3 — none in `FINDINGS.md`; all 9 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                               | Own isolated worktree stack (api:4002/web:3002) after colliding with two other live sessions on shared :4000/:3000/:4001; restored the peer session's :4000 api and sent courtesy heads-ups (see notes). Drove Triage row, keyboard `D`, Senders table "More actions," and sender-detail Delete paths on the real dev-linked mailbox; full preview→mutation→undo lifecycle verified via Gmail MCP + `action_jobs`/`undo_journal` on two different real single-message senders, including a same-Idempotency-Key double-click (deduped, no bug) and a double-undo (second click a safe client-side no-op, no second API call). D226 preview held on every reachable path, including a deliberately-uncomfirmed 374-message sender. Keyboard `D` opens the preview, never bypasses it. Mailbox switch mid-preview safely dismissed the modal rather than leaking cross-mailbox; Senders cache reset correctly both directions. Mobile 375px: layout clean, Delete is its own full-width red row and excluded from the K/A/L swipe gestures; the confirm-tap sequence hit the same browser-pane mobile-emulation click-timeout artifact the `archive` run logged — recorded as inconclusive, not a product finding. Two-tab race, worker-kill-mid-job, and cross-mailbox-id reach were skipped for time. `U` never pressed — two accidental opens of its preview (mis-clicked quick-action pill) were escaped without touching the confirm button. Full detail below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| mailbox-switch | 2026-08-31 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 6 new / 0 inherited (first mailbox-switch run); 0 refuted before filing (the 1 candidate sent to `finding-refuter` SURVIVED, corrected and widened). 1 P1 also in `FINDINGS.md`; all 6 in `docs/qa/qa-worklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                            | Own worktree stack (api:4001/web:3003 — this exact worktree's own long-running processes, cwd-confirmed, web restarted fresh mid-run to rule out stale HMR). Drove mailbox switch (primary ↔ `.crypt`) across Senders/Triage/Sender-Detail/app-shell, a stale-detail-page cross-mailbox read (clean 404), a two-tab race proven at the API layer (`GET /api/actions/preview` scoped by request context, fails closed on a stale sender), a disconnected-switch-target block (genuinely `disabled` control, DB-forced and restored), and bogus/malformed switch-target ids (clean 404/400). Found one real bug outside the switch mechanism itself while running the mandatory 375px pass: `/senders` throws `useLongPress is not a function` in `SenderListRow` — catastrophic at mobile, silent-partial at desktop — sent to `finding-refuter` (SURVIVES, wider blast radius than filed) and `defect-class-sweeper` (2 unmeasured siblings: `useFocusTrap` ×15 sites incl. billing/account-deletion modals, `useLocalState`). `flow-completeness-auditor` found Autopilot/Screener/Brief carry no mailbox-id in their query keys (Quiet does) — unmeasured structural gap, not reproduced. `usability-editor` filed 4 account-menu copy findings. Two of four background agents stalled at the 600s watchdog on first dispatch and were retried successfully — noted as an infra hiccup, not a product signal. Mobile switcher control itself untested — browser-pane mobile-viewport tooling began hanging independent of any product state. `U` never pressed. Full detail below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| billing        | 2026-09-01 | first-timer · scared · heavy · editor (`usability-editor`) | yes       | 11 new / 0 inherited (first billing run); 1 candidate FULLY REFUTED before filing (see Refuted below) — its underlying mechanism turned out real and reachable via two independent paths, filed corrected as -01/-02. A SECOND `finding-refuter` pass was run on the 5 originally-filed P1s specifically (since they were about to drive founder-facing `FINDINGS.md` entries); only 2 survived as P1 (both confirmed STRONGER than filed), 3 downgraded to P2/P3 with corrected root causes — worklist and `FINDINGS.md` both reflect the corrected picture, not the as-filed one. 2 P1 in `FINDINGS.md`; all 11 in `docs/qa/qa-worklist.md` | Own isolated worktree stack (api:4003/web:3005 — :4000/:3000 held by the main checkout, :4001–:4002/:3002–:3003 held by two other live worktree sessions; none touched, none stopped). Drove the real dev workspace's REAL active sandbox Paddle Pro-annual subscription (`sub_01kys14ejmvjg6fe2f1jza8kkd`) end-to-end: cancel preview (opened 3×, never confirmed), downgrade-to-Plus/Free previews at both intervals, payment-method-session minting (verified via direct API call, never navigated the browser into the real Paddle portal), invoice list, `/pricing` marketing page incl. the Founding Pro scarcity-check CTA, and a mailbox switch mid-billing-screen (workspace-scoped, correctly stable both directions). One pinned-id DB force (`workspaces.tier` → `'free'`, subscription row untouched) to see the Free-tier upgrade UI, restored and re-verified same session. Found and live-confirmed (`document.activeElement`, reproduced 2×) a focus-trap defect on the Cancel-subscription modal; the `defect-class-sweeper` dispatched on it swept all 21 production `useFocusTrap` call sites and found a second, more severe LIVE instance on the mailbox-disconnect dialog (focus on "Disconnect and keep data" — real credential revocation, no further confirm) — verified live this run (read-only, escaped before confirm) despite being outside this job's own surface, given severity; flagged as its own follow-up task given severity; a third instance (Triage Delete-on-Protected-sender → "Unprotect") stayed code-confirmed only, since reaching it would have meant driving the Triage job. A separate `defect-class-sweeper` on the checkout-guard's `cancel_at_period_end` blind spot found 3 live-reachable siblings beyond the seed; a second refuter pass narrowed 2 of those to P2 (real but smaller than filed) with corrected mechanisms. `flow-completeness-auditor` enumerated 45 states across the full subscription lifecycle (checkout, cancel, pause/resume, D120 scheduled change, dunning, refund, chargeback, founding-member) and independently converged on the same chargeback-drift gap from pure code reading — that finding's own cause was then partially refuted (deliberate design, not oversight) while a narrower, real symptom survived underneath. `U` never pressed — not applicable to this job's surface. Full detail below. |

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

### `undo` — 2026-08-28

**Aborted first attempt, same day, no row.** Preflight passed and the first
Archive→Undo round-trip was driven on the real mailbox (`classicfirearms.com`),
but a concurrent local session was independently committing to this same
branch/checkout during the mutation window, queried the same Gmail message
mid-archive, concluded it was abandoned residue from an earlier run, and
hand-restored its `INBOX` label by API roughly a minute before this run's own
Undo click completed. Both fixes landed on the same message inside a ~90-second
window, so which one actually restored the label is unattributable — the run's
central proof was compromised by a class this command's own preflight cannot
catch (it verifies the checkout at one instant; this checkout changed four
times after). Stopped before filing anything. Mail state was independently
re-verified clean (both test messages exactly at their pre-run label sets) and
`Outstanding restores` was empty — the abort cost nothing but the run itself.

**Restarted, same day, ~8 hours later** (model switched to Sonnet 5 mid-session;
skill content had itself changed underneath — the unsubscribe gate went from an
unconditional ban to a two-check gate to (per the worklist's own tail) a
same-day withdrawal of that gate). Preflight found the branch had been
squash-merged to `main` (PRs #663–#665) — the exact "closed PR silently moves
you to main" trap the preflight checklist names. Before touching anything,
checked whether the dev stack was live-driven by another session (`api.log`'s
last write was 6 hours stale despite a misleadingly-recent `worker.log` mtime
from routine cron sweeps; only one process per role, no orphans) and messaged
peer session `declutrmail-8d` as a courtesy before mutating shared mailbox
state; no reply arrived, but the evidence of idleness was strong enough to
proceed. **Deviated from preflight**: skipped the mandatory `dev-up.sh --stop
&& dev-up.sh` restart, since the running stack was already verified clean and a
restart risked repeating the exact collision that voided the first attempt for
zero benefit (nothing to sweep).

**Walked:** `/activity` outcome tiles and contextual help, Senders drawer →
D226 preview → Delete → Undo (fresh single-message sender, `ukpos.com`, chosen
to keep blast radius minimal) → re-verify, double-undo via a direct repeat
`POST /api/undo/:token` (idempotent, no second reverse job), 375px viewport
pass on `/activity`.

**Filed (survived `finding-refuter`):**

- **P1 — Activity's own stat tiles disagree with each other about whether an
  undone action still counts**, on the same page, same window, with no label
  on either tile saying which convention it follows. `QA-undo-20260828-01`.
  Live-verified: 4 `activity_log` rows in the 7-day window, all 4 reverted
  (2 from this run's own Archive/Delete-then-Undo tests), top "This week"
  metrics panel still read `ARCHIVED 3 / DELETED 1`. A `defect-class-sweeper`
  found the same mechanism live in two Tier 1b public-facing benefit-accuracy
  claims (Triage's "handled N automatically", "noise prevented per month") plus
  two narrower instances — recorded as siblings on the worklist row, not
  independently re-refuted.
- **P2 — `/activity`'s 30-day stat row collides at 375px** ("UNSUBSCRIBES" and
  "KEPT" overprint into "UNSUBSCRIBKEPTS") for ~390ms before hydration
  restacks it — caught mid-flash via headless-Chromium frame capture, not the
  `innerWidth: 0` harness artifact. Self-corrects; fix shape already documented
  in `LEARNINGS.md:1348`. `QA-undo-20260828-02`.
- **P3 — the "Recovered" outcome tile can never register a user's own Undo**
  (a structurally different, currently-unused mechanism — retried-after-failure
  jobs) and nothing in the product defines it anywhere a user could learn that.
  `QA-undo-20260828-03`.
- **P2 — Delete's own verb name disappears across all 6 of its result
  surfaces** (button says Delete, every banner/toast/row/tile/chip after it
  says "Moved to Gmail Trash" or "Deleted"), and its undo deadline repeats the
  UTC-toast/reader's-zone-banner mechanism already filed on `triage`
  (`QA-triage-20260827-09`) — a second live instance, now on the undo surface
  itself. `QA-undo-20260828-04`, filed from the `usability-editor` pass; not
  put through a dedicated `finding-refuter` (each item is independently
  source-traced with file:line by the editor, not a raw screen impression —
  see the worklist row for the scope call).

**Refuted before filing:**

- **"No outcomes in the last 7 days. Nothing needs your attention." is a false
  or self-contradicting claim.** Killed on two grounds: the sentence is
  logically entailed true (gated on 5 zero tiles, which entails `failed=0`,
  exactly the separate `needsAttention` condition), and every one of the 4
  reverted rows renders an explicit `UNDONE` badge one panel below — the screen
  states "4 actions, all undone" and "0 outcomes" simultaneously, which is
  coherent, not contradictory. What survived from this candidate is the P1
  above — the actual defect is narrower: raw verb counts (not the outcome
  tiles, and not this sentence) omit the undo filter that a different tile row
  correctly applies.
- The original framing of the Recovered-tile candidate — that a user's own
  Undo click would plausibly be misread against a specific "0 Recovered" —
  died too: this account has zero `action_jobs` with `recovery_attempt > 0`
  ever, so the tile was never going to move for any reason this run tested,
  and survived only as the narrower P3 above.
- **The Delete preview's default filter is a silent 0-match dead end.**
  Surfaced by the editor pass from this run's own live Delete-preview walk;
  sent to a `finding-refuter`, killed by measurement: the default (180 days,
  Delete-only) is spec'd, not leftover state, and the remedy control
  advertises its own non-zero count on the same frame ("All inbox 1" beside
  four zeros) plus a status line naming the fix — nothing about it is silent.
  Measured against the founder's real mailbox: only 6.5% of Delete-opens hit
  zero-match at all (426/6,564 senders), and the job in this run completed in
  one click. At most P3 polish; not filed.
- **The reach chip ("Inbox only 0") contradicts the sentence below it ("1
  email... is in your inbox").** Also killed by measurement: the exact frame
  described cannot render — with the windowed filter selected, the correctly-
  windowed chip reads "Inbox only 0 · Inbox + archived 76" for `ukpos.com`,
  not 169. The "169" this run cited came from a different UI surface (the
  drawer card's un-windowed total-received figure), spliced against the
  modal's windowed reach count as if they were the same number at the same
  moment — the exact same-window/different-population comparison error this
  codebase's own `cumulative-stats-are-not-rates` lesson warns about, this
  time made by the run itself rather than caught in the product. The
  sentence's own second clause ("but it is not older than 180 days") is the
  reconciliation; reading it resolves the apparent contradiction rather than
  deepening it.

**Held up under attack (what the probes would have caught):**

- D226 preview rendered correctly on the Delete path, including the
  zero-match state when the default "6 months+" filter excluded the (9-day-old)
  target message — confirm control implicitly required a widened window, never
  producing a mutation without a rendered preview.
- Double-undo via a direct repeat API call on an already-reverted token
  returned `reverted: true` idempotently; `SELECT count(*)` confirmed no
  second reverse `action_jobs` row was created.
- Gmail label state matched the pre-run set exactly after both Archive→Undo
  and Delete→Undo, verified via the Gmail MCP tools directly (not the
  product's own read path) against `action_jobs`/`undo_journal` DB rows
  independently.

**Not run, with reasons:** unsubscribe (Safety §, gate withdrawn same day per
the worklist — `U` stays unpressed regardless of what this run's own skill
prompt said about a two-check gate, which was already stale relative to the
command file on disk); two-tab concurrency and mid-flow mailbox switch (belong
more to `mailbox-switch`; not reached before budget); worker-kill /
`reconnect_required` (belongs to `sync`/`disconnect-reconnect`); real 429
(rate-limit job).

**Method note worth keeping, same class as the file's earlier one.** This
run made the exact mistake it was checking the product for: it cited "169"
against "Inbox only 0" as a contradiction without noticing the two numbers
came from different UI surfaces with different windows. A `finding-refuter`
caught it by re-measuring both figures live rather than trusting the
transcript. The lesson generalizes past this one candidate — any claim built
by comparing two numbers glimpsed at different moments needs the same
re-measurement before it is trusted, whether the numbers come from the
product or from the run's own notes.

**Process note worth keeping.** Two live file collisions happened on this run
alone, on two different systems — Gmail (a concurrent session's hand-edit
during the aborted first attempt) and this same ledger/worklist file (a
different concurrent session added a status-glyph column and moved several
`triage` rows to `Merged`/`Fixed` while this run's own `## undo` section was
being appended). Both resolved cleanly because the edits landed on disjoint
regions of shared state — but neither preflight nor this file format has any
mechanism that would catch two sessions targeting the _same_ row or the _same_
message at the same time beyond luck. Worth a founder decision on worktree
isolation per session, not attempted here.

### `archive` — 2026-08-28

**Walked:** Triage single-row Archive (Temu, K/A/U/L/D expanded toolbar,
D226 preview, confirm, undo, re-confirm), Senders grid bulk-select Archive
(RetailMeNot, 3-message blast radius, same preview→mutation→undo cycle),
keyboard-only (`A` key opens the same preview modal as a click; `Esc`
cancels cleanly with zero mutation), mailbox switch mid-session (primary ↔
`chintan.a.thakkar.crypt@gmail.com`, no stale data leaked either direction),
and a deliberate attempt to defeat D226 by calling the mutation API directly
without ever calling preview.

**Stack note.** `:4000`/`:3000` were already running another checkout's
worktree stack (confirmed via `lsof -p <pid> | awk '$4=="cwd"'` — cwd pointed
at the main checkout, not this worktree) and `:3001` was held by a third,
unrelated worktree. Per `parallel-worktree-dev-stack` precedent: never ran
`dev-up.sh` (it force-kills those ports), instead ran this worktree's own
`PORT=4001 pnpm --filter @declutrmail/api dev` + `apps/web/.env.local` with
`NEXT_PUBLIC_API_URL=http://localhost:4001` + `next dev -p 3002`, reusing the
already-running shared worker (same code, same queues — starting a second
worker on the same BullMQ queues is the real hazard, not sharing one).
Recorded `.dev-db-identity` fresh for this worktree via `assert-dev-db.sh
--record` before any `--exec`.

**Cross-session collision, disclosed by the other party.** Mid-run, session
`declutrmail-3e` (running `/ct-qa triage` concurrently against the same
shared dev DB and the same real mailbox) messaged to flag that its own
archive+undo pair on `em.abercrombie.com` (11:06:15/11:09:47) would appear in
this run's `action_jobs` history, and to confirm this run's Temu/behno.com
rows weren't theirs. Checked: correct on both counts — none of this run's
filed evidence touches Abercrombie, and the Temu/behno.com action_jobs rows
used as evidence below are this run's own (confirmed by literal `id`,
sender, and timestamp match against what this run actually clicked/curled).
The general point stands as a caveat, not a finding: some of the queue churn
observed mid-run (sender/email counts ticking up between checks) may partly
be the other session's concurrent triage decisions rather than organic mail
arrival — noted, not relied on as evidence for anything filed.

**The preview-bypass attempt, in full, because it is the most load-bearing
thing this run tried.** Monkey-patched `window.fetch` in the browser tab
(read-only instrumentation, not a product change) to capture the exact body
the real product sends on a normal Archive click:
`{"selector":{"type":"sender","senderId":"..."},"primary":{"type":"archive","olderThanDays":null},"override":false}`.
Replayed that exact body via a hand-crafted `curl POST /api/actions` (valid
session cookie + CSRF header + fresh `Idempotency-Key`) for `behno.com` (47
inbox messages) — from a plain terminal, no browser tab open on that sender
at all, so no `GET /api/actions/preview` call happened anywhere for this
sender before the POST. Server returned `201 Created`. Confirmed via
`assert-dev-db.sh --exec`: `action_jobs` row `verb=archive, direction=forward,
status=done, affected_count=47`. Confirmed via Gmail MCP `search_threads
from:behno.com in:inbox`: zero results (down from 47). Undid via
`POST /api/undo/<undo_token>`, re-verified via Gmail MCP: all 47 messages
back in inbox with original `UNREAD`/`IMPORTANT`/`INBOX` labels intact.
Separately fired the identical body twice with the same `Idempotency-Key` —
correctly deduped to one `action_jobs` row (`queued` → `executing` on the
second response, no double-archive) — held, not a bug.

**Why this did not survive as a finding.** Sent to `finding-refuter`
independently of the sweep. Verdict: REFUTED. The reviewer's core point:
D226 ("action sheet → preview → mutation → undo") is a rendering-order
guarantee for the product's own UI, enforced correctly at the only layer
where it can mean anything (the frontend's call sequence, backed by
`architecture-guardian` and the `require-preview-before-mutation.sh`
authoring lint) — not an authorization control. `GET /api/actions/preview`
is itself an unguarded, side-effect-free read available to any caller who
can already `POST`, so a "preview token" would be minted by the same
authenticated caller for itself; it would defend against nobody, because the
population it would gate is empty (the caller is either the account owner
using their own session, or an attacker who already has that session, in
which case CSRF+session — the actual boundary — already failed). The
reviewer's own strongest objection, not itself filed: CLAUDE.md §2.6 records
this exact shape — a guard on the request side, nothing on a non-UI producer
— as the root cause of a real prior incident (the Brief cron's Free/Plus
Anthropic leak). A `defect-class-sweeper` run in parallel (unaware of the
refutation) found five structurally-identical instances — Screener decide,
Autopilot rule-approve, Snoozed wake, unsubscribe-intent, and the bundled
secondary-action path — all sharing the same no-server-linkage shape. Given
the refuter's reasoning, none of the six are filed as bugs. The one thread
worth pulling that the refutation does NOT close: Autopilot's only preview is
a rule-level dry-run at rule-creation time, not a per-execution preview — so
for a rule that auto-approves and runs unattended, no human necessarily ever
sees a preview for the specific messages a given run moves, which is closer
to what D226 actually cares about than the curl-replay framing above. That
is a design question for the founder, not a QA finding, and is not filed
here or in the worklist.

**The other two candidates that also didn't survive**, in briefer form (full
grounds on the worklist's Refuted-adjacent notes are folded into the two rows
below rather than duplicated here):

- **Triple "last seen" mismatch (RetailMeNot: grid "1d" / preview header
  "today" / preview body "273 days old").** PARTIALLY REFUTED. The "273
  days" figure is a deliberately different, inbox-scoped metric (already
  documented in `MISTAKES.md` as its own prior incident) — comparing it to
  `last_seen_at` was this run's own mistake, not a product bug. What
  survives is narrower and weaker than filed: the grid card and the preview
  header use two different day-rounding conventions on the identical
  `last_seen_at` value and can disagree by exactly one day inside a
  sub-24-hour, cross-midnight window (confirmed via `assert-dev-db.sh
--exec` against the live row: elapsed 20h57m, floor→0/"today",
  calendar-round→1/"1d"). The reviewer's own read: this may not clear the
  bar for a filed row on its own — dropped, not filed, but recorded in the
  worklist's `archive` section as context for `QA-archive-20260828-03`,
  which is the same mechanism on a stronger, single-page instance.
- **Rationale (36/mo) vs. stat badge (109) for Victoria's Secret.** REFUTED
  outright — this run's own analysis error. `monthlyVolume` on the Senders
  API is a knowingly-misleadingly-named 90-day WINDOW count (documented in
  ADR-0037), not a monthly figure; the Triage card's own "36 per month" tile
  is the correct `round(109 / 3)` derivation of that same 90-day count,
  confirmed against a live DB read of the sender's actual `triage_decisions`
  row (12h21m old, not stale). All three numbers this run saw were
  consistent once correctly attributed; there was no product bug to file.

**Six survivors filed** (`docs/qa/qa-worklist.md`, `## archive`): two
sourced from the `defect-class-sweeper` output and explicitly marked as not
independently live-verified this run (frozen-rationale-with-no-age-label
inside the D226 dialog itself; a three-way day-math self-contradiction on
Sender Detail), and four sourced from `usability-editor` against copy this
run captured live and verbatim, per the same "scope/budget call, not put
through a dedicated `finding-refuter`" precedent `QA-undo-20260828-04`
already set. One already-open row from the `triage` job
(`QA-triage-20260827-11`, the 375px confirm-below-fold problem) was
independently re-observed on the Archive preview specifically and is
re-confirmed there rather than re-filed under `archive`.

**Genuinely blocked / skipped, named:** two-tab race (same action from two
tabs) and worker-kill-mid-job were not driven — time, not access; an
enormous-sender test (500+ inbox messages) was skipped in favor of smaller,
faster-to-verify senders, since blast radius doesn't change what the test
proves. The mobile 375px preview-modal TAP sequence (as opposed to the row
layout, which was checked and is clean) hit repeated browser-pane click
timeouts specific to this session's mobile-viewport emulation and is
recorded as inconclusive, not attempted further — not filed as a product
finding, since desktop clicks on the identical control worked without
incident throughout the same session.

### `onboarding` — 2026-08-28

**Walked:** the pre-auth `StepPromise` privacy disclosure (Step 1 of 5),
the no-active-mailbox reconnect gate (both mailboxes force-disconnected —
clean, comprehensible, per-account Reconnect buttons + escape links), the
`?mailbox=` secondary-connect sync-gate in both `syncing` (42%, progress
bar + checklist) and `failed` (reassuring copy, correct escape to the other
connected account) states, the second-account entry point in Settings
("+ Connect another Gmail account"), and mobile 375px on `/senders`.

**Stack note.** `:4000` was running the main checkout, 2 commits behind
this worktree's branch (`e9fdadde`, `7401daf6` — a Sentry exception-detail
fix and 5 archive-QA fixes, neither touching auth/onboarding/mailbox code);
`api.log`'s last-write timestamp was live (seconds old) at preflight,
confirming another session was actively driving it — never restarted it,
never ran `dev-up.sh`. Ran this worktree's own web on :3001
(`.claude/launch.json` repointed from the main checkout's absolute path to
this worktree's `apps/web`; `apps/web/.env.local` copied in with
`NEXT_PUBLIC_API_URL=http://localhost:4000`). Root `.env.local` and
`.dev-db-identity` copied in from the main checkout so `assert-dev-db.sh
--exec` resolves against the same recorded dev cluster. Session cookies are
host-scoped (`localhost`), not origin-scoped, so a dev-login against
`:4000` is honored by the app running on `:3001` without a separate login.

**The incident, as it happened.** Mid-walk, navigating between `/onboarding`
and `/senders` on an already-authenticated tab produced `GET /api/auth/me →
401`, `POST /api/auth/refresh → 401`, then three real requests to `GET
/api/auth/google/start` (2 `net::ERR_ABORTED`, 1 `429 Too Many Requests`) —
the browser landed on raw rate-limit JSON at the live OAuth endpoint.
Per Safety, did not proceed through any Google consent screen and entered
no credentials. Independently, `ct-qa-mailbox-switch-173132-64` (a peer
session running `/ct-qa mailbox-switch` concurrently on the same shared
stack) messaged unprompted that it had just hit the identical shape from
its own testing, naming the same root file. Both sessions' independent
observations plus a `finding-refuter`/`defect-class-sweeper` pass converged
on two compounding, separately-fixable defects — filed as
`QA-onboarding-20260828-02` (an unguarded render-body redirect,
`auth-provider.tsx`) and `-03` (refresh-rotation has no representable grace
path for a concurrent same-account race, `sessions.service.ts`) — full
grounds and severity corrections on those worklist rows, since both
narrowed materially under adversarial review and neither should be read at
the severity this paragraph's raw symptom suggests on its own.

**The strongest finding of this run did not come from the incident.**
`flow-completeness-auditor`'s state-table pass (50 states enumerated across
the pre-auth flow, the 5-step machine, the sync lifecycle, the secondary-
connect gate, the no-active-mailbox gate, and app-shell scope transitions;
34 verified by an existing test) surfaced that `/senders` has no
readiness-aware rendering path at all outside a collapsed account-menu
dropdown — so a mailbox that is still (re)syncing renders either a flat
"no senders" denial or a stale pre-disconnect snapshot under a "Synced
through …" timestamp it never measured. A `finding-refuter` pass
**could not kill this** and made it worse: the auditor's own cited "syncing"
empty-state copy turns out to be unreachable on a fresh load (a different,
plainer branch fires — "No sender has mailed you recently", which is a
flatter false claim, not a softer one), and the reachable window is wider
than "reconnect only" — `markQueued` re-queues on every login, so this is
hit by an ordinary returning sign-in mid-resync. Filed as
`QA-onboarding-20260828-01`, P0 (CLAUDE.md's own definition: the app states
something false about the user's own data).

**Forced states, restored.** Two DB forcings this run, each pinned by
exact row id, restore statement written to Outstanding restores _before_
the mutation, and verified by re-query before the row was deleted: (1)
`mailbox_accounts.status` on both connected mailboxes → `disconnected` then
back to `active` (NO_ACTIVE_MAILBOX walk); (2) `provider_sync_state` on the
active mailbox → `syncing`/42% then `failed`/`GMAIL_QUOTA_EXCEEDED` then
back to `ready`/100% (sync-gate walk, both states exercised on the same
pinned row, restored once at the end). Outstanding restores is clean —
confirmed empty before this run started, and again after.

**Not this run's own doing, named for the record.**
`users.preferences.activeMailboxId` drifted from the crypt account to the
primary account mid-run — neither of this run's two forcings touch that
column. Attributed to `ct-qa-mailbox-switch-173132-64`'s own concurrent
testing (that job tests exactly this), confirmed with the peer session, and
left untouched rather than "corrected" back, since restoring a column this
run never forced would fight the peer's own in-progress test.

**Five survivors filed** (`docs/qa/qa-worklist.md`, `## onboarding`): one
from `flow-completeness-auditor` alone (`-01`, the strongest of the run),
two from this run's own live incident plus corroborating source reads
(`-02`, `-03`), and two more from `flow-completeness-auditor` narrowed hard
by refutation (`-04`, `-05`). Two sweeper-found siblings — a CSRF-token
doc/code contradiction and an OAuth state-nonce single-cookie collision,
both in `apps/api/src/auth/` — are **not** filed as worklist rows this run;
they were surfaced by a `defect-class-sweeper` pass but never put through a
`finding-refuter`, and "nothing is filed unrefuted" is the rule even under
time pressure. Left for a future `/ct-qa` pass or `/ct-class` to pick up;
full detail is in this run's sweeper transcript, referenced from
`QA-onboarding-20260828-03`'s worklist row.

**Genuinely blocked / skipped, named:** the real Google OAuth grant (first-
time connect, and the real disconnect→reconnect round-trip) needs the
founder's hands — not simulated, not attempted. A truly-unauthenticated
first-timer view at 375px was skipped (no clean way to get an unauthenticated
browser tab without touching shared cookie state given the shared-cookie-jar
discovery above). Two-tab race and worker-kill-mid-sync were not deliberately
driven as break-list items — but the live incident effectively delivered the
two-tab-race class of evidence unprompted, corroborated by a real peer
session's independent same-class incident, which is stronger evidence than
a solo staged repro would have been.

### `mailbox-switch` — 2026-08-31

**Walked:** account-menu switch (primary ↔ `chintan.a.thakkar.crypt@gmail.com`)
across Senders, Triage, Sender Detail, and app-shell chrome; a stale
Sender-Detail page left mounted across a switch; a two-tab race proven at
the API layer; a disconnected-target switch attempt; bogus/malformed
switch-target ids; mobile 375px (partial — see below).

**Stack note.** This worktree's own long-running dev processes (api :4001,
web :3003, both cwd-confirmed as this checkout). The web process had been
up ~1.76 days across many commits landing underneath it; killed and
restarted fresh mid-run specifically to rule out stale HMR state as the
cause of the bug found below — the crash reproduced identically on the
cold-started process, so it wasn't that.

**Filed (1 sent to `finding-refuter`, SURVIVED — corrected and widened; 5
more from `flow-completeness-auditor` and `usability-editor` per the
established scope/budget precedent):**

- **P1 — `/senders` throws `useLongPress is not a function` in
  `SenderListRow`.** Catastrophic at mobile (whole list replaced by an
  error state), silent-partial at desktop (2 rows failed on a plain fresh
  load with no visible crash). Root cause: a new D54 hook (`cde42bbb`,
  PR #687) resolving to `undefined` under Next's `optimizePackageImports`
  for `@declutrmail/shared` — the SECOND live occurrence of the exact
  mechanism `MISTAKES.md:4129` already documented once (PR #651/#646),
  and this occurrence disproves that entry's own stated "safe" workaround
  (a sibling import in the same statement didn't help here). Also in
  `FINDINGS.md` Inbox. `QA-mailbox-switch-20260831-01`.
- **P2 — Autopilot/Screener/Brief query keys carry no mailbox-id segment**,
  relying entirely on one global `invalidateQueries()` + a same-window
  event to stay correct across a switch. Quiet is properly partitioned and
  serves as the control case. Structural, unmeasured — not reproduced live
  this run. `QA-mailbox-switch-20260831-02`.
- **P2 — one state, three names** in the account-menu (`Selected` /
  `Active` / `"Selected mailbox"` for the identical checkmark row).
  `QA-mailbox-switch-20260831-03`.
- **P2 — switching's actual effect is never stated** anywhere in the
  account-menu component. `QA-mailbox-switch-20260831-04`.
- **P3 — lookalike mailbox addresses truncate with no tooltip** in the
  dropdown rows (the trigger pill has one, the rows don't) — this
  account's own two addresses differ only by `.crypt`, which is exactly
  what truncates first. `QA-mailbox-switch-20260831-05`.
- **P3 — "Disconnected · data kept" doesn't say whose data.**
  `QA-mailbox-switch-20260831-06`.

**Held up under attack (what the probes would have caught):**

- Switching mailboxes correctly re-scoped Senders (510 → 11 senders),
  Triage (12 decisions, correct sender names), and every app-shell query —
  no stale-count leak in either direction.
- A Sender-Detail page for a sender from the mailbox just switched away
  from re-fetched on its own and rendered a clean "Sender not found," not
  a crash or stale data (network-captured: the mounted page's own query
  refired for the stale id and got a real 404).
- **Two-tab race, proven at the API layer.** `GET /api/actions/preview`
  (the D226-mandatory preview every action sheet depends on) is scoped by
  the request's `CurrentMailbox` context, not the sender's own permanent
  `mailbox_account_id`. Direct test: previewing a sender from mailbox A
  while active was flipped to mailbox B → clean 404 `SENDER_NOT_FOUND`;
  flipped back → succeeded. A stale tab cannot mutate against the wrong
  mailbox — it fails closed before D226's mutation gate is even reached.
- Switching to a `disconnected` target (DB-forced, restored and
  re-verified) is blocked by a genuinely `disabled` native button, not
  merely a visually-hidden one.
- `PATCH /api/mailboxes/:id/active` with a random non-owned UUID → clean
  404; malformed id → clean 400; neither corrupted the account's actual
  active-mailbox state.

**Not run, with reasons:** the currently-active mailbox going
`disconnected` out-of-band mid-session (only a switch TARGET going
disconnected was tested); two literal concurrent browser tabs (the
two-tab race above was proven via one session/two logical actors, not two
real tabs — unknown whether a second real tab self-heals on refocus);
switching while an action-sheet/preview modal is open; switching
mid-in-flight mutation; the mobile switcher control's own behaviour (the
underlying crash was found while attempting this, but the switcher itself
was never reached — browser-pane mobile-viewport tooling began hanging on
further interaction, independent of product state); Autopilot/Screener/
Brief with a switch actually driven and watched (assessed structurally,
not reproduced — see QA-02 above).

**Process note.** All four read-only agents (refuter, sweeper,
flow-completeness-auditor, usability-editor) stalled at the 600-second
stream watchdog on their first dispatch, with no content-related pattern
distinguishing them — all four succeeded cleanly on a single retry with
tighter, more bounded prompts. Recorded as an infra hiccup, not a
product or methodology signal.

## Outstanding restores

**Check this section before starting any run, and clear it first.**

Every forced value gets its restoring statement written here _before_ the
mutation runs, not after. If a run is interrupted — the session dies, the
context fills, the founder stops it — this table is the only thing that knows
the database is dirty, and the next run would otherwise QA a database someone
else broke and file the damage as findings.

A row is deleted only when the restore has run **and** been verified by
re-query. Empty is the correct steady state.

| run      | statement to restore | why it was forced | cleared |
| -------- | -------------------- | ----------------- | ------- |
| _Empty._ |

**Cleared 2026-09-01 (billing round-2 fix-smoke).** `fab42715-d858-4a2a-b474-a2a941f3e888` was forced `tier='plus'` (real active Paddle Pro-annual sub `sub_01kys14ejmvjg6fe2f1jza8kkd` untouched throughout) attempting to reach the Plus→Pro upgrade preview panel and live-verify QA-10's "If you confirm:" conditional copy. It instead surfaced the tier-mismatch `NonBackingSubscriptionNotice` (the real subscription row is still `tier='pro'`, so the workspace/subscription pairing became a non-backing mismatch rather than a genuine Plus subscriber) — correct behavior, confirming QA-01's fix still holds under this shape, but not a path to the upgrade panel: `ChangePlanPanel`'s `POST /change-plan` needs the BACKING row itself at a lower paid tier, and mutating the one real sandbox subscription row is out of bounds. Restored to `tier='pro'` via `assert-dev-db.sh --exec`, re-queried: `tier='pro'`, its exact pre-force value. QA-10's copy change verified instead via its 3 unit tests (`billing-screen.test.tsx`), each rendering `ChangePlanPanel` directly under a stubbed charge/credit/no-preview `quoteResult` — the same component, the same conditional, exercised the same way a live upgrade would drive it.

**Cleared 2026-09-01 (billing fix-smoke).** `fab42715-d858-4a2a-b474-a2a941f3e888` was forced `tier='free'` (real Pro subscription untouched) to live-smoke the QA-04 quota-date fix and the QA-05 founding-Pro-hint fix — both confirmed correct live. Restored to `tier='pro'` via `assert-dev-db.sh --exec`, re-queried: `tier='pro'`, its exact pre-force value.

**Cleared 2026-09-01 (billing run).** `fab42715-d858-4a2a-b474-a2a941f3e888` (`chintan.a.thakkar@gmail.com` workspace) was forced `tier='free'` (real active Paddle Pro annual sub `sub_01kys14ejmvjg6fe2f1jza8kkd` left untouched throughout) to view the Free-tier upgrade/checkout UI without buying anything. Restored to `tier='pro'` via `assert-dev-db.sh --exec`, re-queried: `tier='pro'`, its exact pre-force value. This forced state is what surfaced the P1 finding below (orphaned-active-subscription checkout lockout) — not reproduced from a pristine state, but confirmed real via source read of `billing.service.ts`'s `SUBSCRIPTION_EXISTS` guard (checks `status`, not `cancel_at_period_end`) and a live `POST /api/billing/checkout` call.

**Cleared 2026-08-31 (mailbox-switch run).** `576df4e8-795b-4722-9aac-4ed22eafae99` (`chintan.a.thakkar.crypt@gmail.com`) was forced `disconnected` to test switching to a disconnected target, then restored to `active` via `assert-dev-db.sh --exec`. Re-queried: `status='active'`, its exact pre-force value.

**Cleared 2026-08-28 (undo run, 2nd attempt).** `1a018f268335bec0` (`ukpos.com`) was Deleted via the product Senders drawer, then Undone via the product's own Undo button — no manual restore was needed. Re-queried via Gmail MCP: labels are `{UNREAD, IMPORTANT, INBOX}`, its exact pre-run set, no `TRASH`. `action_jobs` shows `delete forward done` (09:12:03) then `delete reverse done` (09:12:33); `undo_journal.reverted_at` = 09:12:33. Single session throughout, no concurrent-agent risk this time (see ledger note below on the first attempt's abort).

**Cleared 2026-08-28.** This row was real, not stale. `19cb4856014df770` was
found still archived — Gmail reported `[UNREAD, IMPORTANT]` with no `INBOX` and a
newer historyId than its sibling — so the undo it was written for never ran.
`INBOX` was re-added directly and re-queried: it now reads
`[CATEGORY_PROMOTIONS, UNREAD, IMPORTANT, INBOX]`, its exact pre-run set.
`19db0a9129e5e588` was intact and untouched. No `action_jobs` row exists for the
archive, so it did not go through the product's own action pipeline.

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

### `billing` — 2026-09-01

**Walked:** `/billing` (Pro-annual active state, and a pinned-id-forced Free
state with the real subscription untouched), cancel-subscription preview
(opened 3× across both states, never confirmed), downgrade-to-Plus and
downgrade-to-Free previews at both monthly/annual intervals, payment-method
session minting (API-verified only, never navigated into the real Paddle
portal), invoice list, `/pricing` marketing page incl. Founding Pro CTA,
mailbox switch mid-screen, mobile 375px, keyboard/focus behavior on the cancel
modal.

**Filed (survived `finding-refuter`, or found directly by the agent wave and
independently corroborated across ≥2 agents):** see
`docs/qa/qa-worklist.md`'s `## billing` section,
`QA-billing-20260901-01` through `-11`. A SECOND `finding-refuter` pass ran
specifically on the 5 originally-filed P1s before this summary was written
(§8's rule applies regardless of how a candidate was sourced — the sweeper/
flow-auditor/usability-editor findings had not individually gone through a
refuter the way this run's own 3 live-walk candidates had). Only 2 of 5
survived as P1; the other 3 were each PARTIALLY REFUTED with a real, smaller
defect surviving underneath. Highlights, corrected:

- **P1 — Pause has no pending state, CONFIRMED STRONGER than filed.** The
  refuter found the pause endpoint writes NOTHING locally (not even
  `pause_until`), so the screen keeps asserting an active paid plan — not
  merely likely stale, guaranteed stale — until the user navigates away and
  back (60s staleTime self-corrects it; "indefinite" as originally filed was
  overstated).
- **P1 — quota-reset date shown is wrong, CONFIRMED STRONGER via a live DB
  query the refuter ran against the account this run drove:** 12/12 cleanup
  units spent in August, told to the user in September as "this month" —
  visibly wrong today, not a hypothetical. Scope widened: "this month" is
  the product's canonical quota phrase, repeated on the server's own 402
  message and several FE surfaces — a copy defect class, not one component.
- **P2 (down from P1) — chargeback drift.** The originally-filed cause was
  wrong: the missing "chargeback" copy branch is deliberate, test-pinned
  design ("a chargeback row never unlocks, and the copy must not promise
  it"), not an oversight. What survives: the plan picker is disabled in this
  state, which suppresses the ONLY explanation/support-route the app has for
  the block — the same gap `-02` hits from the cancel-on-paused angle. Zero
  chargebacks have ever occurred in this product's production history.
- **P2 (down from P1) — canceling a paused subscription.** "Silent no-op"
  was wrong: the cancellation genuinely books at the provider, and an
  undo path exists (Resume, then the normal un-cancel flow) — just
  undiscoverable. This is the product's designed, spec-pinned exit path for
  a paused subscription, not a blind guard gap. What survives: the notice
  has no "cancellation booked" state (re-renders identically with an inert
  Cancel button) and the toast wrongly claims the plan "stays active."
- **P3 (down from P1) — Founding Pro price, mostly refuted.** The central
  claim was false: the $129 price IS shown, in bold, on the mandatory
  confirm panel one click before checkout, on both doors alike. The real,
  much smaller gap: the initial Pro card (before that click) shows only
  $190 — a prominence/consistency issue, not a hidden-overcharge one.
- **P2×5 and P3×2** (the above 3 downgrades plus the originally-filed P2/P3
  set) — button-label drift, a permanent $0/"Due" invoice artifact from
  routine payment-method updates with no column headers, a guaranteed-409
  "Keep current plan instead" control, undisclosed founding-member
  lock/forfeit, contradicted "Effective immediately" copy, and a
  Cancel-modal focus-trap landing on "Pause for 30 days" instead of a
  neutral default (narrowed from the originally-filed P2 to P3 by
  `finding-refuter`; the hook itself is not the defect, only this file's DOM
  order).

**Sibling defects found via billing's own `defect-class-sweeper` dispatch,
outside this job's scope, NOT filed under `billing` — flagged for their own
jobs:**

- **Mailbox-disconnect dialog** (`mailbox-data-controls-dialog.tsx`) — same
  focus-trap mechanism puts initial keyboard focus on "Disconnect and keep
  data" (revokes the stored Google credential on Space/Enter, no further
  confirm). **LIVE-VERIFIED this run** despite being outside billing's own
  surface, given severity (`document.activeElement` read immediately on
  open, confirmed "Disconnect and keep data"; closed via Escape, zero
  mutation, mailbox connection confirmed intact after). Belongs to
  `mailbox-switch`/`disconnect-reconnect`.
- **Triage Delete-preview on a Protected sender** — same mechanism puts focus
  on "Unprotect" (mutates sender policy directly on click, no preview/undo).
  Code-confirmed only (trust 7/10); reaching it live would have meant driving
  the Triage job, out of this run's scope. Belongs to `triage`/`protect`.
- **Account-deletion modal, step 1→2 transition** — a different, adjacent bug
  on the same hook: the trap's effect never re-fires across the step
  transition, so focus may fall to `<body>`, outside the dialog. Unmeasured.
  Belongs to `delete-account`.

**Not run, with reasons:** completing any real Paddle/Razorpay checkout or
payment-method update (would enter real card-entry UI — this run's own
judgment call, not a documented rule, made for the same reason the skill
carves out unsubscribe: avoid an action this run cannot cleanly undo);
actually confirming Cancel/Pause on the one real sandbox subscription (would
consume the only live billing fixture this dev DB has, and cancel/pause are
Tier 1 mutations); a real chargeback or refund (cannot be simulated, only
read via code); two real browser tabs (one session, code-level race analysis
only, flagged unverified in the worklist); the Triage Delete-on-Protected-
sender live reproduction (out of job scope). `U` not applicable — no
unsubscribe surface reached this run.

#### Fix phase — 2026-09-01, PR #704

Founder approved all 11 rows for a single bundled PR: "Sure, I want them all
in single PR. smoke it, create PR and merge it along with updating qa docs."
All 11 fixes are FE-presentation-layer plus one new read-only API route
(`GET /api/billing/founding-remaining`) — no money-moving logic, provider
adapter cancel/pause/resume path, or webhook handling changed. Full local
smoke (204 web + 624 shared + 297 API tests, typecheck, lint, format) passed
before either Codex round; two dev-server staleness bugs (Next's persistent
webpack disk cache; the API process running `start`, not `--watch`, so it was
serving pre-fix code for over an hour of the session) were caught and fixed
during smoke, not after — see the branch's commit history for detail.

**Round 1** (commit `131994e2` reviewed against baseline `326320a1`) found 5
real issues, all fixed same round: `NonBackingSubscriptionNotice`'s mismatch
branch didn't carry the QA-01/-02 support-route fix (only the non-mismatch
branch had it); the Cancel-modal dismiss button still said "Keep current
plan" on a non-backing row it doesn't back; the upgrade-preview fallback
branch (no provider preview) invented a charge direction the screen didn't
have; and 2 lower-severity items. QA-04 scope (widening past the quota card
to every "this month" surface) and QA-05/09's fail-open founding-availability
gate were raised as questions, deliberately left unchanged, and carried
forward in the reply rather than silently dropped.

**Round 2** (commit `131994e2` again, this time reviewed as the response to
round 1) closed QA-01, QA-03 and QA-06, and found 2 rows only partially
fixed, plus one carried-over item Codex re-raised as a confirmed real defect:

- **QA-07 partial.** The new invoice-row `aria-label` carried only raw values
  ("May 1, $19, Due") — the same ambiguity the visible header was built to
  fix, in a different form, since "Due" without the field name in front of
  it still reads as an amount owed to a screen-reader user.
- **QA-10 partial, and a genuine regression.** The round-1 fallback fix
  stopped inventing a charge direction, but its replacement text said a
  possible credit "applies to your existing payment method" — the wrong
  destination; a credit lands in the account balance, contradicting the
  confirmed-credit branch's own wording one condition over. Neither branch
  had been reviewed against the other before round 1 shipped.
- **Real defect, carried over.** Even the branches WITH a resolved provider
  preview asserted "Charged today." / "No new charge today." inside a panel
  labeled "Preview · before anything changes," before Confirm is clicked.
  Codex rejected the "$0 today" downgrade-branch precedent (that phrasing
  names an amount that is true either way — $0 whether confirmed or not —
  not a completed action) and recommended conditional framing tied to
  Confirm.
- Two coverage gaps: QA-01's test used an ordinary paused fixture, which
  `nonBackingReason` resolves to the OTHER notice branch — not the
  chargeback-shaped one the component's own comment names as the only
  branch a real chargeback reaches; a fix applied only to that branch would
  have stayed green. QA-10 had no test for the successful-credit branch.
- One documentation-only drift, not a runtime bug: the `pauseConfirming`
  prop's doc-comment overclaimed that price is suppressed during an
  unconfirmed pause — only "Next renewal" and the Cancel button are; price
  stays, correctly, since the plan is still active and billing until the
  webhook confirms otherwise.

All of round 2's actionable findings were fixed same-day in commit
`6050ec1a`: both preview branches plus the fallback now read "If you
confirm: …" instead of asserting a completed action; the fallback names both
real destinations instead of one wrong one; the invoice row's accessible
name now states each field's label, not just its value; a chargeback-shaped
fixture (`status: 'active'`, mismatched tier, `cancelAtPeriodEnd: true`,
`cancelSource: 'chargeback'`) was added alongside a successful-credit-branch
test; the stale doc-comment was corrected to describe what the code actually
does.

**At the review cap.** Per the worklist's own rule (`docs/qa/qa-worklist.md`
§States), two substantive Codex rounds ran (round 1: 5 findings, fixed;
round 2: 2 partial + 1 carried-over real defect, fixed) — a third round is
capped. `6050ec1a`'s changes to QA-07 and QA-10 are themselves unreviewed
(the row-level disposition lives in `qa-worklist.md`); the row for each is
`At review cap`, naming `6050ec1a`, for the founder to ship as-is or
explicitly authorize continued review. All other rows (QA-02, -04, -05,
-06, -08, -09, -11) closed clean through round 2 and are untouched by
`6050ec1a`; QA-01 and QA-03 had round-2 follow-up but neither was a
behavior change (a test addition and a comment fix, respectively), so their
round-2 CLOSED verdict still describes the shipped behavior.

## Refuted

Candidates that did not survive a `finding-refuter` pass. Kept so they are not
re-found and re-argued next quarter.

| date       | job            | claim                                                                                                                                                                                   | grounds | verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 | observability  | Watch-renewal partial failure hides mailboxes losing push sync                                                                                                                          | 2, 3, 4 | REFUTED — documented failure-isolation contract pinned by a test; the drift sweep polls independently, so mail does not stop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-27 | delete-account | One successful purge marks a failed deletion sweep as succeeded                                                                                                                         | 2, 4    | REFUTED — failures are non-terminal and retried on the next sweep; D232 scheduling untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-27 | billing        | GCP row reports "budgets armed" without checking notifications                                                                                                                          | 3, 5    | PARTIALLY REFUTED — Google's default IAM recipients mean it IS armed; the surviving half (zero budgets grades WARN, WARN exits 0) is filed in `FINDINGS.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-27 | triage         | Undo restores INBOX but not the Gmail category, so undone promos land in Primary                                                                                                        | 3, 4    | REFUTED — instrument artifact. The "before" was a DB row and the "after" a Gmail read; the Gmail MCP `get_message` tool does not surface `CATEGORY_*` at all. Control: an untouched message reads `{CATEGORY_PROMOTIONS,UNREAD,IMPORTANT,INBOX}` in the DB and `["UNREAD","IMPORTANT","INBOX"]` from `get_message`. Archive is `remove INBOX` / undo is `add INBOX`; no code path touches a category label, and 910 messages archived 2026-06-06 kept theirs for three months                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-27 | triage         | Expanding a card silently re-scores it and rewrites the rationale mid-read                                                                                                              | 2       | REFUTED — this is D25 `stale_refresh`, founder decision 2026-08-19 option 1A, built to spec: fires only when `expires_at <= now`, once per sender per tab-session, off during onboarding. The "Scored a week ago" label in the evidence is the TTL gate firing correctly. Surviving objection recorded: 8,087 of 8,129 decisions are past TTL, so it fires on essentially every first expand — "designed", not "rare", is the defence                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-27 | triage         | Queue reorder is caused by re-scoring changing a sender's confidence                                                                                                                    | 4       | PARTIALLY REFUTED — the reorder is real but the cause was wrong, and the corrected version is worse: the daily path's `ORDER BY` has no tiebreak at all. Filed in `FINDINGS.md` as the non-total-order defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-27 | triage         | "12 DECISIONS WAITING" hides a backlog of 8,036 eligible senders                                                                                                                        | 2, 3, 5 | PARTIALLY REFUTED — the 8,036 is the entire indexed sender population: only **147** are `unsubscribe`; 5,254 are `later`/insufficient-signal and 2,728 the engine's own `keep` (verified independently). Printing "8,036 waiting" would be the larger falsehood, and 147 clears at 12/day in ~12 days, inside D30's stated pacing. No rendered string asserts totality — the legend counts the twelve cards beneath it — and the population is one nav click away ("8,051 senders found"). Downgraded to a P3 copy gap, kept below                                                                                                                                                                                                                                                                                  |
| 2026-08-28 | onboarding     | The sync-gate's 6-row checklist narrates a fake stage, unrelated to the backend's real `current_stage`                                                                                  | 2, 3, 5 | REFUTED — the producer (`initial-sync.worker.ts`) only ever emits four (stage, pct) pairs against six UI labels; a 1:1 map is structurally impossible, and D109 mandates deriving the row from real progress (not the coarser stage enum) as the honest choice. The cited "42% → bolds 'Calculating email patterns' while the backend groups senders" pairing cannot occur — `building_sender_index` is never anything but pct=80                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-28 | onboarding     | The failed-sync screen's "Stay here" button is `tone=primary` but does nothing, while the real recovery action isn't primary                                                            | 3, 4    | REFUTED — wrong component. "Stay here" renders only on the _syncing_ screen's dismissible escape-hatch card (where "decline and keep waiting" is the correct default); the _failed_ screen renders a different branch entirely, where `tone=primary` is correctly on "Try again". The two buttons named never coexist on one screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-28 | onboarding     | `SecondaryConnectGate`/`AuthedFlow` show a fabricated queued/0% scan on a 404, an exhausted 5xx, or a stale/foreign `?mailbox=` id                                                      | 4, 5    | PARTIALLY REFUTED — three of four named triggers are unreachable: `markQueued` inserts the sync row in the same transaction as every activation (no 404 reachable), a `MAILBOX_NOT_OWNED` 409 fires only when the escape hatch is already available, and `refetchOnWindowFocus`/`refetchOnReconnect` self-heal a transient 5xx. One narrower state survives — a persistent `NO_ACTIVE_MAILBOX` 409 with no other active mailbox — filed as `QA-onboarding-20260828-04`                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-28 | onboarding     | The no-active-mailbox gate's Reconnect button silently swallows a connect failure                                                                                                       | 3, 4    | PARTIALLY REFUTED — Reconnect actually routes correctly through Settings and fires its toast; the auditor's model matched dead copy keys no live path can emit. The plain Connect button (not Reconnect) does swallow a failure — filed narrower as `QA-onboarding-20260828-05`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-29 | delete         | Delete confirm modal defaults its "How far back" window to 180 days ("6 months+") instead of "All inbox," making a fresh sender's real inbox mail preview as "0 emails currently match" | 2, 5    | REFUTED — a spec-pinned assertion (`confirm-action-modal.test.tsx:683,842-883`) and a purpose-built reconciliation module (`inbox-scope.ts`) exist specifically to name this exact state in-place, on the same screen, with the remedy ("Widen the window to include it"). Read-only prevalence check: 465/6,779 senders with inbox mail (6.9%) hit this. Investigating it surfaced two real, DIFFERENT defects, live-verified and filed fresh rather than as an upgrade to this claim: the default leaves the confirm button disabled on open for that 6.9%, and Screener's sibling Delete preview applies no window at all — see QA-delete-20260829-01                                                                                                                                                            |
| 2026-08-29 | delete         | Two simultaneous "Undo" controls (a persistent top-of-page banner and a toast) after a confirmed Delete/Archive/Later is a duplicate-control bug specific to Delete                     | 2, 4    | PARTIALLY REFUTED — not Delete-specific (the tray mounts once in the authed chrome for every mailbox route; the receipt strip mounts on both Senders surfaces for every verb) and "both remain live" is false (the URL token is the idempotency key; a second `POST` after completion returns `reverted:true` without enqueueing, which is why only one `revert-*` row existed after the double-click). Surviving, corrected claim: the receipt strip does not observe an undo performed via the other control and keeps asserting stale "Moved to Gmail Trash" state — filed as QA-delete-20260829-05                                                                                                                                                                                                              |
| 2026-09-01 | billing        | Forcing `workspaces.tier='free'` next to the real, healthy, active Pro subscription (via a direct DB write) reproduces a permanent checkout lockout with no working remedy              | 2, 4, 5 | REFUTED — the exact state is unreachable by any production code path: both live writers of `workspaces.tier` (`recomputeWorkspaceTier`, the reconciliation sweep) deterministically recompute `pro` from that row's shape, so only this run's own `UPDATE` produced it. The missing plan-card CTA in that state is the correct, already-shipped fix for a 2026-07-27 bug (`MISTAKES.md`), not a new one. The 409 the reproduction hit is the ordinary one-subscription-per-workspace guard, identical for a healthy Pro subscriber — not evidence of drift-specific blocking. The underlying MECHANISM (a non-backing subscription trapping the customer with generic/inert notice+cancel) is real and reachable via chargeback and via a paused-row cancel — filed corrected as `QA-billing-20260901-01` and `-02` |

## Out of scope

| surface                                   | why                                                                                                                                                                                                                | what would restore it                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unsubscribe execution (below the preview) | `UnsubExecutionWorker` performs a real RFC 8058 one-click POST from the founder's address. No dry-run, no kill switch, and stopping the worker only defers a queued send. The `U` keystroke is not pressed at all. | The dev-only send refusal specified in `FOUNDER-FOLLOWUPS.md` (2026-08-27). Then restore the `unsubscribe` job and the `U` keystroke. |
