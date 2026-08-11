# Distillation audit — LEARNINGS.md + MISTAKES.md → CLAUDE.md

Read-only audit. **No repo file was edited.** CLAUDE.md untouched (§11 hard rule).
Branch verified: `main` (working tree clean; both logs byte-identical to `origin/main`).
Date of audit: 2026-08-11.

---

## 1. Entry counts and coverage

| File           | `## ` headings | Template scaffolding                                     | **Real entries** | Date range              |
| -------------- | -------------- | -------------------------------------------------------- | ---------------- | ----------------------- |
| `LEARNINGS.md` | 76             | 2 (`## Entry format`, the fenced `## YYYY-MM-DD` sample) | **74**           | 2026-05-19 → 2026-08-11 |
| `MISTAKES.md`  | 112            | 2 (same two)                                             | **110**          | 2026-05-20 → 2026-08-10 |
| —              | —              | —                                                        | **184 total**    | 85 days                 |

Counts verified with `grep -cE '^## 2026-'` → 74 and 110 exactly. No malformed entries; every
dated heading parses. Three file-health notes:

- **Both files declare "Newest at the top" and neither is sorted.** LEARNINGS puts 2026-05-19
  above 2026-05-21; MISTAKES puts 2026-07-21 above 2026-06-05 and 2026-05-22. Harmless for
  reading, but it means "how many entries since last session" cannot be answered by position —
  which is what the `SessionStart` hook in §11 claims to report.
- **Several entries are batches, not single findings.** `MISTAKES 2026-07-25` alone carries 3
  numbered defects plus 13 lettered sub-findings (a)–(m), each a distinct mechanism. Counting
  by heading therefore _understates_ the recurrence evidence by roughly 25 findings.
- **Two LEARNINGS entries contradict each other and neither cross-references the other**
  (see §5, drift item D6).

---

## 2. Cluster table

Clustered by **mechanism**, not surface. `Occ.` counts distinct log entries; batch entries
count once unless a sub-finding is a genuinely different mechanism.

