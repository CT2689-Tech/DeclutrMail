# QA at a glance

**Generated rollup — not a fourth source of truth.** Everything below is
read off `docs/qa/qa-worklist.md` and `FINDINGS.md` as they stood on
**2026-08-30**. Those two files are what's real; this page exists so you
don't have to open a 1,200-line table and a 1,500-line log to answer "what's
done, what's not, what's P0." Rows move in the source files; this snapshot
does not update itself — the count is only as fresh as the date above, same
caveat `qa-worklist.md`'s own per-job hand-counts already carry. Ask for a
fresh pass if it's been more than a few sessions.

Two different things live here, on two different clocks:

|                                            | Tracks                                                 | Priority scale                                   |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| **QA findings** (`docs/qa/qa-worklist.md`) | Bugs a `/ct-qa` run found and is fixing                | P0–P3, severity                                  |
| **Product findings** (`FINDINGS.md`)       | Open questions about the product, not tied to a QA run | P0–P3, same scale, different meaning — see below |

## Needs you right now

- **1 P0 QA finding is merged but not yet re-verified.** `QA-onboarding-20260828-01`
  (`/senders` can lie about sync state during an active resync) shipped in
  PR #673, cleared 2 review rounds — it just hasn't had a live re-check since
  merge, so it can't be called `Fixed` yet. Nothing else to decide here.
- **7 QA findings are stuck on you**, not on more engineering — the state
  machine calls this "at review cap" or "founder deferred," and both mean
  the same thing: ship as-is or say what more to do.
  - `QA-onboarding-20260828-03` (P1) — refresh-token rotation can revoke a
    whole session on a two-tab race; needs a migration/grace-window design
    call, explicitly deferred, not folded into any batch yet.
  - `QA-archive-20260828-05` (P3) — a copy-consistency fix was attempted and
    reverted; not in PR #670.
  - `QA-delete-20260829-02, -03, -05, -08, -09` (P2/P3) — all hit 2 clean
    Codex review rounds with nothing left to fix; go/no-go is yours.
- **21 items are sitting untriaged in `FINDINGS.md`'s Inbox** — noticed in
  passing, never read against the code, no priority assigned yet. Run
  `/ct-finding triage` when you want that number to move; nothing here is
  known to be P0/P1, because nothing has been triaged to find out.
- **The delete job hasn't shipped anything yet** — 4 of its 9 findings are
  genuinely not started (`⬜`), the other 5 are the review-cap items above.
  Every other job (triage, undo, archive, onboarding) has moved at least
  half its rows to merged.

## QA findings — by priority (43 rows, `docs/qa/qa-worklist.md`)

Glyphs match `IMPLEMENTATION-LOG.md`'s vocabulary (CLAUDE.md §8): ⬜ not
started · 🟡 being worked · 🔵 merged, not yet re-checked · 🟢 confirmed
fixed · 🔴 needs you · ⏸️ won't do.

| Priority                | ⬜ open | 🟡 fixing | 🔵 merged | 🟢 confirmed | 🔴 needs you | ⏸️ won't do | Total |
| ----------------------- | ------- | --------- | --------- | ------------ | ------------ | ----------- | ----- |
| **P0** — launch blocker | 0       | 0         | 1         | 0            | 0            | 0           | 1     |
| **P1** — real friction  | 0       | 0         | 6         | 0            | 1            | 0           | 7     |
| **P2** — worth doing    | 2       | 0         | 17        | 0            | 2            | 0           | 21    |
| **P3** — polish/idea    | 6       | 0         | 4         | 0            | 4            | 0           | 14    |
| **All**                 | 8       | 0         | 28        | 0            | 7            | 0           | 43    |

**Nothing has reached `🟢 Fixed` yet.** 28 rows are merged and waiting on a
live re-check by a future `/ct-qa` run on the same job — that's the single
biggest lever to move this table: re-running triage/undo/archive/onboarding
would very likely flip most of those 28 straight to green.

## QA findings — by job

| Job            | Total | ⬜ open    | 🔵 merged        | 🔴 needs you             | Furthest state                                        |
| -------------- | ----- | ---------- | ---------------- | ------------------------ | ----------------------------------------------------- |
| **triage**     | 19    | 3 (all P3) | 16               | 0                        | Merged; awaiting a confirming `/ct-qa triage` run     |
| **undo**       | 4     | 1 (P3)     | 3                | 0                        | Merged; awaiting a confirming `/ct-qa undo` run       |
| **archive**    | 6     | 0          | 5                | 1 (P3)                   | Merged; awaiting a confirming `/ct-qa archive` run    |
| **onboarding** | 5     | 0          | 4 (incl. the P0) | 1 (P1, Tier 1)           | Merged; awaiting a confirming `/ct-qa onboarding` run |
| **delete**     | 9     | 4 (P2/P3)  | 0                | 5 (P2/P3, at review cap) | Least progressed — nothing merged yet                 |

## Product findings — by priority (`FINDINGS.md`)

This priority scale answers a different question than the QA table above:
not "is the fix in," but "is this still an open question." P0/P1 here mean
launch-blocking or launch-week; P2/P3 mean backlog or needs-evidence.

| Priority                | Open                                       | Done                                | Won't do |
| ----------------------- | ------------------------------------------ | ----------------------------------- | -------- |
| **P0** — launch blocker | 0                                          | 5 (F008–F012, closed 2026-08-19/23) | 0        |
| **P1** — launch week    | 0                                          | 1 (F013, closed 2026-08-24)         | 0        |
| **P2** — backlog        | 1 (F003 — API sourcemaps missing)          | 5                                   | 0        |
| **P3** — needs evidence | 1 (F001 — onboarding picker multi-select?) | 0                                   | 0        |
| **Inbox** — untriaged   | **21**                                     | —                                   | —        |

`FINDINGS.md`'s P0/P1 sections read "_None open_" — that's real, not a gap:
every historical P0/P1 there has already shipped and been re-verified. The
number actually worth watching is the Inbox: 21 raw observations nobody has
turned into a verdict yet, any of which could become a P0/P1 on triage.

## Where to look for detail

| Question                                                     | File                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| What happened in a specific `/ct-qa` run?                    | `docs/qa/launch-qa.md`                             |
| What's being fixed, by whom, how far along?                  | `docs/qa/qa-worklist.md`                           |
| Is this product question still open?                         | `FINDINGS.md`                                      |
| Is a Section 2 guardrail or a recurring pattern behind this? | `CLAUDE.md` §2 / §8, `MISTAKES.md`, `LEARNINGS.md` |

---

_Corrected on 2026-08-30: 9 `qa-worklist.md` rows (`QA-archive-20260828-{01,02,03,04,06}`,
`QA-onboarding-20260828-{01,02,04,05}`) were still marked `🟡 PR #nnn`
though PR #670 and #673 had already merged to `main` (verified via
`git log`). Flipped to `🔵 Merged #nnn`; left at merged-not-confirmed rather
than promoting to `🟢 Fixed`, since no live re-check has happened yet._
