# Codex takeover — DeclutrMail launch close-out

**Date:** 2026-08-05 · **Branch:** `feat/d250-ship-remaining-copy-rows` · **PR:** #470 (open, CI green)
**Repo:** `/Users/chintant/projects/DeclutrMail` · pnpm workspace, Node ≥22

---

## Read first

`CLAUDE.md` at repo root is binding. Non-negotiable parts for this work:

- **§2.1 privacy** — never fetch/store message bodies. Trust badge string is locked:
  `Full bodies fetched: 0`. Never `Bodies read: 0 forever`.
- **§2.2 verbs** — product UI uses exactly Keep · Archive · Unsubscribe · Later · Delete
  (K/A/U/L/D). "Screen" is an internal enum only, never user-facing.
- **§2.3 action lifecycle** — intent → sheet → **preview (mandatory)** → mutation → undo.
- **§9 stop conditions** — stop and ask the founder for: OAuth scopes, token
  encryption, prod migrations, billing webhooks, account deletion, privacy/retention,
  destructive Gmail actions without preview+undo, webhook auth, security headers/CSP.
- **§11** — agents do **not** edit `CLAUDE.md`. Append to `LEARNINGS.md`,
  `MISTAKES.md`, or `FOUNDER-FOLLOWUPS.md` instead.
- **§6 naming** — branch `<type>/d<NNN>-<kebab>`; commit
  `<type>(<scope>): <subject> (D<NNN>)`; allowed types are exactly
  `feat|fix|chore|docs|refactor|test|perf|security` (**no `revert`** — commitlint rejects it).
- **§10** — never `--no-verify`. Fix what the hook catches.

Copy is governed by `docs/execution/repositioning-copy-spec-2026-08-01.md` (read the
**DECISIONS LOCKED** block at the top — it overrides later sections) and
`docs/adr/0030-positioning-preview-guarantee.md`. Truth constraints T1–T7 in §1 of the
spec disqualify copy regardless of how well it reads.

---

## The standing bar for any assertion you add

This session shipped four defective guards, all green in CI. Read this before writing a test.

| #   | Defect                                                           | Why it passed                                                                        |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `String(metadata.title)` measured `"[object Object]"` (15 chars) | `title` is `{ absolute }`; the assertion never saw the real value                    |
| 2   | Asserted a 60-char title budget across 16 routes                 | No D-decision or ADR establishes one — invented repo-wide policy                     |
| 3   | Reverting #2 left the restored D250 string with no guard at all  | Removing a bad guard silently removed all protection                                 |
| 4   | `toContain` on the title                                         | Substring check — any superstring passed, despite the test's name claiming exactness |

**The rule: prove what an assertion REJECTS, not that it runs.** For every new test,
run the blind cases explicitly and paste the results in the PR body:

1. baseline → **must pass**
2. the exact defect it targets → **must fail**
3. a near-miss (superstring / appended suffix / adjacent value) → **must fail**
4. restore → **must pass**

If a guard filters over a fetch that can be empty, starve its input first and require
a failure — a filter over nothing is vacuously clean. This is a recurring failure class
in this repo; see the `ui-truth-bug-class` and blind-guard notes.

Second rule: **do not invent constraints.** Pin values decisions already fixed. If you
believe a new rule is warranted, write it to `FOUNDER-FOLLOWUPS.md` as an ADR candidate —
do not enforce it in CI.

---

## What is already done on this branch (do not redo)

- D250 copy rows #468 missed: 5 comparison summaries, `/compare` lead, blog title, Free bullet.
- Dark mode unpinned across all 31 public routes; 4 real contrast defects fixed
  (`/pricing` interval toggle and waitlist button were white-on-white, measured 1.11).
- Free-tier dead end fixed — over-quota bulk now acts on what the allowance covers
  instead of disabling confirm. `ActionRequest.actionableCount` is now **stated**, not
  derived (`senders-screen.tsx:1496,1505` → `confirm-action-modal.tsx:559`).
- `/pricing` defaults to annual, with a test that fails if flipped back.
- `check-microcopy.sh` gained T2/T5/T6 checks; D194 Screener rule moved to a CI test.
- D250 blog title pinned by equality in `marketing-metadata.test.ts`; six previously
  untested marketing routes added to the metadata suite.

