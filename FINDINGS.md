# Findings

Running capture of things noticed in passing that are **not** blocking the
task at hand — product friction, UX doubts, telemetry gaps, deferred
engineering. Drop it here, keep moving, triage later.

This is the fifth artifact alongside `LEARNINGS.md` (what worked),
`MISTAKES.md` (what broke), `FOUNDER-FOLLOWUPS.md` (founder-only actions
outside the code), and `IMPLEMENTATION-LOG.md` (D-decision status). A
finding is **an open question about the product or the code** — it has no
verdict yet. Once it has one, it either becomes work (PR / D-candidate),
a followup (founder's hands), or a documented no.

---

## How to use this

**Founder:** say `/finding <what you saw>` in any session. Nothing to format,
nothing to open. A screenshot plus a sentence is enough.

**Agent:** on `/finding`, append the item to **Inbox** immediately — date,
surface, the founder's words. Do not triage in the same breath and do not
interrupt whatever else is in flight; capture is cheap, triage is not.

On `/finding triage` (or any explicit ask), work the Inbox: go read the
actual code, form a real verdict rather than a restatement, assign a
priority, move it into the right section with an `F###` id. Never triage
from intuition — if the verdict rests on a file, cite `path:line`.

**Nothing is deleted.** Done and Won't-do keep their entries — the trail is
the point.

### Priority

| P   | Means                       | Timing                               |
| --- | --------------------------- | ------------------------------------ |
| P0  | Launch blocker              | Before public launch. Non-negotiable |
| P1  | Real friction, not fatal    | Launch week                          |
| P2  | Worth doing                 | Backlog, no clock                    |
| P3  | Idea — needs evidence first | Revisit when there's usage data      |

### Status

`Open` → `In progress (#PR)` → `Done YYYY-MM-DD` or `Won't do YYYY-MM-DD + reason`

---

## Inbox (untriaged)

- **2026-08-07** · `/onboarding` step 5 — **confirmed live, on a real first-run.**
  Founder onboarded a beta user end to end and step 5 pinned five
  senders that ALL have single-digit lifetime email counts, after the user had
  picked "reduce newsletters" on step 4. Founder's words: _"very diminishing
  value as a first time user."_ This is the same defect the Codex item below
  describes, now observed rather than reasoned about — and it lands on the one
  screen where the product has to prove itself. Note what production actually
  runs: `origin/main` has NO payoff floor at all, so any eligible sender can be
  pinned including one-message senders. A fix exists but is UNCOMMITTED in this
  checkout (another session added `FIRST_TRIAGE_MIN_RECEIVED = 10` /
  `FIRST_TRIAGE_MIN_RECENT = 3` plus a pin-version bump so existing users
  re-pin), and the Codex item below is a critique of THAT fix. So there are
  three states in play — shipped (no floor), uncommitted (arbitrary floor),
  proposed (outcome ranking). Triage all three together.
  **Resolved 2026-08-08 (#477):** outcome ranking shipped; the arbitrary
  `10`/`3` floor was deleted rather than merged. The beta user's account
  itself is production-only and was never reachable from this checkout.

- **2026-08-07** · `/settings/senders` — **the protected-senders list never says
  WHY a sender is protected.** Three of the four `protection_reason` values are
  automatic (`replied`, `starred`, `gmail_important`); only `user_defined` is
  the user's own doing. The list renders avatar, name, email and a Manage
  button — no reason. CLAUDE.md §2.6 requires the opposite: "Show the exact
  reason and preserve a manual Unprotect as a sticky override." Found while
  fixing copy on that page that wrongly called every row "senders you've told
  us to leave alone"; the copy is fixed, the missing reason is not. The data is
  already there (`sender_policies.protection_reason` + `protection_set_at`) and
  `screener/data.ts:93` already renders reason strings, so this is a display
  gap, not a modelling one.
  **Resolved 2026-08-09 (#483):** every row on `/settings/senders` now names
  the exact reason (via the shared `protectionReasonLabel`), shows the unread
  inbox mail the protection is shielding, and offers an in-place Unprotect
  with the D245 sticky caveat —
  [senders-policies-screen.tsx](apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx).

- **2026-08-07** · Triage — **"four daily verbs" is spec vocabulary, shipped.**
  Founder hit this string in production: _"Looking for Delete? Triage keeps to
  the four daily verbs — deleting a sender's mail lives on Senders and Sender
  Detail."_ Two separate problems. (1) Nobody says "four daily verbs" — it is
  our ADR-0019 language leaking into product UI. (2) The founder's expectation
  was that Delete works everywhere, and as of the 2026-08-06 founder amendment
  to ADR-0019 it does: Triage now renders the full K/A/U/L/D set directly. So
  this copy is describing a constraint that no longer exists. Both are already
  addressed by uncommitted work in this checkout — `why-no-delete.tsx` and its
  story are deleted — but nothing is merged, so production still shows it.
  Founder's broader ask: run a public-facing copy audit to find every sibling
  of this, not just this one string.
  **Resolved 2026-08-08:** Delete on the Triage toolbar shipped in #476;
  `why-no-delete.tsx` is gone. The copy sweep is this PR. The broader audit
  — every sibling string, not just this one — is still open.
  **Audit run 2026-08-10:** swept every string literal under
  `apps/web/src/features` + `packages/shared/src/{copy,components}` for
  spec vocabulary (verb-registry phrasing, D-numbers, ADR references,
  lifecycle/enum/composite/registry jargon) with rendered-context
  filters. Zero true siblings — "four daily verbs" was the lone leak.
  Every D-number/jargon hit is a comment, a telemetry `reason:` value,
  or an aria id. Nearest borderline: the landing page's "One verdict per
  sender covers everything they sent." — plain-English meaning,
  founder-reviewed through the D250 rounds; left as-is.

- **2026-08-06** · `/onboarding` step 5 (first triage) — the pinned-row
  thresholds are unexplained cutoffs. `10 received` was an emergency proxy for
  "enough cleanup to notice", picked to eliminate the 1–2-message rows; worse,
  `received` counts INDEXED mail, not mail currently in Inbox, so it does not
  measure what Archive/Later will actually move. `3 recent` at least has a
  rationale (≈ one email/month over 90d = recurring, not one-off). Sorting
  alone is not enough — the best sender with two messages still ranks first, so
  we need both a ranking and a definition of "worth one user decision".
  Proposed replacement, goal-specific outcome ranking: _reduce newsletters_ →
  usable unsubscribe channel → recent cadence → low read rate → current Inbox
  count → confidence; _clear promotions_ → Gmail Promotions category → current
  Inbox count → low read rate → confidence; _protect important_ →
  protection/reply evidence → high read rate → recency. Show fewer than five
  rather than padding. Use the indexed current-Inbox count for immediate
  cleanup value (the confirmation preview still re-checks Gmail live). Open
  sub-question: keep "at least monthly" as an explicit product definition of
  recurring, or use an exact rolling-30-day count. Deliberately not changed
  yet — replacing one unexplained cutoff with another is not progress.
  _(via Codex; arrives pre-analyzed, not yet verified against code by this
  session. Note: `onboarding.service.ts` has uncommitted changes from another
  session — triage this against whatever lands.)_

- **2026-08-06** · infrastructure — **there is no staging environment.**
  Verified: only the `declutrmail-ai-prod` GCP project exists, only the
  `declutrmail-api` / `declutrmail-worker` production Cloud Run services exist,
  and
  [deploy-cloud-run.yml:50](.github/workflows/deploy-cloud-run.yml:50) deploys
  `main` straight to production, stating outright that preview backends are not
  configured. A Vercel Preview is not a substitute — production CORS, the OAuth
  redirect, and `.declutrmail.com` session cookies stop it working as an
  authenticated app. A real one needs: a `declutrmail-ai-staging` GCP project;
  separate DB, Redis, KMS keys, Pub/Sub, secrets, API and worker; fixed origins
  (`app.staging.declutrmail.com`, `api.staging.declutrmail.com`); a staging
  Google OAuth client with its callback registered; a Vercel staging deployment
  pointing `NEXT_PUBLIC_API_URL` at the staging API; billing disabled with
  Paddle sandbox only and PostHog unset; and a staging GitHub deployment
  workflow/environment. The same Gmail account can authorize staging, but Gmail
  actions stay REAL — and `users.watch` sets or UPDATES the mailbox's watch, so
  a staging watch can replace production's push destination. Keep Gmail Pub/Sub
  disabled when reusing that account and rely on initial/manual sync for smoke
  tests. Today's isolated-testing answer remains local OAuth via
  [dev-auth.sh](scripts/dev-auth.sh), which resets only the local database —
  but any Archive/Delete/Unsubscribe there still changes the real mailbox.
  _(via Codex)_

---

## P0 — launch blockers

### F010 — "You replied N×" counts thread membership, not replies; 57 senders are Protected on replies that never happened

**Found:** 2026-08-19 · founder question while reviewing the senders surface
**Observed (founder):** _"Can you check for the calculations of Replied as
well? Is that correct?"_ — the stat renders as `0×` / `5×` / `11×` across the
grid card, the table column and the row detail.

**Verdict — the format is right and the number is wrong.**

Reply attribution joins `mail_messages` to itself on `provider_thread_id` and
counts `COUNT(DISTINCT m2.id)` where `m2.is_outbound`
([initial-sync.worker.ts](packages/workers/src/initial-sync.worker.ts) and the
identical statement in
[incremental-sync.worker.ts](packages/workers/src/incremental-sync.worker.ts)).
There is no predicate tying the outbound message to the sender it is credited
to. So **every outbound message in a thread counts as a reply to every inbound
sender in that thread.**

`mail_messages.recipient_emails` already holds To + Cc
(`[...parseRecipients(meta.to), ...parseRecipients(meta.cc)]`) and is populated
on 5,535 of 5,539 outbound rows, which makes a stricter definition — "an
outbound message addressed to this sender" — directly measurable. Measured on
the founder's mailbox:

|                                                      | senders       |
| ---------------------------------------------------- | ------------- |
| have `replied_count > 0`                             | 1,041         |
| stored count exceeds mail actually addressed to them | **390 (37%)** |
| show replies while never being addressed at all      | **238**       |
| …of those, crossed the ≥3 auto-protect threshold     | **57**        |

Concrete rows the product currently asserts:

| Sender                                                   | Claim                                |
| -------------------------------------------------------- | ------------------------------------ |
| `mailer-daemon@googlemail.com` (Mail Delivery Subsystem) | you replied **14×**                  |
| `camden-addison-no-reply@realpage.com`                   | **11×**                              |
| `calendar-notification@google.com`                       | **11×**                              |
| `mehuln@google.com`                                      | **40×**, from **1** received message |

You cannot reply to mailer-daemon. The bounce lands in a thread that already
contains outbound mail, and the join credits it.

**Why this is P0 rather than a display nit.** `replied_count ≥ 3` is a D245
automatic-protection trigger, and Protected senders are excluded from bulk and
automatic mail-changing actions. Of 460 senders protected with
`protection_reason = 'replied'`, **57 have no outbound mail addressed to them
at all** — permanently shielded junk, on evidence of a relationship that does
not exist. D245's own wording is "at least three replies… a reply is a two-way
relationship"; a bounce notification is not one.

This is the mirror image of F008/F009: same class (asserting what we do not
know), opposite direction — over-protecting instead of over-unsubscribing.
`hasReplied` also feeds a Keep verdict in the cascade.

**The fix is not a one-liner, which is why it is not bundled here.** Switching
to a pure recipient predicate kills every phantom above, but risks
false NEGATIVES where the reply legitimately went somewhere else — a
`Reply-To` address, or a mailing list where the reply goes to the list rather
than the original sender. Losing a reply attribution UN-protects a sender,
which is the dangerous direction. The candidate rules, in the order worth
measuring:

1. **Recipient-based** — outbound is a reply to S iff S's address is in its
   To/Cc. Kills all 238 phantoms. Needs the `Reply-To` false-negative measured
   before it can be trusted.
2. **Recipient-based with a `Reply-To` fallback** — also credit S when the
   outbound is addressed to the `Reply-To` S advertised. Requires storing
   `Reply-To`, which is a D7 allowlist amendment and its own decision.
3. **Keep thread attribution for the DISPLAY, gate only the PROTECTION on the
   stricter rule.** Smallest blast radius: nothing loses a shield except the
   57 that never earned one, and the visible count stops being the thing that
   grants protection.

**Recommendation:** (3) first — it removes the safety defect without risking a
single legitimate protection — then measure (1) before changing what the card
shows.

**Not changed in PR #566.** Auto-protection is a CLAUDE.md §9 stop condition
and this un-protects real senders; it needs founder ratification and its own
change.

**Priority:** P0 — a safety mechanism firing on fabricated evidence, on the
same surface as F008.
**Status:** Open

---

### F008 — "Marked read" is a 30-day rate wearing a lifetime label; the grid escalates it to "Never"

**Found:** 2026-08-18 · `/senders` sender preview modal + grid card
**Observed (founder, verbatim):** _"marked read seems buggy as well. Check my
gmail for etherscan. It shows marked read as 0% although I can see one email
has been read."_

**Verdict — the observation is right, the named cause is not. The tile is
arithmetically correct and semantically false.**

`Marked read` is a **rolling 30-day** ratio, not a lifetime one:
`last30dReadCount / last30dMsgs`, both live correlated subqueries over
`mail_messages`
([senders.read-service.ts:184-202](apps/api/src/senders/senders.read-service.ts:184)),
divided by `computeReadRate`
([senders.read-service.ts:1669](apps/api/src/senders/senders.read-service.ts:1669)),
window constant `WINDOWS.VOLUME_DAYS = 30`
([thresholds.ts:46](packages/shared/src/senders/thresholds.ts:46)). The FE
renders it at
[sender-row-detail.tsx:139-152](apps/web/src/features/senders/table/sender-row-detail.tsx:139).

Measured on the founder's own synced mailbox:

| noreply@etherscan.io | messages | read  | rate                         |
| -------------------- | -------- | ----- | ---------------------------- |
| lifetime             | 1,872    | 1,806 | **96.5%**                    |
| last 90d             | 50       | 0     | 0%                           |
| last 30d             | 9        | 0     | **0% ← what the tile shows** |

So the product tells the user it has never seen them read a sender whose mail
they have read 96.5% of since 2017.

**Why it reads as a lie rather than a shorthand.** The five stat cards are
`Received` (lifetime) · `In inbox` (now) · `Last received` · `Marked read`
(**silently 30d**) · `Last 30 days` (**explicitly** 30d). The only card whose
window is unstated is the only windowed one, and it sits directly beneath a
lifetime `Received 1,872`. Every surrounding cue says lifetime.

**The grid copy is worse — it makes an absolute claim a suffix cannot repair.**
`readBucket(0)` renders the label **"Never"** with aria "Read rate: never
marked read" ([fact-language.tsx:82](apps/web/src/features/senders/fact-language.tsx:82)),
and when `read <= 5 && monthly >= 8` the row pushes **"Almost never marked
read"** ([sender-list-row.tsx:67](apps/web/src/features/senders/table/sender-list-row.tsx:67)).
Etherscan (read 0, monthly 9) hits that branch exactly. A percentage can be
qualified by adding "in 30d"; "Never" cannot — the wording has to change.

**Blast radius, same mailbox:** 615 senders have mail in the last 30 days;
**332 of them render 0%**, and **46 of those have a lifetime read rate ≥ 50%** —
i.e. 46 flat self-contradictions, not 1. (An independent 90-day cut: 115 of 387
active senders at 0%, 12 contradicting lifetime.)

**Ruled out, with the evidence.** These were each tested rather than assumed:

- **Not a `null → 0` coercion.** `readRate: number | null`
  ([senders.ts:129](apps/web/src/lib/api/senders.ts:129)) is passed through
  deliberately — `monthlyVolume ?? 0` is coerced on the adjacent line and
  `readRate` is not
  ([adapters.ts:100-103](apps/web/src/features/senders/api/adapters.ts:100)) —
  and `null` renders `—`. This path is clean.
- **Not broken label sync.** `users.history.list` is called with no
  `historyTypes` filter, so `labelsAdded` / `labelsRemoved` come back and are
  dispatched into `handleLabelChange`
  ([incremental-sync.worker.ts:787-840](packages/workers/src/incremental-sync.worker.ts:787)),
  which keeps `is_unread` in lockstep with `label_ids`. A cursor older than
  Gmail's 7-day retention returns `cursorTooOld` and re-enqueues a full sync
  rather than advancing
  ([incremental-sync.worker.ts:371-382](packages/workers/src/incremental-sync.worker.ts:371)),
  and that re-sync refreshes `isUnread` on upsert
  ([initial-sync.worker.ts:1432](packages/workers/src/initial-sync.worker.ts:1432)).
  The design is sound.
- **Not rounding — but rounding is a real latent sibling.** `computeReadRate`
  rounds to 2 decimals _before_ the FE multiplies by 100, so any true rate below
  0.005 collapses to a measured `0%` (and to "Never"). It needs >200 messages in
  30 days for one read; no sender currently hits it. Fix it in the same change.

**Sub-claim raised and then disproved — recorded so it is not re-raised.** Two
messages Gmail reported as read were still `is_unread = t` with
`updated_at == created_at`, which looked like frozen read state. The local
worker was down at the time. **Re-tested with the worker up: `1a00acef48761965`
flipped to `is_unread = f` at 22:49:47, within seconds of boot.** Label sync is
correct; that divergence was worker downtime, not a defect. (`19e6d24cb7266503`,
indexed 2026-05-27, remains stale — a history-gap casualty from 83 days of
intermittent local worker, recoverable only by the `cursorTooOld` full re-sync.
A dev-environment artifact, not a production defect.)

**Post-fix reality check.** After that catch-up the tile reads **11%** against a
lifetime **96.5%**. The number moved; the false impression did not. This
confirms the defect is the window/label mismatch and not the underlying data.

**Recommendation.** Rename to the window it actually measures, and make the
grid stop asserting lifetime facts from a 30-day sample. `Read rate · 30d`
(or show `1,806 / 1,872 lifetime` and drop the window entirely — the tile row
is otherwise all-lifetime). `readBucket(0)` must not say "Never" when lifetime
disagrees. Fix the pre-multiply rounding in the same PR.

**Priority:** P0 — the trust wedge asserting a falsehood about the user's own
mail, on the primary surface, found by the founder inside five minutes of real
use. Same defect class as the documented UI-truth bug, in its _label_ form
rather than its `null → 0` form.
**Status:** Open

---

### F009 — `sender_timeseries.read_count` is frozen at index time and feeds Unsubscribe recommendations through a `null → 0` coercion

**Found:** 2026-08-18 · while triaging F008 (not observed by the founder)
**Observed:** The recommendation scorer does not use F008's live
`mail_messages` path. It sums `sender_timeseries.read_count` over 90 days
([score.worker.ts:567-585](packages/workers/src/score.worker.ts:567),
[autopilot-signals.ts:137-191](packages/workers/src/autopilot-signals.ts:137)).

**Verdict — two defects compounding, and this one moves mail.**

1. **The counter is write-once.** `read_count` is incremented only at
   message-insert time
   ([initial-sync.worker.ts:1370-1379](packages/workers/src/initial-sync.worker.ts:1370),
   [incremental-sync.worker.ts:709-725](packages/workers/src/incremental-sync.worker.ts:709)).
   `handleLabelChange` never touches it, and the incremental post-pass
   reconciles `reply_count` only ([incremental-sync.worker.ts:877-900](packages/workers/src/incremental-sync.worker.ts:877)).
   A message read _after_ it was indexed is never counted as read here.
   **Measured:** over a 90-day window, 2,005 sender-months compared against a
   live recount of `mail_messages` — **242 (12%) disagree**, undercounting reads
   by 76. Unlike F008's tile, this cannot self-heal from a live query.

   **Reproduced live, 2026-08-18 22:49.** A single etherscan message was read in
   Gmail; the incremental worker applied the label change and flipped
   `mail_messages.is_unread` within seconds. In the same instant the live 30-day
   aggregate moved `0/9 → 1/9`, while `sender_timeseries` for `2026-08` stayed at
   `volume 9, read_count 0`. One state change, two readers, one of them wrong —
   and the wrong one is the reader that feeds the Unsubscribe cascade.

2. **Unknown is coerced to a measured zero.** Both call sites do
   `volume > 0 ? reads / volume : 0`
   ([score.worker.ts:585](packages/workers/src/score.worker.ts:585),
   [autopilot-signals.ts:191](packages/workers/src/autopilot-signals.ts:191)),
   which feeds `readRate90d < 0.2 → +0.15` and `< 0.05 → +0.10` toward
   Unsubscribe ([score-cascade.ts:357-358](packages/workers/src/score-cascade.ts:357)).
   A sender with no timeseries row scores as "never read" and gets pushed
   toward Unsubscribe on evidence that was never gathered.

This is the textbook `null → 0` form of the UI-truth class — the exact one
F008's display path correctly avoids — except here it does not merely display a
wrong number, it **recommends a destructive verb from one**.

**Recommendation.** Make the 90-day read rate `number | null` end to end and
let a null abstain from the cascade rather than score as zero. Separately,
either reconcile `read_count` in `handleLabelChange` or drop the counter and
read the same live `mail_messages` aggregate the tile already uses — a stored
counter that no code path can correct is not worth its drift.

**Priority:** P0 — a destructive recommendation derived from a fabricated
signal. Higher real severity than F008, which only misreports.
**Status:** Open

---

## P1 — launch week

### F006 — Sender surfaces show only relative time; the absolute instant is already on the wire and thrown away

**Found:** 2026-08-18 · sender detail "Recent messages" + `/senders` preview modal
**Observed (founder, verbatim):** _"instead of x month ago, we should give
concrete timestamp. Even in recent subjects, there is no timestamp at all.
This would fill the trust gap if user is trying to verify something. I was
doing exactly same and felt like this."_

**Verdict — correct, and cheaper to fix than it looks: this is a render-layer
omission, not a data gap.**

The full ISO instant survives the entire chain untouched — Gmail
`internalDate` → `mail_messages.internal_date` (timestamptz, NOT NULL,
[mail-messages.ts:94](packages/db/src/schema/mail-messages.ts:94)) →
`internalDate: row.internalDate.toISOString()`
([senders.read-service.ts:1494](apps/api/src/senders/senders.read-service.ts:1494))
→ `receivedAt: row.internalDate`
([adapters.ts:161](apps/web/src/features/senders/api/adapters.ts:161)). No
serializer or adapter drops it.

Where it dies:

| Surface                      | Has the ISO?               | Renders it?                                                                                                                                                             |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent messages row          | yes (`message.receivedAt`) | no — `relTimeFromIso` at [recent-messages.tsx:228](apps/web/src/features/senders/detail/recent-messages.tsx:228), no `title`, no `<time>`                               |
| Recent subjects (peek modal) | yes, then **discarded**    | no — `.slice(0,3).map(m => m.subject)` at [sender-row-detail.tsx:68-70](apps/web/src/features/senders/table/sender-row-detail.tsx:68); the type is `subjects: string[]` |
| "Last received" tile         | yes (`s.lastSeenAt`)       | no — `relTimeLabel(s.lastDays)` at [sender-row-detail.tsx:138](apps/web/src/features/senders/table/sender-row-detail.tsx:138)                                           |
| Confirm-action preview       | yes                        | **yes** — `<time dateTime>` at [confirm-action-modal.tsx:1543](apps/web/src/features/senders/confirm-action-modal.tsx:1543)                                             |
| Activity feed                | yes                        | **yes** — relative label + `title={absolute}` at [activity-screen.tsx:2284](apps/web/src/features/activity/activity-screen.tsx:2284)                                    |

**The precedent is already ours, decided for this exact reason.** The
confirm-action preview's subject sample was deliberately widened from
`string[]` to `{subject, date}[]` because "the date is how the reader checks it
respects the window they picked" (MISTAKES.md 2026-07-27). Recent subjects is
the same component pattern that never got the same treatment.

**A live spec violation surfaced alongside it.** D46 mandates for decision
history: _"Date (relative for ≤7d, absolute for older)"_
([Implementation-Plan.md:1679](docs/execution/Implementation-Plan.md:1679)).
The component that implements it correctly (`decision-history.tsx:38`) is
**unmounted**; the shipped `DecisionTimeline` calls an unconditional
`formatRelative` with no absolute branch and no `title`
([sender-detail-page.tsx:1368](apps/web/src/features/senders/detail/sender-detail-page.tsx:1368)).
That is drift, not a new decision.

**Constraints any fix must respect.**

- **D41 specifies the relative label** for the recent-message row
  ([Implementation-Plan.md:1592-1610](docs/execution/Implementation-Plan.md:1592)).
  Adding `title=` / `<time dateTime=>` is additive and needs no amendment;
  changing the _visible_ string does.
- **Hydration determinism (D200).** `eslint.config.mjs:66-102` bans unpinned
  `toLocale*String()` / `Intl.*Format(undefined, …)` across `apps/web`. Any
  absolute label must pin `'en-US'` **and** pass an explicit `timeZone` from
  `useUserTimeZone()` ([use-me.ts:96](apps/web/src/features/auth/api/use-me.ts:96)),
  or sit behind `useNow()` ([use-now.ts:18](apps/web/src/lib/use-now.ts:18)).
  Note `relTimeFromIso` already defaults `now = new Date()` **in a render body**
  on a server-prefetched route — pre-existing hazard in the file being touched.
- **No privacy work required.** The timestamp is already a declared, stored,
  user-disclosed field — `received-date` in the D7 registry
  ([gmail-data-inventory.ts:149-162](packages/shared/src/contracts/gmail-data-inventory.ts:149)),
  on the same footing as the snippet beside it. Same row, same query, zero new
  Gmail calls, no registry amendment.

**Recommendation.** Additive and small: `<time dateTime={iso} title={absolute}>`
on the recent-message rows, widen `RowDetailSubjects` to carry the date and
render it like the confirm-action preview already does, and put the absolute
value on the "Last received" tile. Close the D46 drift in the same PR. There is
no shared date utility in `packages/shared` — five per-feature relative
formatters have been duplicated instead; promoting one is optional here and
should not be smuggled into this change.

**Priority:** P1
**Status:** Open

---

### F007 — The hamburger's inline `display` outranks its media query, so every desktop session can open a duplicate sidebar over the real one

**Found:** 2026-08-18 · app shell top bar, every authed route
**Observed (founder, verbatim):** _"hamburger menu seems like buggy"_

**Verdict — real, one line, and shipped since 2026-07-14.**

`tokens.css` hides the hamburger above the 900px breakpoint and shows it below
— correctly:

```
.dm-topbar-hamburger { display: none; }                       /* tokens.css:367 */
@media (max-width: 900px) { .dm-topbar-hamburger { display: inline-flex; } }  /* :380 */
```

But the button carries `display: 'inline-flex'` as an **inline style**
([app-shell.tsx:185](packages/shared/src/shell/app-shell.tsx:185)). A style
attribute outranks any non-`!important` author rule, so the `display: none`
never applies and **the hamburger renders at every width**, including the
~2000px viewport in the screenshot.

**What clicking it does — and why it looks like nothing happened.** There are
two separate sidebar instances. The desktop one
([app-shell.tsx:99-101](packages/shared/src/shell/app-shell.tsx:99)) does not
read `drawerOpen` at all. The mobile one
([app-shell.tsx:105-147](packages/shared/src/shell/app-shell.tsx:105)) mounts a
**second `<Sidebar>`** in a `role="dialog" aria-modal="true"` fixed at
`left: 0`, same 220px width. On desktop it lands pixel-aligned on top of the
sidebar that was already there — identical nav, identical position. The only
visible deltas are the ✕ and a 34% scrim. That is exactly screenshot 3; the ✕
is not leaking into the sidebar, it belongs to the duplicate sitting on it.

**It is also a live a11y defect.** `useFocusTrap`
([app-shell.tsx:59](packages/shared/src/shell/app-shell.tsx:59)) is active, over
a background that is never `inert`/`aria-hidden`, and while open the page
carries two `<nav aria-label="Product navigation">` landmarks plus duplicated
element ids referenced by `aria-labelledby`
([sidebar.tsx:130-133](packages/shared/src/shell/sidebar.tsx:130)).

**Regression, precisely located.** `git log -L 170,195` on the shell shows two
touches. The original had no `display`. Commit `e0295e38` ("feat: launch public
product experience", #325, 2026-07-14) replaced `padding` with a 44px
touch-target block and brought `display: 'inline-flex'` along to centre the SVG.
Live for 35 days. The file documents this exact trap 25 lines lower, for the
trust strip: _"`display` lives in tokens.css, not here: an inline style would
outrank the phone-width media query"_
([app-shell.tsx:210-212](packages/shared/src/shell/app-shell.tsx:210)) — the
hamburger was simply missed.

**Why nothing caught it.** No Storybook story exists for `AppShell` or
`Sidebar`. [app-shell.test.tsx:14-27](apps/web/src/features/shell/app-shell.test.tsx:14)
opens the drawer and asserts the trap in **jsdom, where `tokens.css` never
loads**, so it passes identically either way — and it asserts the 44px size that
motivated the bad line. Playwright runs desktop and mobile projects and asserts
the trust strip in both directions, but never asserts anything about the
hamburger.

**Recommendation.** Delete `display: 'inline-flex'` from
[app-shell.tsx:185](packages/shared/src/shell/app-shell.tsx:185) and let
`tokens.css` own it; `alignItems` / `justifyContent` can stay inline (inert when
the box is not flex). Then add the both-directions assertion to
`packages/e2e/specs/a11y-smoke.spec.ts` beside the existing trust-strip check —
the jsdom test structurally cannot catch this class, so without the e2e pin it
will regress again.

**Priority:** P1 — a visibly broken control in the chrome of every authed
desktop page, plus an active focus trap, against a one-line fix.
**Status:** Open

---

## P2 — backlog

### F003 — `apps/api` sourcemaps are not uploaded; worker stack frames read `<unknown>`

**Found:** 2026-08-06 · during the sync-incident diagnosis
**Observed:** Sentry shows worker failures with `<unknown>` frames, so a
terminal error arrives as a bare class name with no location.

**Verdict.** Half of this was closed by adding `errorReason` to
`WorkerFailureContext`
([worker-observer.ts:48](packages/workers/src/worker-observer.ts:48)) — the
provider's machine-readable reason now rides along without widening what can
leak under D7. The other half — actual sourcemap upload in the API deploy —
is untouched. It cannot be verified without a deploy, so it was deliberately
excluded from PR #471/#472 rather than stubbed.

**Priority:** P2
**Status:** Open

---

## P3 — ideas (need evidence)

### F001 — Onboarding step 4 goal picker is single-select; should it be multi?

**Found:** 2026-08-06 · `/onboarding` step 4 of 5 (`choose_preset`)
**Observed:** "What would help most right now?" offers three cards — Reduce
newsletters / Protect important senders / Clear old promotions — and only one
can be chosen. Multi-select might fit the question better.

**Verdict — the selection model is load-bearing, so multi-select is not a
free widening.** The goal is not a filter. It selects one of three **sort
orderings** for the five pinned first-triage rows
([onboarding.service.ts:286](apps/api/src/onboarding/onboarding.service.ts:286)),
each a different tie-breaker chain:

- `reduce_newsletters` → unsubscribe-verdict, then promotions, then _low_ read rate
- `clear_old_promotions` → promotions ∧ cleanup-verdict, then confidence
- `protect_important` → keep/protected first, then _high_ read rate

Two of these sort read-rate in **opposite directions**, and
`protect_important` does not even draw from the same pool — the other two
filter to `eligible` (non-keep, unprotected), while it ranks the full queue.
Selecting two goals has no defined meaning; you would have to invent a merge
rule, and any merge dilutes the one thing this screen is for: making the
first five rows feel obviously right.

The observation still points at something real, though — the **copy invites
multi-select** it cannot honor. "What would help most right now?" reads like
a checklist prompt. A single-choice framing ("Where should we start?") plus
card affordances that read as radio-style would remove the doubt without
touching the model.

Real answer needs data: does `activation_goal_selected` distribution show
users bouncing between cards before committing? Nothing to measure yet — no
users.

**Priority:** P3 — revisit with onboarding funnel data. The copy tweak is a
separable P2 if it keeps nagging.
**Status:** Open

---

## Done

### F002 — Sync telemetry is frontend-only; PostHog cannot answer "how did that sync go?"

**Found:** 2026-08-06 · asked after retrying a beta user's sync
**Observed:** No dashboard exists for sync performance, and the events that
would feed one are structurally unable to.

**Verdict.** `sync_started` / `sync_completed` are emitted from exactly one
place — the browser, at
[use-sync-funnel.ts:53](apps/web/src/features/sync/use-sync-funnel.ts:53).
The worker never emits them. Consequences, all by construction:

- `sync_id` is always `null` — the D224 status poll carries no sync id
- `messages_indexed` is always `-1` — the poll carries no counts
- `duration_ms` measures **how long a browser tab watched**, not how long
  the sync took
- `outcome` can never be `partial` — the FE only sees `ready` / `failed`
- **A user who closes the tab produces no events at all.** For an 84k-message
  sync, that is the common case
- Nothing at all about unreadable-skipped messages, Gmail API call counts,
  or per-stage timing

The taxonomy used to call this a gap awaiting "a future server-side emitter";
that line is now removed, because the emitter turned out to be impermissible
rather than merely unbuilt (see below). The only server-side PostHog calls in
the repo are Resend's `email.delivered` / `email.bounced`
([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184)).

Real sync data today lives in `provider_sync_state` (`current_stage`,
`progress_pct`, `readiness_status`, `last_synced_at`, `error_code`,
`last_incremental_error_code`), Cloud Run structured logs, and
`dead_letter_jobs`. All require a prod query — none are on a dashboard.

**Why P1 not P0:** launch does not depend on it. But the 2026-08-06 incident
took a prod DB query to diagnose precisely because this is missing — the
next one will too.

**Why PostHog was ruled out, and it matters.** A server-side PostHog emitter
was built and then removed: it cannot ship without contradicting our published
privacy policy. Analytics consent (D147) is per-browser `localStorage` with
decline as the default and is deliberately NOT synced to the user record
([cookie-consent.ts:19](apps/web/src/lib/cookie-consent.ts:19) — "a synced
'all' must never auto-enable tracking on a browser that was not asked"). A
worker therefore cannot check it, so anything it emits reaches PostHog for
users who declined. Three published sentences say that must not happen:

- privacy: "Optional analytics (PostHog) is initialized only after you accept
  it in the cookie banner; it is off by default"
- privacy: "withdrawal takes effect immediately"
- cookies: "Choosing Essential only stops analytics immediately"

Anonymising the payload does not rescue it. The promise is that PostHog does
not run, not that it runs without names — and I twice talked myself past that
by reasoning about what counts as personal data instead of reading what we
published. (Recorded in MISTAKES.md 2026-08-06.)

**Resolution — first-party `sync_runs`, founder-approved 2026-08-06.** Per-run
sync metrics now land in our own table, not PostHog. This was the founder's own
open D-candidate from 2026-05-22 ("To answer 'is sync getting slower for this
account,' compare accounts, or find the slow stage over time, a per-run history
table is needed"), and it is strictly better than the emitter would have been:
first-party operational data sits outside the optional-analytics consent gate —
the same split the repo already uses ("First-party storage is authoritative;
PostHog remains optional and consent-gated") — and a row insert is exactly-once
and durable where a fire-and-forget HTTP event is neither, losing hardest
exactly when a sync failed.

What shipped:

- `sync_runs` (migration 0054) — one row per FINISHED `InitialSyncWorker` run:
  status, attempts, messages synced, senders indexed, unreadable, and the
  final attempt's duration / Gmail API calls / per-stage timings, plus the
  error class. RLS on, FK cascade, and wired into the mailbox purge registry so
  a data-deletion request erases it.
- **No `running` status, by design.** A start-then-update row needs a run
  identity that survives BullMQ retries, and every candidate (attempt number,
  enqueue timestamp, "the open row for this mailbox") either mis-keys a retry
  as a new run or strands an orphan the next run adopts. The success insert
  rides `markReady`'s transaction instead, so the row commits iff the sync did.
  In-flight and stuck syncs stay `provider_sync_state` +
  `check-sync-stuck.sh`'s job.
- **Metrics are nullable.** NULL = not measured; 0 = measured zero. A failed
  run writes NULL because the worker returns no partial counts — writing 0
  would claim a mailbox that died at 60k messages synced none.
- **Two scales, and the column names say which** (Codex stop-review caught the
  first cut storing final-attempt numbers as whole-run history). The sync is
  resumable, so a retry skips everything already stored: `messages_synced` /
  `senders_indexed` are cumulative across attempts, while duration, API calls
  and stage timings only ever cover the attempt that finished — hence
  `final_attempt_*`. Under a bare `duration_ms` the number would have
  **inverted**: each retry resumes closer to done, so a mailbox needing four
  attempts records a shorter duration than one that succeeded first try, and
  "is sync getting slower for this account" answers _faster_ as it degrades.
  For whether an account is struggling, read `attempts`. Real numbers from the
  smoke make the split obvious: `messages_synced 1176` against
  `final_attempt_gmail_api_calls 4`.
- **A broken history write cannot block the failed state.** The success row
  rides `markReady`'s transaction because there the row and the outcome are the
  same fact. The failure row does not: it is written after the failed-state
  transaction commits, and never throws. This feature's own smoke proved why —
  a worker running pre-rename code wrote to renamed columns, the insert threw
  inside the transaction, and the rollback took the `failed` upsert with it,
  wedging a mailbox at `syncing/finalizing/97%` with no error the user could
  see. Losing a telemetry row is the smaller harm, and it still reaches Sentry.
- The two designed no-ops are recorded (`skipped_deletion_pending`,
  `skipped_already_ready`) because "I retried that account and nothing
  happened" is a real support question and those are its two answers.
- [scripts/sync-history.sh](scripts/sync-history.sh) — the reader.
  `./scripts/sync-history.sh 20 [mailbox-uuid]`, printing `n/a` for unmeasured
  rather than 0, and labelling which columns are per-attempt.
- Earlier, in PR #473: `unreadable` on `InitialSyncResult` + the
  `worker.succeeded` allowlist, and the taxonomy corrections this work
  surfaced (`sync_id` was never a `syncs.id` UUID; both sync events are
  frontend-only; server-emitted events may carry no user-linked identifier).

**What did NOT ship: a dashboard.** The data is queryable, not visualised. An
admin UI is a separate surface with its own auth and route decisions, and
building one was not part of this. The consent question this work surfaced is
F004, resolved the same day.

**Priority:** P1
**Status:** Done 2026-08-06

---

### F004 — Two shipped Resend events violate our own PostHog consent promise

**Found:** 2026-08-06 · building F002's server-side sync telemetry
**Observed:** Consent is per-browser and unreadable from a worker, so anything
server-side sends reaches PostHog for people who declined. That rule turns out
to already be broken by two live calls.

**Verdict — a general constraint, and an existing breach of it.** Consent
(D147) lives in browser `localStorage` under `dm-cookie-consent`
([cookie-consent.ts:37](apps/web/src/lib/cookie-consent.ts:37)), decline is the
default, the FE re-reads it on every `track()`
([posthog.ts:59](apps/web/src/lib/posthog.ts:59)), and it is deliberately never
synced to the user record. Our published pages promise PostHog "is initialized
only after you accept" and that Essential-only "stops analytics immediately".
No server process can honour that, and anonymising does not help — the promise
is that PostHog does not run, not that it runs without names.

The sync emitter built for F002 was removed on this basis, and F002 shipped as
a first-party table instead. But the same reasoning convicts two calls that
already ship:

- `captureServerEvent('email.delivered', { emailType })`
- `captureServerEvent('email.bounced', { reason })`
  ([resend-webhook.controller.ts:184](apps/api/src/webhooks/resend/resend-webhook.controller.ts:184))

Both fire from a Resend webhook, on the `'server'` distinct id, carrying no
user-linked field. A reasonable person could call them operational
delivery telemetry rather than product analytics — but that is exactly the
"is this really analytics?" reasoning I used twice to talk myself past the
consent gate, and it was wrong both times. It is not mine to decide again.

**Resolution — drop both calls, founder decision 2026-08-06.** Chosen over
narrowing the published copy and over persisting consent to a `users` column.
It was the cheapest of the three and the only one that leaves the published
sentence literally true with no qualification bolted on.

The loss is close to zero: Resend's own dashboard and the `email_send` worker
logs already carry delivery and bounce data, so this was duplicate telemetry
with a policy cost attached.

Removing the two callers left the whole server-side PostHog client dead, so it
went too:

- both `captureServerEvent` calls in
  [resend-webhook.controller.ts](apps/api/src/webhooks/resend/resend-webhook.controller.ts)
- `apps/api/src/observability/product-analytics.ts` and its spec — deleted
- the `posthog-node` dependency — dropped from `apps/api`
- the `UNREMEDIATED_SERVER_EVENTS` frozen list, which existed only to bound
  the debt and had nothing left to bound

That is a stronger guarantee than the frozen list was. `apps/api` no longer has
a PostHog client at all, so adding a server-side event now means re-adding a
dependency and a module — visible in review in a way one more line in an
allowlist never was.

`POSTHOG_API_KEY` still appears in `.github/workflows/vendor-limits-watchdog.yml`.
That is the opposite direction and stays: the watchdog READS our PostHog usage
for the billing guardrail. It sends nothing.

The 2026-07-27 email-foundation plan's "Task 10: Delivery telemetry" is
annotated SUPERSEDED in place rather than deleted — a future agent following
that plan would otherwise rebuild exactly this.

**Priority:** P2
**Status:** Done 2026-08-06

---

### F005 — `protect_important` step 5 protects nothing; make it a protection review

**Found:** 2026-08-08 · founder build brief
**Observed (verbatim brief):**

**2026-08-08** · **BUILD BRIEF — `protect_important` becomes a protection
review.** Founder-decided 2026-08-08. Today the goal protects nothing: the
verb registry is `keep/archive/unsubscribe/later/delete` with no Protect,
and Keep is explicitly not Protect. Meanwhile auto-protection already
shielded **515 senders** on the founder's mailbox before Step 5 runs.

**Shape.** Split protected senders by whether the user ever replied —
definitional, not a tuned threshold. A reply is a two-way relationship; a
star or a Gmail flag is one-way. Measured: 463 strong / 52 weak on the 98k
mailbox, 0 / 2 on the 23k.

Headline is the reassurance ("We protected 463 senders you write back
to"); the rows are the 52 worth a look, ordered by how much UNREAD mail the
protection is shielding (`volume x unread%`), so the costliest mistake
leads. Real examples: God of Prompt (166 emails, 13% read, starred once),
GetYourGuide (34, 3%). Both currently excluded from all bulk and automatic
cleanup because of a single star.

**Actions: all five verbs, not just Unprotect.** ADR-0019 forbids
per-surface verb hand-rolling, CLAUDE.md §2.6 scopes protection to bulk and
automatic actions only, and PR #476 already made protected rows actionable
in Triage. A row offering only Unprotect would be the special case.

**The trap, and how NOT to close it.** A single action on a protected
sender succeeds and LEAVES the protection intact
(`actions.service.ts:747` gates only the bulk path; `:656` flags but does
not block). So unsubscribing GetYourGuide here feels finished while every
future bulk and Autopilot run silently keeps skipping it.

An earlier draft of this brief closed that by bundling protection removal
into the mail action, declared in the preview. That is wrong three times
over. It is AMBIGUOUS — Keep on a protected sender plainly should not
unprotect, and Later is arguable. It is UNSAFE — `undo_action_kind` is
`archive | unsubscribe | later | apply-rule | delete` with no protection
kind, so an undo restores the mail and structurally CANNOT restore the
shield; the user would undo, watch their mail come back, and never learn
the protection did not. And it CORRUPTS the semantics — D245 makes a
manual Unprotect a sticky override that stops auto-protection
re-protecting, so a bundled removal records a user decision the user
never made.

**Do not bundle.** Keep the two acts separate: the verbs decide what
happens to mail, a distinct Unprotect control changes the safety state.
Close the trap by SAYING it rather than acting — on the four verbs that
bulk and automatic runs would skip (Archive, Later, Delete, Unsubscribe),
the preview states "Archive 34 emails. This sender stays protected, so
bulk and automatic cleanup will keep skipping it," with Unprotect offered
alongside. Surfacing the consequence is the fix; acting on the user's
behalf is how the fix became more dangerous than the bug.

Note it is FOUR verbs, not five. `SheetableVerb` is
`Archive | Unsubscribe | Later | Delete` — Keep has no preview sheet
because it moves no mail, it records a decision. Keep also needs no
notice: keeping a protected sender is coherent, so warning about
protection there would be noise. (Unsubscribe is the partial case — it
stops future mail while existing inbox mail stays put unless a backlog
action is chosen separately, so its notice should speak to future mail.)

**Edges.** Zero weak protections → show only the reassurance line, which is
itself the win. The second test mailbox is 0 strong / 2 weak, so the copy must not
read as failure when the strong count is 0. Unprotect moves no mail, so there is no undo
window to explain — but it is not freely reversible either: D245 makes a
manual Unprotect a STICKY override, so automatic protection will not
re-apply afterwards. The user can protect again by hand; the automatic
signal that put it there originally is spent. Say that on the control.

**Blocked on:** `/settings/senders` shows protected senders with no reason
at all (CLAUDE.md §2.6 requires the exact reason), so the "Show all 52"
link has nowhere good to land until that is fixed.

**Verdict — built as specified, minus the one piece the brief itself blocked.**
Step 5 branches on the goal: `protect_important` renders
[step-protection-review.tsx](apps/web/src/features/onboarding/step-protection-review.tsx)
instead of the cleanup run. The strong/weak split is
`protection_reason = 'replied'` vs `starred | gmail_important`
([triage.read-service.ts](apps/api/src/triage/triage.read-service.ts) —
`readProtectionReview`); `user_defined` is in neither bucket, since the user's
own Protect is not ours to reassure about or second-guess.

Ranking is literal rather than a composite: `volume x unread%` reduces
algebraically to the unread count, so the read ranks by unread INBOX mail
(`senderInboxActionWhere` — the set a cleanup verb would actually move) and the
row says exactly that ("shielding 145 unread"). Verified against the real
mailbox: God of Prompt 166/145 and GetYourGuide 34/33 land precisely where the
brief predicted.

Rows are the real `<TriageScreen/>`, so all five verbs and the D226 lifecycle
ride along unchanged (ADR-0019); what the review ADDS is a direct Unprotect
control. The trap is closed by SAYING it, not acting: every sheetable verb's
preview now reads "…This sender stays Protected, so bulk and automatic cleanup
will keep skipping it," with Unprotect offered alongside and the D245 sticky
caveat stated. Bundling was rejected for the three reasons the brief gives —
the rationale is recorded in
[protected-notice.tsx](apps/web/src/features/triage/protected-notice.tsx) so a
future session cannot re-derive the "obvious" fix.

**Not built:** the "Show all N" link — and it stays unbuilt for a NEW reason.
The original block (no list surface showed a protection reason) was shipped
inside #483 itself: `/settings/senders` now lists every protected sender with
the exact reason, the unread mail the protection shields, and an in-place
Unprotect. But an in-onboarding link cannot land there: the (app) layout's
onboarding gate (D113 —
[layout.tsx](<apps/web/src/app/(app)/layout.tsx>) ladder #4) replaces every app
route with `/onboarding` while `onboarded_at IS NULL`, so a step-5
"Show all N" would bounce straight back to the step it came from. The count
stays unlinked in step 5; post-onboarding, Settings → Protected senders is
the standing answer to the question.

**Priority:** P1
**Status:** Done 2026-08-09 — shipped as
[#483](https://github.com/CT2689-Tech/DeclutrMail/pull/483) (review +
standing review + verb-preview notice),
[#484](https://github.com/CT2689-Tech/DeclutrMail/pull/484) (failed
completion no longer traps step 5),
[#485](https://github.com/CT2689-Tech/DeclutrMail/pull/485) (manual
protections counted, "nothing is protected" requires all three counts zero).
Merged, deployed, production-verified.

---

## Won't do

_None yet._
