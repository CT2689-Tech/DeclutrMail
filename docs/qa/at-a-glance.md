# QA at a glance

**Generated rollup — not a fourth source of truth.** The QA-findings section
below (priority table + by-job table) is read directly off
`docs/qa/qa-worklist.md` as it stood on **2026-09-03**, after two live
re-verification passes covering `triage`/`undo`/`archive`/`onboarding`/
`sender-detail` (first pass) and `delete`/`sign-in` (second pass, same day).
Those glyph counts are computed with an `awk` tally over the worklist's own
status+severity columns (script kept in this run's session, not this repo),
not hand-counted — the first version of this page's priority table was
hand-tallied and wrong, corrected below. This page still does not update
itself the moment a row moves after this.
The **`FINDINGS.md` section below is NOT refreshed this pass** — that file
has grown to 34 entries since this page's last full regen (2026-08-30, when
it had ~7); re-deriving its priority/open/done breakdown accurately needs its
own read-through and is out of scope for what generated this update. Treat
that section as stale; ask for a dedicated `FINDINGS.md` regen if you need it.

Two different things live here, on two different clocks:

|                                            | Tracks                                                 | Priority scale                                   |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| **QA findings** (`docs/qa/qa-worklist.md`) | Bugs a `/ct-qa` run found and is fixing                | P0–P3, severity                                  |
| **Product findings** (`FINDINGS.md`)       | Open questions about the product, not tied to a QA run | P0–P3, same scale, different meaning — see below |

## Needs you right now

- **The one P0 QA finding is now `Fixed`.** `QA-onboarding-20260828-01`
  (`/senders` could lie about sync state during an active resync) shipped in
  PR #673, cleared 2 review rounds, and — as of 2026-09-03 — had its live
  re-check: forced `provider_sync_state` to `syncing` on the real primary
  mailbox, confirmed `/senders` renders the honest "Still syncing…" copy
  instead of a false claim, restored and re-verified. Nothing to decide here
  anymore.