CI on #470: 17 pass, 3 skipping (path-filtered — no db/workers/shared changes).

---

## Work remaining

### P0 — blocks launch

**1. DATA-01: confirm activation events by name in PostHog.**
Emit sites exist and fire: `step-preset-pick.tsx:115,277` (`activation_goal_selected`),
`step-first-triage.tsx:60,66` (`first_relief_session_started` / `_completed`).
I ran onboarding end-to-end three times via the D206 dev login and confirmed **13 POSTs
reached `https://us.i.posthog.com/e/`** — but could **not** read the event names:
posthog-js captures its transport reference at module load, so patching `fetch`, `XHR`,
and `sendBeacon` afterwards all caught zero. The PostHog MCP was blocked by a permission
classifier in my session.

Verify the four event names landed (PostHog UI, or the MCP if you have access). If a name
is wrong or missing, the launch produces no activation data. Note the founder's workspace
has `onboardingSkipped: true`, which is why these never fired before — to re-run, reset
reversibly and **restore afterwards**:

```sql
-- back up first:  select id, onboarded_at, preferences from users where email='chintan.a.thakkar@gmail.com';
update users set onboarded_at = null,
  preferences = jsonb_build_object('activeMailboxId', preferences->>'activeMailboxId')
where email='chintan.a.thakkar@gmail.com';
```

Dev login: `http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com`
(`DEV_AUTH_ENABLED=true` already set). Analytics consent must be accepted or PostHog
never initialises (D147 gate).

### P1 — business risk, not correctness

**2. Weekly receipt email.** Does not exist (`grep` over `apps/api/src`,
`packages/workers/src` returns nothing). Locked for the launch release on 2026-08-02 and
it is the entire **Plus renewal story** — without it Plus sells a job that finishes, which
the copy spec names as a structural churn mechanism. Templates live in
`apps/api/src/notifications/templates/`; `shell.tsx` is the shared frame.
Watch `postal-address` gating — a dedup guarding something irreversible must key on
whether the mail _can have gone out_ (recorded outcome), never on job state.

**3. `requestBulkAction` has zero test coverage.** `senders-screen.tsx:1430`. This is the
function I changed for the free-tier fix. I could not get the three-row fixture to render
and left it untested — the display contract for that shape _is_ covered at the modal, but
the wiring is not. This is the weakest point in the free-tier change.

### P2 — polish

**4. Changelog backlog.** `changelog-content.ts` last records **PR #434**; merged main is
at **#468**. ~34 unrecorded entries.

**5. Screener has no ProductTour chapter.** Copy spec §3.4 row 17 prescribes one with a
`Plus · Review` tier badge, between Triage and Autopilot in
`features/marketing/landing/sections.tsx`. Screener currently appears once in that file
and is not a chapter. Body copy is constrained by **T3** — must not say _blocks_,
_prevents_, _keeps out_, _intercepts_, or _quarantine_.

**6. Two open FOUNDER-FOLLOWUPS entries (2026-08-05)** — founder decisions, do not
self-resolve:

- `/blog` title is 66 chars; no ratified title budget exists.
- Six meta descriptions exceed 160 chars: `/security` 180, `/compare` 171,
  `/methodology` 168, `/pricing` 167, `/how-it-works` 167, `/faq` 165.

**7. In-app `#FFFFFF` siblings** (~6) outside the marketing subtree — same class as the
dark-mode contrast defects, not yet swept.

---

## Definition of done (CLAUDE.md §8)

`pnpm typecheck` · `pnpm lint` · affected tests · **local smoke** · `Closes D###` in the
PR body · no unresolved gate-agent blockers.

**Green CI is not a smoke.** Walk every state the change reaches — empty, error, stale,
in-flight, edge — switch between the two connected Gmail accounts, and try to break it.
Two invariants this repo keeps relearning: a scope change must reset the scoped client
cache (`resetMailboxScopedCache`), and a read guard's 4xx is a designed state, never a retry.

Local stack: `./scripts/dev-up.sh` (api :4000 + worker + redis), then
`pnpm --filter @declutrmail/web dev` (:3000). Verify the :4000 process cwd is this
checkout before trusting any smoke.