| #      | Cluster                                             | Mechanism (one line)                                                                                                                                                                                                                 | Occ.                             | Dates                                                                                                                      | Trigger fired                                                                                                                        | Enforced by                                                                                                                                                                                                                                                                                                                      | Proposed action                                                                                                                       |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A**  | **Blind guard**                                     | A check whose subject is absent, unreadable, or never sampled returns PASS — every filter over an empty set is vacuously clean, and clean prints green.                                                                              | **14**                           | 06-10, 07-15, 07-26 ×3, 07-29 ×3, 07-31 ×3, 08-08, 08-10 ×2, 08-11                                                         | 1 (≥3, by 4.7×) · 2 (security/billing blind spots) · 4                                                                               | **NOTHING.** No hook, no CI job, no lint rule, no agent prompt mentions blind cases or negative controls.                                                                                                                                                                                                                        | **PROMOTE NOW** — §8. Log has called it "overdue" since 2026-07-31.                                                                   |
| **B**  | **Surface asserts what it does not know**           | A rendered value or sentence makes a claim the data cannot support: null→0, unknown→"Ready", one signal standing for two facts, an absolute word on a non-total counter, intent copy shown as outcome.                               | **26**                           | 05-20, 05-28, 07-02, 07-03 ×2, 07-04, 07-07 ×3, 07-08, 07-25, 07-26, 07-27 ×5, 07-29, 07-31, 08-04, 08-06, 08-07, 08-08 ×4 | 1 · 3 (implies a §2 guardrail — the log says so itself) · 4                                                                          | Partial: `check-microcopy.sh` (fixed-string bans only, T3 removed 08-04); per-defect regression tests; `design-system-agent` (GATE tier but **CI runs a placeholder** — see D1).                                                                                                                                                 | **PROMOTE NOW** — new §2.7. The 08-06 entry set the bar at "a third instance outside the FE"; 08-07 was the third.                    |
| **C**  | **Fixed the instance, shipped the class**           | The reported site is patched and its structurally identical siblings ship unfixed; the write-up is where "done" feels earned, so it lands before the sweep.                                                                          | **24**                           | 05-20, 05-26, 07-02, 07-03, 07-07, 07-15, 07-20 ×2, 07-25 ×3, 07-26 ×4, 07-27, 07-31 ×3, 08-04 ×2, 08-06, 08-08 ×2         | 1 · 3 · 4                                                                                                                            | **NOTHING mechanical.** Caught by Codex stop-time review, repeatedly, in rounds (3, 4, 5, 7, and 10 consecutive rounds on single branches).                                                                                                                                                                                      | **PROMOTE NOW** — §1.3. Currently a standing order **in session memory only**, with three self-recorded violations _while citing it_. |
| **D**  | **Green test that encodes the bug**                 | The fixture is authored from the same side or same mental model as the code, or the fake omits the real system's rejection rules — so producer and consumer never meet and the suite ratifies the defect.                            | **14**                           | 05-23, 05-27, 05-28 ×2, 06-10, 07-02, 07-03, 07-15, 07-20, 07-31 ×2, 08-08 ×2, 08-10                                       | 1 · 2 (07-20 = permanently-lost real payment) · 4                                                                                    | Partial and per-case: one driver-parity spec, one Paddle round-trip spec. `require-tests-after-edit.sh` only nudges that _a file_ exists.                                                                                                                                                                                        | **PROMOTE NOW** — §8 DoD, folded into the A proposal (same meta-rule: prove it can fail).                                             |
| **E**  | **Check-then-act / effect outside its transaction** | A decision and its consequence are not atomic, so a competing writer, a crash, or an unrollbackable external call lands in the gap.                                                                                                  | **10**                           | 05-23, 06-05, 07-15, 07-20, 07-25 ×4, 07-26, 07-27 ×2, 07-31, 08-07                                                        | 1 · 2 (mail moved with no Activity row and no undo token — the log calls it "the single worst outcome this product can produce") · 4 | Partial: `require-idempotency.sh`; `architecture-guardian` Check C/H. **The 06-05 entry's promised prompt rule ("side effects inside `db.transaction` = BLOCKING") was never added** — verified absent.                                                                                                                          | **PROMOTE** — §2 invariant + close the agent-prompt gap.                                                                              |
| **F**  | **Two sides of a boundary never compared**          | FE↔BE, writer→provider→reader, old client↔new server, DB enum↔TS union: each side internally consistent, no test where they meet.                                                                                                    | **9**                            | 05-28, 05-31, 07-01, 07-02, 07-20, 07-21, 07-27, 07-28, 08-08                                                              | 1 · 2 (billing attribution; every already-delivered unsubscribe link) · 4                                                            | `schema-migration-reviewer` fired once on the Drizzle `.check()` mirror — but **by judgment; no such rule is written in its prompt** (verified).                                                                                                                                                                                 | **PROMOTE** — §8 DoD line.                                                                                                            |
| **G1** | **Automation harness manufactures a defect**        | Preview/automation tabs are `hidden` and unfocused, so anything gated on focus, visibility, or rendering steps (TanStack polls + retryer, IntersectionObserver, rAF, posthog init pageview, posthog bot filter) silently never runs. | **6**                            | 06-10, 07-02, 07-03, 07-04, 07-07, 07-31                                                                                   | 1 (log declared promotion due at the 2nd and again at the 3rd)                                                                       | **NOTHING.** Rediscovered from scratch roughly monthly.                                                                                                                                                                                                                                                                          | **PROMOTE NOW** — §8 smoke table row. Cheapest win in this audit.                                                                     |
| **G2** | **Foreign process served the smoke**                | A stale/orphaned worker or API from another session, checkout, or worktree answers the port or drains the queue, so the smoke observes code that is not under test.                                                                  | **4**                            | 06-05, 06-10, 07-28, + memory `gh-pr-close-switches-checkout`                                                              | 1                                                                                                                                    | Partial: `dev-up.sh` sweeps orphans **scoped to `$REPO_ROOT`** — by construction it cannot see sibling-worktree orphans, which is exactly the 06-10 and 07-28 cases. No cwd check on the listening process.                                                                                                                      | **PROMOTE** — one-line §8 smoke precondition + widen the sweep.                                                                       |
| **H**  | **Pipeline step that silently never gates**         | A workflow, spec, or flip is configured such that it never runs, never fires, or exits 0 on failure.                                                                                                                                 | **7**                            | 05-26 ×3, 05-27, 07-17, 07-20, 08-08 ×2, 08-10                                                                             | 1 · 4                                                                                                                                | **Largely CLOSED this month**: D158 removed the `branches: [main]` filter from ci.yml/branch-name.yml/subagent-gate.yml; billing e2e now runs in ci.yml; `infra-snapshots` branch bootstrapped 08-10. **Residual**: subagent-gate is a placeholder; 4 of 6 e2e specs run nowhere; `check-changelog` is lint-staged only, not CI. | **WATCH** — mostly fixed. Surface the residual (D1).                                                                                  |
| **I**  | **Re-derived a decision the repo already made**     | A settled question is answered from memory, keyword adjacency, or an index table instead of the deciding artifact (plan D-body, ADR, published `/privacy`).                                                                          | **9**                            | 05-20, 05-21, 05-23, 05-30, 07-17, 07-27, 07-28 ×2, 08-06                                                                  | 1 (the 05-30 entry set the bar at "twice more"; 07-17 and 07-27 are those two) · 2 (08-06 = consent/privacy)                         | §9 step 1 says "search the plan" — no rule about _which artifact decides_. §11 D-vs-ADR correction **has** landed (the one closed trigger).                                                                                                                                                                                      | **PROMOTE** — §3 citation rule.                                                                                                       |
| **J**  | **Irreversible bulk write with no pre-snapshot**    | A forcing or bulk mutation is issued without capturing prior state by primary key, so the "restore" invents state, or the damage is only recoverable by luck.                                                                        | **6**                            | 07-25, 07-28 ×2, 08-04, 08-06, 08-08                                                                                       | 2 (data loss, every instance) · 4                                                                                                    | `block-destructive-cloud-ops.sh` covers **prod cloud** ops only. Nothing covers `gh pr edit` loops, blanket dev-DB `UPDATE`s, or `git add -A <dir>`.                                                                                                                                                                             | **PROMOTE** — §10 line + §8 forcing-procedure clause.                                                                                 |
| **K**  | **Test-infra config drift**                         | A package gets PGlite + migration-driven tests without the sibling package's timeout/config profile; parallel agents each bootstrap it independently.                                                                                | **4**                            | 05-23 ×2, 05-26, 05-27, 05-28                                                                                              | 1 (marginal — 05-27 asked for a lint rule "on a third")                                                                              | None.                                                                                                                                                                                                                                                                                                                            | **WATCH** — low severity (CI flake, not user harm).                                                                                   |
| **L**  | **Dual-resolution dep phantom**                     | A caret range next to an exact-pinning consumer (bullmq→ioredis) splits the lockfile; TS reports "X is not assignable to X" and it reads as an API break.                                                                            | **2** (3 by the log's own count) | 07-01, 07-13                                                                                                               | 1 (the entry says "third occurrence — promote now; founder's call")                                                                  | **Root cause fixed** — spec now pinned exact in both packages, so the recurrence engine is gone.                                                                                                                                                                                                                                 | **PROMOTE as a runbook row, not a guardrail** — the diagnostic is what's worth keeping.                                               |
| **M**  | **Screen shipped without a responsive branch**      | A multi-column row grid ships with no `useIsAtMost('sm')` restack, so its minimum widths exceed 375 px and content clips or becomes unreachable.                                                                                     | **3**                            | 05-20, 07-09, 07-25                                                                                                        | 1 (the 07-09 entry set the bar at a 3rd; 07-25's clipped trust strip is it)                                                          | `design-system-agent` is the right owner but **has no responsive rule in its prompt** (verified) and its CI gate is a placeholder.                                                                                                                                                                                               | **PROMOTE** to the agent prompt, not to CLAUDE.md.                                                                                    |

**Cross-cluster note.** A, C, and D are three faces of one meta-rule and should be distilled as
a set, not separately: _a check, a fix, and a test are each only worth what their failure case
proves._ A = the check never saw its subject. D = the test could not have failed. C = the fix
was never run as a query over its own siblings. Promoting one without the others leaves the
other two doors open — which is precisely the shape of cluster C.

---

## 3. Proposed CLAUDE.md text

**These are PROPOSALS for the founder to accept, edit, or reject. Nothing here has been
applied.** Each is written in the file's existing voice and placed against an existing section.
Suggested vehicle: one `chore/distill-verification-discipline` PR carrying P1–P4 (they are one
idea), and a second `chore/distill-truth-and-scope` PR carrying P5–P8.

### P1 — §8, new subsection after "Flow & state completeness" — **BLIND GUARDS** (cluster A + D)

> ### Blind guards (a check that cannot fail has not run)
>
> A check whose subject is absent reports success. Every filter over an empty
> collection is clean, and clean prints green. This class has landed **14 times**
> (watchdog on a fictional enum; `[]`-on-failure in a drift detector; a spend
> guard graded on a free ratio; a changelog check over a depth-1 clone; a receipt
> check that never executed a comparison; a race test that passed with its fix
> reverted; a grep over a gzipped payload; a monitor red 8/8 since birth; an e2e
> spec whose candidate window no mailbox could satisfy).
>
> **Test any new guard's blind case FIRST — starve its input and require exit 1.**
> If it goes green on nothing, it is a green light, not a guard.
>
> Applies to hooks, CI jobs, watchdogs, monitors, e2e specs, and any test written
> to pin a fix:
>
> - **Print the evidence beside the verdict.** A check that cannot show what it
>   inspected has not run. `parsed == 0` is INVALID, never PASS.
> - **Revert the fix and watch the test go red** before believing it. A test that
>   has never been observed to fail proves nothing.
> - **Assert on the message, not the exit code.** When several checks share a
>   fixture, a neighbour will fail for you and look like proof.
> - **A `test.skip` on the path the spec exists to cover is a failure, not a pass.**
>   Reserve skips for degenerate environments; throw, with the observed values, when
>   the environment has candidates but none fit.
> - **A failed lookup must error, never fall through.** Of every `.get()` / `find()`
>   / `??` in verification code ask: if this misses, do I report a problem or report
>   success?
> - **Force the environment knob, not just the input** — clone depth, `TZ`,
>   `core.abbrev`, focus, locale.
>
> Same rule one layer up: a monitoring surface must distinguish _measured and fine_
> from _not measurable here_, and must grade in the units of the harm. Unreachable,
> absent, and empty are three states and must serialize distinctly. Never label a
> failure "transient" without retrying to find out, and never ship a scheduled
> workflow without dispatching it once and watching it go green.

### P2 — §1.3 "Surgical changes", appended — **FIX THE CLASS** (cluster C)

> **Fix the class, not the instance.** Surgical means _scoped to the request_, not
> _scoped to the line you were shown_. When a defect is found, name the class in one
> sentence and run that sentence as a query over the whole change — every sibling
> call site, every other writer to that column, every surface rendering that
> grammar, every variant along the axis the report varies on — **before** fixing
> anything and before writing it up. The write-up is where "done" feels earned,
> which is exactly why it must come after the sweep.
>
> Report what you found, what you fixed, and what you deliberately left alone.
>
> A fix whose rationale is a general principle is not done until that principle has
> been run as a query over every instance it indicts. If a fix is "add the case that
> was reported", stop and ask what the case is an instance of. If narrowing costs
> recall and widening costs precision, the boundary has no correct width — the
> constraint is a reading, not a match, and belongs in review.

### P3 — §8, "Definition of done", new bullet — **TESTS THAT CANNOT FAIL** (cluster D)

> - **Every new test has been observed to fail.** Revert the fix, watch it go red,
>   restore. A fixture that omits a discriminating field asserts that field is
>   irrelevant; a fake that does not replicate the real system's _rejection_ rules
>   is not a fake. For anything crossing a boundary — FE↔BE, writer→provider→reader,
>   migration↔schema, DB enum↔TS union — one test must feed the real producer's
>   output into the real consumer, naming the wire key exactly once.

### P4 — §8 "Smoke before merge", new subsection — **HARNESS ARTIFACTS** (clusters G1 + G2)

> ### The harness lies before the app does
>
> Before reporting _any_ negative observation from a browser smoke ("the event never
> fired", "the poll hung", "the error state never rendered", "the sentinel never
> loaded"), check the harness:
>
> - **A preview/automation tab is `hidden` and unfocused.** Anything gated on focus,
>   visibility, or the browser's rendering steps does not run there: TanStack
>   `refetchInterval` **and** its retryer, IntersectionObserver, rAF, ResizeObserver,
>   posthog-js's init `$pageview`. Force the state and re-observe, or verify
>   server-side (psql / API) before calling it a bug. Six sessions have been spent
>   rediscovering this.
> - **posthog-js drops every capture from an automated browser** (`navigator.webdriver`).
>   A negative analytics assertion therefore passes vacuously against a broken gate.
> - **Confirm which process is serving the port**, not just that the port answers:
>   `lsof -ti :4000 -sTCP:LISTEN | xargs -I{} lsof -p {} | grep cwd` must show the
>   checkout under test. One local Redis = one live worker, ever
>   (`pgrep -lf 'src/worker.ts'` → expect exactly one). Orphans from sibling
>   worktrees survive `dev-up.sh --stop`.
> - **Confirm the branch under your feet** — `git branch --show-current` — before
>   trusting a smoke run.
> - **In multi-agent smoke, treat `users.preferences`, `workspaces.tier` and the
>   browser session as volatile**: the preview harness shares one `localhost` cookie
>   jar across every port. Re-assert preconditions immediately before each step.

### P5 — §2, new guardrail **§2.7 — Surfaces assert only what they know** (cluster B)

> ### 2.7 Surfaces assert only what they know (D7 posture, generalized)
>
> The product's wedge is trust, so the dominant defect class here is a surface
> asserting something the system does not know. It has landed **26 times** and it is
> not confined to the frontend — it has shipped in telemetry, in a history table, in
> a public changelog, and in a launch-blocker call.
>
> Before rendering, emitting, or persisting a figure or a sentence:
>
> - **Name the scope out loud and check it matches the sentence.** Arrival vs
>   INBOX-now, all-labels vs inbox, per-attempt vs per-run vs per-mailbox. Two
>   numbers on one surface with different denominators must each name theirs, and a
>   zero that contradicts a visible figure must explain itself. A column name must
>   state the scale of what it measures.
> - **Never let one variable carry two meanings a user-facing sentence depends on** —
>   `pinned === 0` cannot mean both "nothing exists" and "nothing showable"; a bare
>   `refuted` cannot mean both refund and chargeback. Deriving "done" by subtraction
>   silently converts "I could not resolve these" into "the user finished these".
> - **An absolute needs its write path.** Before "all", "ever", "total", "every",
>   "cleared", "completes", find what makes the counter go down. If nothing does, it
>   is a monotonic observation, not a total. Automation copy must be walked over the
>   verb × lifecycle × **outcome** matrix — outcomes include failure.
> - **Intent is not outcome.** An optimistic row written at click time uses attempt
>   copy; the success claim is a separate row written only when the outcome is known.
>   An enqueue-and-return mutation must surface a completion signal that moves on
>   every run, no-ops included.
> - **Copy that names a cause must read `error.code`, never a bare 4xx status** — a
>   status says how it failed, never why, and `CurrentMailboxGuard` shares 409 with
>   `PROTECTED_SENDER`.
> - **No production surface may render a value derived from a seed, a pool, or a
>   fixture helper** — including behind `??`. §10 already bans this; it shipped twice
>   anyway.
> - **A surface asserting facts derived from another system ships with the diff
>   check that compares them** — and the check must be proven to fail on the defect
>   it was written for (then see §8, blind guards).

### P6 — §2.6, amend the D245 prelaunch bullet — **WATER LINES** (drift D2)

> - **Prelaunch means no hypothetical compatibility** (D245) — DeclutrMail is not
>   live and has no production users or production data. Remove superseded routes,
>   columns, contracts, fixtures, and docs directly unless a current technical
>   invariant—not an imagined legacy user—requires them.
>   **The doctrine stops at three water lines, each of which has already cost us:**
>   1. **Any migration already applied to a long-lived database** (prod, or a
>      persistent dev DB). Atlas tracks by version, not content, so editing an
>      applied `vN` never re-runs — it produced enum drift and hours of prod
>      downtime. Change it with `vN+1`.
>   2. **Any client bundle already deployed.** `apps/web` (Vercel) and `apps/api`
>      (Cloud Run) deploy independently, so enumerate all four combinations
>      (old/new client × old/new server). A change to the _client_ can only fix the
>      two rows where the client is new; protecting the deployed bundle is the
>      **server's** job.
>   3. **Any credential or URL already handed to a third party** — email links, QR
>      codes, provider tokens. These are a permanent wire format: add claims, never
>      rename or remove one. A uniform-200 "no oracle" contract turns every such
>      break into a silent one.

### P7 — §3 "Source-of-truth precedence", new paragraph — **CITATION** (cluster I)

> **Citation discipline.** When you invoke a D-number or an ADR, its **body** must
> decide the rule you are invoking it for. Topic adjacency is not citation; it is
> keyword pattern-matching. Specifically:
>
> - Never source a `Closes D###` from §4's topic table — that table maps topics to
>   ranges for navigation. Read the plan's `### D<N> —` line and quote its title in
>   the PR body so a wrong number is visible at review time. Removal ≠ `Closes`.
> - Before naming a derived or denormalized field in user-facing copy, check
>   `docs/adr/` for an ADR named after it (`ls docs/adr | grep -i <field>`) — the
>   wording may already be decided; then enumerate every writer; then verify against
>   the live DB.
> - **When a change touches consent, privacy, or retention, the controlling document
>   is what the product PUBLISHES** — read `/privacy` and `/cookies` in this repo and
>   quote the sentence the change has to satisfy. If the answer is arguable, it is
>   the founder's (§9), not yours to reason to.
> - When a design contradicts a recorded rejection, quote the rejection and state
>   which of its premises no longer holds — in the PR body. If none has changed, the
>   rejection stands.
> - Before offering the founder a choice, grep the plan for a D-decision on that
>   topic. Never present a settled topic as open.

### P8 — §10 "What NOT to do", new bullets — **IRREVERSIBLE WRITES** (cluster J)

> - **Do NOT issue a bulk or forcing write without a pre-snapshot.** Before any loop
>   that edits remote state (`gh pr edit`, provider APIs) or any dev-DB forcing
>   `UPDATE`: snapshot every current value to the scratchpad, trial the transform on
>   ONE item and verify it end-to-end, and make the write refuse content that is
>   empty or missing an expected marker. A forcing `UPDATE` and its restore must have
>   the same `WHERE` clause and the same row count — if the restore's predicate is
>   broader, it is not a restore. Restore by primary key; never reconstruct state
>   from a remembered aggregate.
> - **Do NOT `git add -A` / `git add .` / `git add <dir>`** in a checkout that other
>   sessions or agents may be using — stage the files you named, and read
>   `git show --stat` as the last thing before `git push`. Committing someone's
>   uncommitted work also removes it from their tree.
> - **Do NOT write a data statement into a migration rollback that restores the
>   system's ability to mutate user data.** A rollback reverts schema; any data
>   statement in it may only DISARM (expire tokens, fail jobs, clear id sets).
>   Restoration accuracy and restoration safety are different properties.
> - **Do NOT terminate a record without asking what irreversible external effect it
>   may already have caused.** A cleanup that cannot distinguish "never started" from
>   "already happened" must refuse to run, not guess — and the check belongs where
>   EVERY exit from the code path passes through it.
> - **Do NOT derive `pg_enum` values from a JS structure.** Constants module owns the
>   agreement; migrations are explicit and append-only.
> - **Do NOT hand-edit `packages/db/migrations/atlas.sum`** — see drift item D6
>   before adopting this one; the two logs disagree on whether it is reproducible.

---

## 4. Unenforced recurring patterns, ranked

Ranked by (recurrence × blast radius × absence of any mechanical stop). **Every row here will
happen again as-is** — each has already recurred _after_ its own log entry declared the rule.

| Rank   | Pattern                                        | Occ. | What actually stops it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **Blind guard** (A)                            | 14   | **A CI job + a hook, not prose.** (a) `scripts/check-guards.sh` run in CI: for every `scripts/check-*.sh` and `scripts/*.ts` verification script, execute it against a starved fixture (empty git walk, empty query result, absent secret) and require **exit ≠ 0**; fail the job if any exits 0. (b) A CI step that fails when a Playwright run reports `skipped > 0` on the specs listed as required coverage — the 08-10 defect is invisible today because green is the expected colour. (c) `require-tests-after-edit.sh` upgraded from "a test file exists" to "the diff touches a test file **and** the PR body records the observed-red evidence". |
| **2**  | **Fixed the instance, shipped the class** (C)  | 24   | **The gate agents' report format.** No grep finds this. Add to every gate + advisory agent prompt a mandatory closing section: _"Class sweep — name the defect class in one sentence, list every sibling site you searched, and state which you left alone and why."_ An agent that reports a finding without the sweep section is incomplete. This is the single highest-value prompt change available, because Codex already catches the class in rounds 3–10; the cost is the rounds.                                                                                                                                                                  |
| **3**  | **Surface asserts what it does not know** (B)  | 26   | Three cheap mechanical slices of a class that is otherwise a reading: (a) extend `check-microcopy.sh` with a **fixed-string** ban on completeness absolutes (`Total ever`, `all[- ]time`, `\bever\b`, `lifetime`) in `apps/web/**` and `packages/shared/**` — note ADR-0030's lesson that proximity rules do **not** belong in a hook; (b) a lint rule banning `??` fallbacks whose right-hand side imports from a `**/fixtures/**`, `**/mocks/**`, or `data.ts` module; (c) promote `flow-completeness-auditor` to GATE tier on `apps/web/src/app/**` (see D3).                                                                                          |
| **4**  | **Green test that encodes the bug** (D)        | 14   | The **driver-parity spec pattern already invented on 2026-07-15** (wrap the PGlite `query` and fail on any raw `Date`), generalized: a shared test helper in `packages/db/tests` that every PGlite suite installs, plus a CI check that any package importing `@electric-sql/pglite` also imports the parity helper. Second half: an ESLint rule flagging a spec that asserts a literal string also present in a sibling fixture file (producer and consumer never meet).                                                                                                                                                                                 |
| **5**  | **Harness artifacts** (G1)                     | 6    | Not a hook — a **checklist line in `.claude/agents/flow-completeness-auditor.md` and in §8** (P4). Six sessions have paid for this from scratch; the fix is that the knowledge is written down where a smoking session reads it, which today it is not.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **6**  | **Check-then-act / effect in transaction** (E) | 10   | **The `architecture-guardian` prompt rule promised on 2026-06-05 and never written.** Add explicitly: _"[BLOCKING] — any of {`queue.add`, Stripe/provider call, outbound HTTP, email send, Sentry/PostHog capture} inside a `db.transaction(...)` callback"_ and _"[BLOCKING] — a read-then-write guard whose read is outside the write transaction or its lock"_. Verified absent from the file today.                                                                                                                                                                                                                                                   |
| **7**  | **Irreversible bulk write, no snapshot** (J)   | 6    | Extend `block-destructive-cloud-ops.sh` (which today covers prod cloud only) to a **PreToolUse warn** on: `gh pr edit` inside a loop, `git add -A`/`git add .`/`git add <dir>`, and any `UPDATE`/`DELETE` piped to `psql` without a preceding `CREATE TEMP TABLE`/`COPY … TO` in the same session. Warn-and-confirm, not block — these are legitimate operations done carelessly.                                                                                                                                                                                                                                                                         |
| **8**  | **Boundary never compared** (F)                | 9    | Write the rules the entries _claimed_ were added but were not: `schema-migration-reviewer` — "every migration-level CHECK has a matching `.check(name, sql)` with an identical constraint name in `packages/db/src/schema/`"; `type-design-analyzer` — "a FE wire literal union must be asserted against the BE/DB enum by at least one test".                                                                                                                                                                                                                                                                                                            |
| **9**  | **Foreign process served the smoke** (G2)      | 4    | Two lines of shell: widen `dev-up.sh`'s orphan sweep beyond `$REPO_ROOT` to any cwd matching the repo name (including `../wt-*` worktrees), and add a `dev-up.sh --verify` that prints the cwd of whatever holds `:4000` and `:3000`. Today the sweep provably cannot see the case that has bitten twice.                                                                                                                                                                                                                                                                                                                                                 |
| **10** | **Screens without a responsive branch** (M)    | 3    | A rule in `.claude/agents/design-system-agent.md` (which has none today): _"a feature screen with a multi-column `gridTemplateColumns` must resolve `useIsAtMost('sm')` and branch, or justify why not."_ Contingent on D1 — the agent's CI gate is currently a placeholder.                                                                                                                                                                                                                                                                                                                                                                              |

### 4b. Meta-finding: "Enforcement update: agent prompt" is itself an unverified claim

Five MISTAKES entries record an enforcement update to an agent prompt. **Four were never
applied** — verified by reading the agent files today:

| Entry                            | Claimed enforcement                                                                                               | Present in the agent file?                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-06-05 (BullMQ in tx)        | `architecture-guardian`: "side effects inside a `db.transaction` callback = BLOCKING"                             | **No**                                                                       |
| 2026-05-23 (correlated subquery) | `silent-failure-hunter` / `architecture-guardian`: "correlated subquery without qualified outer identifier"       | **No**                                                                       |
| 2026-05-26 (ARCH-DRIFT)          | `architecture-guardian` Check F hard-fails on `TODO(D###)`; Check C schema-ownership                              | **Partial** — Check C states the D204 rule generally; no `TODO(D###)` clause |
| 2026-07-21 (CHECK constraints)   | "schema-migration-reviewer already checks this; it fired as designed"                                             | **No written rule** — it fired on judgment, so the next run may not          |
| 2026-05-27 (per-iteration catch) | `silent-failure-hunter`: flag per-iteration try/catch that logs and swallows in a loop with external side effects | **Not as specified**                                                         |

This is cluster A applied to the improvement loop itself: an enforcement claim recorded as
done, never verified, that reads as coverage. It is the strongest argument in this audit for
P1's "print the evidence beside the verdict" — and it means the _existing_ backlog of promised
prompt rules is a higher-yield fix than any new CLAUDE.md paragraph.

---

## 5. Satisfied-but-unactioned distillation triggers

Entries whose own `Distillation trigger` line has already fired. **19 open, 1 closed.**

| Entry                                                                      | Its own trigger                                                                                      | Status                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| L 2026-08-11 — Two more blind guards                                       | "fifth and sixth time … **Promote now**"                                                             | **OPEN**                                                              |
| L 2026-07-31 — A grep over a compressed payload is vacuously clean         | "fourth occurrence. A CLAUDE.md §8 line is now **overdue**"                                          | **OPEN**                                                              |
| M 2026-08-10 — A new e2e spec was permanently skipped                      | "if a third … appears, CLAUDE.md §8 candidate — currently lives only in session memory"              | **OPEN** (already ≥3)                                                 |
| M 2026-07-29 — Shipping a guard that passes when it cannot see its subject | names it "the FOURTH instance of this class here"                                                    | **OPEN**                                                              |
| M 2026-07-26 — captured-and-empty                                          | "**fifth** occurrence … triggers #1 and #4 both met. Candidate guardrail for the founder to distill" | **OPEN**                                                              |
| M 2026-07-26 — ratio that could not cost money                             | "triggers **#1 and #4** are both met. Candidate §2 guardrail"                                        | **OPEN**                                                              |
| M 2026-08-06 — Wrote my own privacy contract                               | "a third promotes it to a CLAUDE.md §2 candidate … beyond the frontend"                              | **OPEN** — 2026-08-07 was the third                                   |
| M 2026-07-04 — fixture fallback behind `??`                                | "Class has now recurred **3×** — distillation candidate for CLAUDE.md §10"                           | **OPEN**                                                              |
| M 2026-07-15 — raw-sql Date params                                         | "**Third recurrence** … distillation candidate for CLAUDE.md §2/§8"                                  | **OPEN**                                                              |
| L 2026-07-31 — automation tab is `hidden`                                  | "if a third visibility/focus-gated false positive appears"                                           | **OPEN** — it was the third                                           |
| L 2026-07-04 — headless preview + IntersectionObserver                     | "**2nd instance** — promote a … line to CLAUDE.md §8 smoke table"                                    | **OPEN**                                                              |
| L 2026-07-13 — dual-ioredis phantom                                        | "**third occurrence** — promote a dependabot-runbook row … **now**; founder's call"                  | **OPEN**                                                              |
| L 2026-05-25 — cron workers need bounded fan-out                           | "**Count: 3/3** — promotion candidate already"                                                       | **OPEN**                                                              |
| L 2026-05-29 — never hand-edit `atlas.sum`                                 | unconditional: "promote to CLAUDE.md §4 … given this burned a full CI cycle"                         | **OPEN** — but see D6                                                 |
| L 2026-05-30 — DB enums are append-only                                    | unconditional: "promote to CLAUDE.md §10"                                                            | **OPEN**                                                              |
| L 2026-05-19 — verify, don't delegate verification                         | "Recurrence ≥2 … is a strong enough signal"                                                          | **OPEN** — L 2026-05-22 records the 2nd                               |
| M 2026-05-28 — D204 boundary                                               | "**3rd** D204 data point — the distillation trigger (recurrence ≥3) **is met**"                      | **OPEN** (agent prompt, not CLAUDE.md)                                |
| M 2026-06-26 / L 2026-06-26 — adversarial review beats single-pass         | "promote to §7/§8 if a third wave of green-but-broken PRs appears"                                   | **OPEN** — the 07-20 billing arc (11 defects, none found by CI) is it |
| L 2026-07-09 — screens need a `useIsAtMost('sm')` branch                   | "if a **3rd** screen ships without one"                                                              | **OPEN** — M 2026-07-25's clipped topbar is the 3rd                   |
| L 2026-07-28 — "D or ADR?"                                                 | "promote to CLAUDE.md §11 **now**"                                                                   | ✅ **CLOSED** — §11 carries the corrected rule verbatim               |

**One closed out of twenty.** The §11 loop's write half works; its read half has no actuator.

---

## 6. Plain-drift — logs vs current CLAUDE.md (§3: founder's call, surfaced unresolved)

### D1 — §7 says the gates run on every PR. In CI, they do not.

`CLAUDE.md` §7: _"Pre-merge gates that run on every PR. **5 must-pass** + 4 advisory"_, and §8's
Definition of Done requires _"No gate agent has unresolved blocking comments."_

`.github/workflows/subagent-gate.yml`'s only job after path detection is `report`, whose own
output reads:

> `NOTE: Agent invocation is currently advisory only. Real Claude API runs land when ANTHROPIC_API_KEY is configured in repo secrets.`

So the five GATE-tier agents run only when a session invokes them by hand. Every MISTAKES entry
phrased _"every structural gate was green"_ is, for CI purposes, a statement about a gate that
did not run. This is itself the blind-guard class at the process layer, and it is the reason
several rank-2/6/8/10 fixes above are worth less than they look until it is resolved.
**Founder's call:** wire the API key and make the gates real, or amend §7 to state plainly that
gates are agent-invoked and CI reports scope only.

### D2 — §2.6's prelaunch "no hypothetical compatibility" vs three shipped incidents

The D245 bullet instructs removing superseded contracts _directly_. Three entries record what
that costs at a boundary the doctrine does not carve out: an in-place edit to an already-applied
migration (**prod enum drift, ~15h silent, hours of downtime**, 2026-07-15); a wire-shape change
between independently deployed Vercel/Cloud Run services (**would have taken down the D226
confirm modal live**, 2026-07-27); and a JWT claim rename that **silently killed every
unsubscribe link already in someone's inbox** behind a uniform 200 (2026-07-28). P6 drafts the
three water lines. **Founder's call** — this is an edit to a §2 hard rule.

### D3 — §8 assigns flow enumeration to an ADVISORY agent

§8 "Flow & state completeness" ends _"The `flow-completeness-auditor` agent (§7) does this
enumeration on PRs."_ §7 lists it as advisory. MISTAKES 2026-08-08 (`#481`, a missing escape
hatch in the error state of onboarding's last step, merged with full CI green and 1712 tests):

> _"`flow-completeness-auditor` … is the gate meant to catch exactly this … and it is advisory,
> so it did not run. Worth considering for the gate tier on `apps/web/src/app/**` route files."_

**Founder's call:** promote the tier for route files, or soften §8's sentence.

### D4 — §11 bans calendar distillation; pattern-based distillation has no actuator

§11: _"Do NOT distill on a calendar. Pattern-based catches what matters."_ The observed record
is **19 satisfied triggers open across 85 days, 1 closed**, with at least four classes recurring
_after_ their own entry declared the threshold met (blind guard: 4th → 5th → 6th; captured-and-
empty: 3rd → 5th; fixture fallback: 3rd → 4th; instance-not-class: three violations in one
session while citing the rule). Not a contradiction in wording — a gap between the rule and any
mechanism that fires it. **Founder's call** whether to add one (candidate: a CI check that fails
when a log entry declares a trigger met and no `chore/distill-*` PR references that entry within
N merges — noting P1 applies to that check too).

### D5 — §10 already bans fixture data in production paths; it shipped twice anyway

§10 forbids _"Hard-coded test data in production code paths."_ MISTAKES 2026-07-03 (seeded
sparkline as production UI) and 2026-07-04 (fixture subjects behind `??` on the D226 trust
surface) are two shipped violations of that exact line. **This is evidence about method, not
about wording:** for cluster B, the missing thing is a lint rule (rank 3b), not another
sentence. Worth weighing before accepting P5 — some of P5 may be re-stating rules that already
exist and are simply unenforced.

### D6 — two LEARNINGS entries contradict each other on `atlas.sum`

- **2026-05-29:** _"`atlas.sum` CANNOT be hand-computed … Atlas canonicalizes the SQL before
  hashing, so the hash is not reproducible from file bytes alone"_ → asks for a §4 line
  "never hand-edit atlas.sum".
- **2026-05-31:** _"Atlas `atlas.sum` **is** reproducible offline (no atlas binary needed)"_ —
  with a stated algorithm _"verified to byte-reproduce all 18 existing entries."_

Both stand in the file, two days apart, with no cross-reference; the second is the one later
work relied on. **Founder's call** which is authoritative before P8's last bullet is adopted —
the safest reading is "never hand-edit _from a guessed algorithm_; a regeneration is acceptable
only when it byte-reproduces every pre-existing entry first", which is itself an instance of P1.

---

## 7. Recommended sequencing (if all of the above is accepted)

1. **`chore/distill-verification-discipline`** — P1 + P3 + P4 (+ rank-1 CI job, rank-2 agent
   prompt section). One idea, three placements. Closes 8 open triggers.
2. **Backfill the five never-applied agent-prompt enforcement updates** (§4b). No CLAUDE.md
   change; highest yield per line; unblocks ranks 6, 8, 10.
3. **Resolve D1** — until the gates actually run in CI, ranks 2/6/8/10 are advisory in practice.
4. **`chore/distill-truth-and-scope`** — P2 + P5 + P7 + P8, after weighing D5.
5. **P6 (§2.6 water lines)** separately — it edits a hard rule and deserves its own review.