- **Update, later same day:** the founder made the ship/no-ship call on all 4
  P2/P3 findings below (`QA-archive-20260901-01`, `QA-archive-20260903-01`,
  `QA-delete-20260903-01`, `QA-sender-detail-20260903-01`) — fix all 4 now.
  All 4 are implemented, negative-controlled, live-smoked, and cleared 4
  rounds of Codex adversarial review (which found and fixed 10 further
  defects on the growing diff before merge). Open as PR #723; this rollup's
  glyph tables below still show their PRE-fix `🟡`/`🔵` state from earlier
  that day and have not been mechanically re-tallied — treat the worklist
  rows themselves (now `🟢`, PR #723) as current, this snapshot as stale on
  just these 4.
  - `QA-archive-20260903-01` — Screener's own decide/confirm dialog never got
    the staleness-indicator fix Triage's identical dialog has had since PR
    #670/#712; live-confirmed 2026-09-03, sibling of the already-`Fixed`
    `QA-archive-20260828-02`.
  - `QA-sender-detail-20260903-01` — the same sender-id 404 nondeterministically
    renders one of two different error surfaces (generic exception boundary vs.
    the purpose-built not-found state) depending on render-order timing;
    live-reproduced twice on the identical URL, confirming a theory this file's
    own Refuted table had left unmeasured on 2026-09-02.
- **`QA-triage-20260827-04` (P2, Tier 1 — billing)** is still the one item
  whose evidence is structurally capped by the dev environment: its spec runs
  on PGlite, and the real risk (an `::int` cast one edge from inverting the
  Free-tier cap) needs a production-shaped Postgres driver to close. No live
  pass in this dev stack can finish it.
- **7 QA findings from `sync`/`senders`/`senders-filtering` remain completely
  unexamined by either pass** — those 3 jobs weren't re-driven at all
  2026-09-03; see the full-worklist table below for their raw (stale) glyph
  counts.
- **`FINDINGS.md`'s Inbox is untriaged and this page can't currently size
  it accurately** (see the header note above) — run `/ct-finding triage`
  when you want a real number there.

## QA findings — by priority, 7 re-verified jobs

**Scope note:** this table covers the 7 jobs re-verified across both
2026-09-03 passes: `triage`, `undo`, `archive`, `onboarding`, `delete`,
`sign-in`, `sender-detail`. `mailbox-switch`, `sync`, `senders`,
`senders-filtering`, and `billing` are real rows in `qa-worklist.md` but are
NOT included below — see "By job, full worklist" further down for an
as-of-today glyph count across every job (counting only, no re-verification
claim for those 5).

Glyphs match `IMPLEMENTATION-LOG.md`'s vocabulary (CLAUDE.md §8): ⬜ not
started · 🟡 being worked · 🔵 merged, not yet re-checked · 🟢 confirmed
fixed · 🔴 needs you · ⏸️ won't do.

| Priority                | ⬜ open | 🔵 merged | 🟢 confirmed | 🔴 needs you | Total |
| ----------------------- | ------- | --------- | ------------ | ------------ | ----- |
| **P0** — launch blocker | 0       | 0         | 1            | 0            | 1     |
| **P1** — real friction  | 0       | 0         | 11           | 0            | 11    |
| **P2** — worth doing    | 1       | 3         | 28           | 2            | 34    |
| **P3** — polish/idea    | 6       | 0         | 21           | 2            | 29    |
| **All**                 | 7       | 3         | 61           | 4            | 75    |

**61 of 75 rows across these 7 jobs are now `🟢 confirmed` — up from 0
confirmed on 2026-08-30.** A second live-smoking pass the same day closed 4
more (`QA-triage-20260827-11`, `QA-triage-20260828-02`,
`QA-archive-20260828-04`, `QA-delete-20260829-03`) that were previously
`🔵`/blocked on a flaky browser-pane retry. The remaining 14 are: 7
intentionally `Open` by design, no code change proposed
(`QA-triage-20260827-{13,14,15}`, `QA-undo-20260828-03`,
`QA-archive-20260901-01`, `QA-sign-in-20260829-{04,10}`), 3 still `🔵` —
`QA-triage-20260827-04` (Tier 1 billing, needs a real Postgres driver),
`QA-triage-20260827-06` (needs the queue genuinely empty, which this run
declined to force via 12 real Gmail mutations), `QA-sign-in-20260829-03`
(needs forcing the real live Paddle sandbox subscription, declined) — and 4
`🔴` real bugs needing a founder call: `QA-archive-20260828-05`,
`QA-archive-20260903-01`, `QA-delete-20260903-01`,
`QA-sender-detail-20260903-01`. See the founder decision request in this
session for the specific asks on all 7 of the non-`🟢` items above that
aren't simply "not yet re-driven."

## QA findings — by job (7 re-verified jobs)

| Job               | Total | 🟢 confirmed | 🔵 merged | ⬜ open (by design) | 🔴 needs you |
| ----------------- | ----- | ------------ | --------- | ------------------- | ------------ |
| **triage**        | 19    | 14           | 2         | 3                   | 0            |
| **undo**          | 4     | 3            | 0         | 1                   | 0            |
| **archive**       | 8     | 5            | 0         | 1                   | 2            |
| **onboarding**    | 5     | 5            | 0         | 0                   | 0            |
| **delete**        | 10    | 9            | 0         | 0                   | 1            |
| **sign-in**       | 10    | 7            | 1         | 2                   | 0            |
| **sender-detail** | 19    | 18           | 0         | 0                   | 1            |

Row counts above are an `awk` tally over the worklist's own status+severity
columns as of 2026-09-03 (the priority table above was hand-counted on the
first draft of this page and came out wrong — re-derived programmatically
after that mistake was caught).

**A pattern worth its own `/ct-class` sweep, surfaced 4 times independently
across 3 jobs today:** Screener's decide/confirm dialogs keep not receiving
fixes that land on Triage's or the Senders confirm modal's equivalent
surfaces — `QA-delete-20260829-01` (180-day default window, already fixed),
`QA-archive-20260903-01` (staleness indicator, open), `QA-delete-20260903-01`
(zero-match header, open), all the same `decide-preview.tsx` component. Worth
naming as its own defect class rather than three unrelated sibling rows.

## By job, full worklist (glyph count only — 5 jobs below not re-verified either pass)

| Job               | Total | 🟢  | 🔵  | 🟡  | ⬜  | 🔴  |
| ----------------- | ----- | --- | --- | --- | --- | --- |
| triage            | 19    | 12  | 4   | 0   | 3   | 0   |
| undo              | 4     | 3   | 0   | 0   | 1   | 0   |
| archive           | 8     | 4   | 1   | 0   | 1   | 2   |
| onboarding        | 5     | 5   | 0   | 0   | 0   | 0   |
| delete            | 10    | 8   | 1   | 0   | 0   | 1   |
| sign-in           | 10    | 7   | 1   | 0   | 2   | 0   |
| mailbox-switch    | 6     | 6   | 0   | 0   | 0   | 0   |
| sync              | 10    | 0   | 0   | 8   | 2   | 0   |
| senders           | 10    | 0   | 0   | 0   | 0   | 10  |
| senders-filtering | 9     | 0   | 0   | 0   | 0   | 9   |
| billing           | 11    | 11  | 0   | 0   | 0   | 0   |
| sender-detail     | 19    | 18  | 0   | 0   | 0   | 1   |

`senders` and `senders-filtering` reading all-🔴 and `sync` reading all-🟡/⬜
is a straight glyph count, not an interpreted claim about severity — this
page didn't re-examine those sections' own text either pass. If those
numbers look surprising, read the section itself before acting on them.

## Product findings — by priority (`FINDINGS.md`)

**Not refreshed this pass — stale since 2026-08-30, and the file has grown
from ~7 entries to 34 since then.** The table below is left here only so the
page's shape doesn't silently lose the section; treat every number in it as
unverified.

| Priority                | Open (as of 2026-08-30, STALE)         | Done (as of 2026-08-30, STALE)      | Won't do |
| ----------------------- | -------------------------------------- | ----------------------------------- | -------- |
| **P0** — launch blocker | 0                                      | 5 (F008–F012, closed 2026-08-19/23) | 0        |
| **P1** — launch week    | 0                                      | 1 (F013, closed 2026-08-24)         | 0        |
| **P2** — backlog        | unknown — file has grown to 34 entries | unknown                             | unknown  |
| **P3** — needs evidence | unknown                                | unknown                             | unknown  |
| **Inbox** — untriaged   | unknown — run `/ct-finding triage`     | —                                   | —        |

## Where to look for detail

| Question                                                     | File                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| What happened in a specific `/ct-qa` run?                    | `docs/qa/launch-qa.md`                             |
| What's being fixed, by whom, how far along?                  | `docs/qa/qa-worklist.md`                           |
| Is this product question still open?                         | `FINDINGS.md`                                      |
| Is a Section 2 guardrail or a recurring pattern behind this? | `CLAUDE.md` §2 / §8, `MISTAKES.md`, `LEARNINGS.md` |

---

_Regenerated 2026-09-03, after two live re-verification passes: `sender-detail`
first, then `triage`/`undo`/`archive`/`onboarding` (the "28 merged fixes"
this page itself previously flagged as awaiting a live re-check — 2026-08-30's
line 58), then `delete`/`sign-in` same day. Superseded its own 2026-08-30
correction note below, which is kept for the trail._

_Corrected on 2026-08-30: 9 `qa-worklist.md` rows (`QA-archive-20260828-{01,02,03,04,06}`,
`QA-onboarding-20260828-{01,02,04,05}`) were still marked `🟡 PR #nnn`
though PR #670 and #673 had already merged to `main` (verified via
`git log`). Flipped to `🔵 Merged #nnn`; left at merged-not-confirmed rather
than promoting to `🟢 Fixed`, since no live re-check had happened yet._
