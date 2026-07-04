# Mistakes — DeclutrMail

Append-only log of mistakes and the rules added so we never repeat them.

See CLAUDE.md §11. Append when a gate fires, a bug ships and is caught
later, or an approach turns out wrong.

## Entry format

```markdown
## YYYY-MM-DD — Short title
**PR:** #NNN (link)
**Caught by:** <gate name | manual test | user report | production>
**What happened:** factual description
**Correct approach:** what should have been done
**Rule:** <one-line, immediately actionable>
**Enforcement update:** <hook change | agent prompt update | CLAUDE.md edit | none>
```

---

<!-- Entries go below. Newest at the top. -->

## 2026-06-05 — Stale dev worker process from a prior session intercepted BullMQ jobs with pre-Delete-verb code

**PR:** (this branch — caught during D38 smoke 2026-06-05)
**Caught by:** manual Delete smoke fired with `unknown action verb delete` ValidationError despite the verb existing in every registry / enum (action_verb pg_enum, ACTION_REGISTRY, PIPELINE_COMPLETE_VERBS, ActionLabelAppliedPayloadSchema). Diagnostic console.logs added at `execute()` entry never fired even after a `./scripts/dev-up.sh --stop && ./scripts/dev-up.sh` cycle. `ps aux | grep worker.ts` revealed a **second `node ... worker.ts` process started May 29** still alive, intercepting jobs in parallel with the freshly-restarted one.
**What happened:** `./scripts/dev-up.sh --stop` (line 821-832 in `apps/api/src/worker.ts`) closes the BullMQ Workers + Redis connection cleanly, but the parent `pnpm --filter @declutrmail/api worker` shell wrapper doesn't always propagate SIGTERM to the actual `node --import @swc-node/register/esm-register src/worker.ts` child. The May 29 worker's TS module graph was loaded BEFORE ADR-0019 added the Delete verb to the Action Registry (ACTION_VERBS, ACTION_REGISTRY, PIPELINE_COMPLETE_VERBS, ActionLabelAppliedPayloadSchema). `labelChangeForVerb('delete')` on that old graph threw `ValidationError('unknown action verb delete')` — a message that literally no longer exists in current source, which made the bug nearly impossible to grep into. BullMQ workers compete for jobs from the same queue, so any single delete attempt had a ~50/50 chance of hitting either consumer — the only fix was to kill the stale PID.
**Correct approach:** On every dev-up restart, verify there's exactly ONE `worker.ts` process per queue. `dev-up.sh` should add a sanity check before starting the new worker: `pgrep -f "worker\\.ts" | xargs -r kill -9` (or scope by cwd). Alternative: a `worker-startup` log line that includes a build-time hash / commit short SHA so an old process is visibly identified by its hash differing from the running source tree.
**Rule:** Before debugging a "code-doesn't-match-behavior" mystery in a dev worker, ALWAYS check `ps aux | grep worker\.ts` for multiple instances. swc-node uses in-memory module compilation; a process that was started before a code change keeps the OLD source graph until it exits, no matter how many file edits happen. The grep-the-codebase-for-the-error-message reflex fails when the error originates from a process holding a version of the source that no longer exists on disk.
**Enforcement update:**
1. `scripts/dev-up.sh` — add a pre-start `pkill -f "apps/api/src/worker\\.ts" || true` sweep gated on the project-root cwd so concurrent dev-ups in OTHER repos aren't affected.
2. Worker boot — log a structured `worker.boot { gitSha, startedAt, pid }` line; a quick `tail` against the log file shows whether the running process matches `git rev-parse HEAD`.
3. CLAUDE.md §8 "Smoke before merge" — add a one-line note: "When smoking a worker change, verify exactly one `worker.ts` process is running before issuing the test action."

## 2026-06-05 — BullMQ `queue.add` inside `db.transaction(...)` callback publishes job BEFORE PG commits

**PR:** (this branch, fixed pre-merge — `04c8546`)
**Caught by:** architecture-guardian critic pass — [BLOCKING]
**What happened:** Closing the `gmail-webhook.service.ts:151` TODO, the enqueue was added inside the existing `this.db.transaction(async (tx) => { ... await ensureIncrementalSyncJob(...) ... })` callback. The inline comment claimed "the enqueue happens AFTER the tx body but BEFORE the tx commits" — wrong. Awaiting `queue.add` inside the Drizzle tx callback publishes the BullMQ job (durable in Redis the instant `add()` resolves) before the transaction's resolved value gets committed. A commit failure between `add()` returning and the COMMIT statement landing would leave the job durable while the dedup row + cursor advance get rolled back — the worker would then run against the OLD `last_history_id`, silently regressing history.
**Correct approach:** External side effects that the transactional store can't roll back (BullMQ, HTTP calls, emails) MUST run AFTER `await db.transaction(...)` resolves. Capture the values needed for the side effect inside the tx, return them from the callback, dispatch the side effect from the post-`await` continuation. `SyncModule.connect` (initial-sync enqueue path) already follows this contract.
**Rule:** When ANY of {BullMQ, Stripe, Sentry capture, outbound HTTP, email} appears in a code path that also opens a PG transaction, place the side effect OUTSIDE `db.transaction(...)`. The discriminated outcome union is the carrier — keep the tx body pure DB writes, dispatch external effects in the continuation. Mirror: never trust an inline comment that says "AFTER the tx body" — verify by reading the closure structure.
**Enforcement update:** architecture-guardian agent prompt — add an explicit check: "external side effects (queue.add, Stripe, HTTP, email) inside a `db.transaction` callback = BLOCKING". MISTAKES.md log + the two new tests in `gmail-webhook.service.spec.ts` (`enqueue happens AFTER the tx commits — observable ordering` + `enqueue failure does NOT roll back the tx`) document the invariant by example.

## 2026-05-27 — Raw `sql\`\`` template interpolation of a JS `Date` failed Bind on postgres-js@3.4.9 / Node v24

**PR:** [#117](https://github.com/CT2689-Tech/DeclutrMail/pull/117) — `fix(workers): serialise Date params in raw sql templates (D86)`
**Caught by:** founder (manual `dev-populate` run against real Postgres
surfaced `followup.mailbox_failed` for every mailbox; CI was green
because the test driver doesn't reproduce the bug).
**What happened:** [packages/workers/src/followup-check.worker.ts:246](packages/workers/src/followup-check.worker.ts:246)
interpolated `lookbackCutoff` (a `Date`) directly into a `sql\`\`` template:
```ts
AND internal_date > ${lookbackCutoff}
```
On the production driver (`postgres@3.4.9`, Node v24) Bind tried
`Buffer.byteLength(Date)` and threw `ERR_INVALID_ARG_TYPE`. The
per-mailbox try/catch swallowed it into a structured
`followup.mailbox_failed` log, so the whole sweep ran to completion
reporting `mailboxesFailed: N`, `awaitingUpserted: 0` — silently empty.
**Why CI didn't catch it:** the followup-check vitest suite uses
[PGlite](packages/workers/src/followup-check.worker.test.ts:4) as the
test driver. PGlite serialises a JS `Date` to a timestamp parameter
without complaint, so the fixed and broken code both passed all 10
existing integration tests. The bug only manifests against the real
postgres-js bind path.
**Correct approach:** Convert dates explicitly before passing them
through raw `sql\`\`` template literals — `${cutoff.toISOString()}`. The
ISO-8601 string casts losslessly into `timestamptz` and is unambiguous
across drivers. Drizzle's typed comparators (`gte()`, `lt()`, etc.)
auto-serialise, so a builder-style rewrite is an alternative; the raw
template stays whenever the SQL needs DISTINCT ON / CTEs that the
builder can't express ergonomically.
**Rule:** In any raw `sql\`\`` template (workers OR services), do NOT
interpolate `Date` / `BigInt` / typed wrapper values directly. Convert
to the corresponding canonical string form (`.toISOString()` for dates,
`.toString()` for bigints) before interpolation, OR switch to the
Drizzle typed comparator if the SQL allows it.
**Enforcement update:**
- 1-line fix shipped + explanatory comment at the call site naming the
  driver version and node version so the next developer doesn't have to
  rediscover the trap.
- Until D182 (testcontainers) lands, the regression isn't catchable in
  CI. Once we have a `@testcontainers/postgresql` fixture, every raw
  template in workers / services should run through it; until then,
  the only safety net is reviewer eyeballs + this rule.
- Add `silent-failure-hunter` prompt rule: flag any per-iteration
  try/catch that only logs structured + swallows when the loop drives
  externally-observable side effects (the followup sweep silently
  reported empty for every mailbox).

## 2026-05-27 — `testTimeout: 30s` set but `hookTimeout` left at default 10s — PGlite 0.4 bump tipped CI red

**PR:** [#97](https://github.com/CT2689-Tech/DeclutrMail/pull/97)
**Caught by:** CI on rebased dependabot minor+patch group bump
(consistent failure on `apps/api` and `packages/workers`:
`Hook timed out in 10000ms` inside `beforeEach` migration replay).
**What happened:** The 2026-05-26 fix to give `packages/workers` a
`vitest.config.ts` raised `testTimeout` to 30s but did NOT also
raise `hookTimeout`. Vitest's `hookTimeout` defaults to 10s
independently of `testTimeout`. PGlite 0.4 (bumped from 0.2 in the
deps group) made `beforeEach` migration replay slow enough on CI
runners to blow the default 10s `beforeEach` budget while still
fitting under the 30s `it()` budget — invisible until the bump
landed. `apps/api` had no vitest config at all, so it inherited
both defaults.
**Correct approach:** Raise `hookTimeout` to match `testTimeout`
whenever the package uses PGlite + migration-driven `beforeEach`.
Both knobs travel together, not independently. The "copy the
config profile from `packages/db`" rule should mean ALL four
PGlite knobs (`testTimeout`, `hookTimeout`, plus the `include`
pattern + the comment explaining why), not just the one that
caught the last regression.
**Rule:** Any package with PGlite + migration-driven integration
tests MUST set BOTH `testTimeout: 30_000` AND `hookTimeout: 30_000`
in its `vitest.config.ts`. Patch the 2026-05-26 entry's rule the
same way.
**Enforcement update:** none yet. If this recurs (third PGlite
package shipped with wrong defaults), promote to a lint rule that
scans for `pglite` imports + asserts both timeout knobs are set.

## 2026-05-26 — `packages/workers` had no vitest config → CI default 5s timeout flaked PGlite tests

**PR:** [#98](https://github.com/CT2689-Tech/DeclutrMail/pull/98)
**Caught by:** CI on main (consistently red on `OutboxDispatcherWorker
> LISTEN handler wakes a tick before the polling interval fires`,
then on `AFTER INSERT trigger emits pg_notify on the outbox_inserted
channel` once the first was patched — same root cause, different
victim test)
**What happened:** `packages/workers` shipped without a
`vitest.config.ts`, so its tests ran under vitest's default
`testTimeout`. Every integration test in that package spins up PGlite
+ applies every migration per `it()` (~3-10s of fixture work on CI
before the test logic even starts). Sister package `packages/db` —
same fixture profile — already set `testTimeout: 30_000`; workers
just never got the same treatment. First attempt fixed only the one
failing test (`it(..., 15_000)`) which made the next-longest test in
the file the new flake. Second attempt fixed the package globally
via config.
**Correct approach:** When adding a package that runs PGlite +
migrations per test, copy the vitest config profile from `packages/db`
(`testTimeout: 30_000`) at the same time. Don't fix flakes test-by-
test when the timeout budget is package-wide.
**Rule:** Any package with PGlite + migration-driven integration
tests MUST have a `vitest.config.ts` with `testTimeout` ≥ 30_000. New
packages of this shape MUST be onboarded with the config in the same
PR as the first integration test.
**Enforcement update:** none yet. Candidates if it recurs: a lint rule
or CI check that fails when a package contains `*.test.ts` importing
`@electric-sql/pglite` but no `vitest.config.ts` with `testTimeout`
set. Hold for now — single recurrence, easy to spot in review.

## 2026-05-26 — Five reviewable bugs caught by Codex across the Variant D + Autopilot stacks

**PRs:** #64 (db), #65 (workers), #77 (api adapter), #78 (events),
#82 (web — gate), #83 (web — settings)
**Caught by:** Codex review (post-push, pre-merge)
**What happened:** Five distinct bugs, all caught on the same review
sweep. Notable that they share an underlying pattern: **partial
application of new logic** — a rule was introduced at one site but
not extended to the parallel sites that exercise the same data path.

  1. PR #82 — added `intentOf()` confidence gate in `groupByIntent`
     but left two other call sites (`onStartReview()`, `computeTotals`)
     filtering on the raw `lastReview.verdict`. The Cleanup bucket
     suppressed low-confidence verdicts; the hero CTA + KPI cells
     did not.

  2. PR #83 — `useSenders()` is an infinite query. The new screen
     `flatMap`'d only the first page. API clamps `limit` to 100 →
     any protected sender past row 100 was invisible on a screen
     whose contract is "every standing policy lives here".

  3. PR #78 — `EVENT_SCHEMAS` comment claimed `satisfies
     Record<EventTopic, ZodSchema>` exhaustiveness, but the actual
     declaration was only `as const`. A new topic in `TOPICS`
     without a schema entry would compile clean and fail only at
     the runtime parity test.

  4. PR #65 — `newsletter_graveyard` (`lastSeenDaysAgo > 90`) and
     `long_dormant_unsubscribe` (`> 180`) had overlapping windows
     w/ identical `actionKind: 'unsubscribe'`. A sender at 200d w/
     low read rate fired BOTH presets → two unsubscribe-match rows
     for a single sweep.

  5. PR #64/#65 — match insert was plain `INSERT VALUES (...)` with
     no dedup. Re-running the worker created N duplicate pending
     suggestions for the same `(rule, sender)` until the user
     resolved one — flooding the suggestion UI.

**Correct approach (per finding):**
  1. Reuse `intentOf(s) === 'cleanup'` everywhere; never re-derive
     "is this Cleanup?" from raw fields after a centralizing helper
     exists.
  2. For "list every X" screens, auto-paginate via `useEffect` →
     `fetchNextPage` loop with a hard cap, OR add a dedicated
     filtered endpoint.
  3. `as const satisfies T` is the canonical exhaustiveness pattern;
     neither half alone suffices.
  4. Disjoint windows by construction; never two unsubscribe-class
     presets overlap on the same predicate axis.
  5. Pair every match-insert with a DB-level partial unique idx +
     `onConflictDoNothing({ target, where })` mirroring the
     predicate.

**Rule:** When a new helper / gate / index centralizes a decision,
grep ALL call sites of the parallel raw-field check and migrate
them in the same PR. Centralization without migration is a worse
state than no centralization — it creates a quiet two-truths bug.

**Enforcement update:** None directly. Indirect: continue running
Codex review after every push during the multi-PR-stack workflow —
the failures here were detectable by a reviewer that grep'd for
parallel use of the gated field, which the existing review prompt
already encourages.

## 2026-05-22 — InitialSyncWorker could not sync a mailbox larger than ~3,000 messages
**PR:** #17 (`feat/d157-initial-sync-worker`) shipped the bug; fixed in `feat/d005-sync-quota-hardening`
**Caught by:** manual test — connecting a real 20K-message Gmail account
**What happened:** PR-C's `InitialSyncWorker` fetched message metadata
behind a concurrency cap (`FETCH_CONCURRENCY=20`) but NO rate limiter.
§5 says "throttle per D5" — a concurrency cap is not a rate limit. A
20K-message backfill burst past Gmail's per-user quota (15,000 units /
user / minute; `messages.get` = 5 units → 3,000 messages/min) and got
403 "Quota exceeded" at exactly 3,000 messages. Worse: (1) the 403 was
classified as `TransientError` because only 429 mapped to
`RateLimitError`; (2) the worker had no checkpointing, so each of the 5
retries restarted from message 0, re-hit the quota, and dead-lettered.
Net: any mailbox over ~3,000 messages could never sync. The two small
test accounts (327, 140 messages) passed only because they sat under
the ceiling — small-sample testing hid it.
**Correct approach:** A real rate limiter pacing Gmail calls under the
per-user quota; classify Gmail 403-quota AND 429 as `RateLimitError`;
make the sync resumable (`mail_messages` IS the checkpoint — skip
already-stored ids on retry) so an interruption never restarts from 0.
All three shipped in the hardening PR.
**Rule:** A "throttle" requirement means a rate limiter, not a
concurrency cap. Any worker calling a quota-metered API MUST (a) pace
under the documented quota and (b) be resumable — never restart a
multi-minute job from zero. Test workers against data above the
provider's per-window limit, not just small samples.
**Enforcement update:** none yet — candidates: an `architecture-guardian`
check that a quota-metered worker declares a limiter, and a load-shaped
worker test. Logged for distillation if the pattern recurs.

## 2026-05-21 — Presented a "new" token-encryption decision that D14 already made
**PR:** #14 (`docs/d039-senders-backend-plan`) — caught before merge
**Caught by:** self — a plan grep for `D14` while finalizing the config file,
after the founder had already OK'd the wrong option.
**What happened:** PR-B needs OAuth-token encryption. I framed it to the
founder as an open choice — "app-level AES-256-GCM vs Cloud KMS" — and
recommended AES-256-GCM. The founder OK'd it. But **D14 is a locked
decision** that already mandates Google Cloud KMS envelope encryption,
and D14 explicitly argues against an env-var-class key. I had written
the choice into `senders-backend-plan.md` §4 and `FOUNDER-FOLLOWUPS.md`
as "RESOLVED — AES-256-GCM" before checking the plan. No code shipped;
caught while writing `.env.example`. Surfaced as plan-drift; founder
confirmed D14 stands; all docs corrected.
**Correct approach:** Before presenting ANY decision as open, grep the
plan for an existing D-decision on that topic. CLAUDE.md §1.1 says
"First, check the plan" — a token-encryption decision is exactly the
kind of thing the plan already settles. Had I grepped `D14` first, there
would have been no decision to present.
**Rule:** Before offering the founder a choice, `rg "encrypt|<topic>"`
the plan — if a D-decision covers it, follow it; only surface a *conflict*
if the codebase reality diverges. Never present a settled topic as open.
**Enforcement update:** none code-level — this is a §1.1 discipline miss.
Promote to CLAUDE.md §9 ("What to do if unsure" → step 1 already says
search the plan; reinforce it covers *decisions I'm about to present*,
not only blockers) if it recurs.

## 2026-05-20 — Visual pass shipped a desktop-only layout + a search dead-end
**PR:** #TBD — `feat/d038-senders-screen` (visual-optimization pass)
**Caught by:** Codex adversarial review + a browser check at 401 px
**What happened:** Two regressions in the visual-optimization pass.
(1) `sender-list-row.tsx` replaced an `auto` action column with a hard
`156px`. Row alignment was fixed, but the row's minimum width now
exceeds a phone viewport, and the parent scroll area clips overflow, so
row actions become unreachable. A browser check at 401 px showed the
whole shell non-responsive — the 220 px sidebar never collapses and
content is crushed to ~190 px. (2) The new `SenderSearch` typeahead drew
suggestions from the full sender list while the table stayed filtered by
category/facet; picking a suggestion for a filtered-out sender produced
an empty table that claimed "no match".
**Correct approach:** Build responsive from the start — mobile drawer in
`AppShell`, fluid grids, a row layout that reflows. Search stays global,
but picking a suggestion clears active filters so the result is always
visible.
**Rule:** Check any new screen/shell at a phone width before calling it
done. A fixed-width column is a layout regression unless the row can
still reflow under it.
**Enforcement update:** none — fixed in the follow-up pass (AppShell
drawer, auto-fit grids, responsive row, clear-filters-on-pick).

## 2026-05-20 — Review-session apply used if/else-if, dropped decisions
**PR:** #TBD — `feat/d038-senders-screen` (fixed in commit 215e9a0)
**Caught by:** gate review — typescript-reviewer + silent-failure-hunter
**What happened:** `applyReview` in `senders-screen.tsx` branched the
three verb buckets (Unsubscribe / Later / Protect) with `if … else if
… else if`. A mixed review session — some senders Unsubscribe, others
Later — fired only the first non-empty bucket and silently dropped the
rest. A trailing toast still announced "Also moved N to Later", so the
UI claimed work that never ran. The loose `string` typing of decision
values (no union) is what let producer and consumer drift without a
compile error.
**Correct approach:** Independent `if`s (or a loop over buckets) so every
bucket applies; type decision values as a closed union.
**Rule:** Branches that look mutually exclusive but are independent must
be independent `if`s, not an `if/else-if` chain. Model closed value sets
as union types so producer/consumer mismatches fail `tsc`.
**Enforcement update:** none — fixed in-PR (independent buckets +
`DecisionId` union). Behavioral; promote to CLAUDE.md §1 if it recurs.

## 2026-05-20 — Rename recon used an extension-filtered grep, missed config files
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** broad verification grep (later in the same session)
**What happened:** Scoping the `packages/ui` → `packages/shared` rename, the
recon `grep` used `--include=*.json --include=*.ts --include=*.tsx
--include=*.mjs --include=*.js --include=*.md --include=*.yaml`. It excluded
`.sh` and (by extension-name) `.yml`. The plan therefore claimed "no source
imports to update" and scoped the change to one agent file. The post-rename
verification grep (no filter) then found four more path refs: `subagent-gate.yml`
(`design` paths-filter), `require-preview-before-mutation.sh` (functional scope
glob), `check-microcopy.sh` (comment). The `subagent-gate.yml` one would have
silently disabled the design-system-agent gate on PR 3 — the opposite of the
PR's purpose.
**Correct approach:** Recon for a rename/move must grep the whole tree with no
`--include` filter. CI workflow YAML, shell hooks, and agent configs all
reference paths and are invisible to source-only greps.
**Rule:** When renaming or moving any path/package, grep unfiltered first —
`grep -rn '<oldpath>' --exclude-dir=node_modules --exclude-dir=.git .` — before
scoping the change. Never scope a rename off an extension-filtered grep.
**Enforcement update:** none — behavioral rule; promote to CLAUDE.md §1.3 if a
path-rename recon miss recurs.

## 2026-05-20 — packages/ui scaffolded against D173
**PR:** #TBD — `chore/d173-rename-ui-to-shared`
**Caught by:** session review (PR 3 prep)
**What happened:** PR 1 scaffolded a `packages/ui` workspace package
(`@declutrmail/ui`). D173 explicitly rejects it: *"packages/ui — only one
consumer (apps/web) at launch, doesn't earn package status."* The plan's
canonical shared package is `packages/shared` (D173, D198, D199, D210, D220 —
hooks, components, tokens, copy, types, Zod schemas).
**Correct approach:** Scaffold `packages/shared` per D173, not `packages/ui`.
**Rule:** Before creating a workspace package, confirm its name against the
plan's structure decisions (D173).
**Enforcement update:** none — one-off scaffold error; renamed to
`packages/shared` in this PR.

## 2026-05-23 — Drizzle correlated subquery silently degenerated to tautology
**PR:** #43 — `feat(senders): senders read module + 5 endpoints (D39, D40, D44, D45, D46, D204)`
**Caught by:** founder (manual Senders screen inspection — every row showed identical `monthlyVolume: 10`, `readRate: 0`)
**What happened:** `SendersReadService.listSenders` / `getSenderDetail`
([apps/api/src/senders/senders.read-service.ts:107-122](apps/api/src/senders/senders.read-service.ts:107),
[:196-211](apps/api/src/senders/senders.read-service.ts:196)) built a correlated
subquery against `sender_timeseries` to fill the latest-month `volume` and
`read_count`. The `sql` template interpolated `Column` objects on BOTH sides of
the join predicate (`${senderTimeseries.mailboxAccountId} = ${senders.mailboxAccountId}`).
Drizzle's `sql` template emits **unqualified** column names for `Column` values,
so the rendered SQL became `WHERE "mailbox_account_id" = "mailbox_account_id" AND
"sender_key" = "sender_key"` — both names resolved to the inner
`sender_timeseries` scope (PG scope rule), making the predicate a tautology. The
subquery then returned the same single row (whichever the planner picked first)
for every sender — and because the tautology eliminated the mailbox predicate
entirely, that row could come from ANY mailbox in the table. Tests at
[senders.read-service.spec.ts:268](apps/api/src/senders/senders.read-service.spec.ts:268)
passed because they seeded ONE sender with ONE matching timeseries row — the
tautology coincidentally returned the right row.
**Severity:** Cross-tenant data exposure of integer rollup columns
(`volume`, `read_count`). No body content, headers, snippets, or PII fields
were involved — D7/D228 invariants remained intact — but the mailbox
boundary for `sender_timeseries` was effectively bypassed by every list /
detail response until the fix landed. The post-fix specs include explicit
cross-mailbox `sender_key` collision regression tests that fail loudly if
the boundary is dropped again.
**Correct approach:** Qualify outer-scope identifiers explicitly in `sql`
templates — prefer `sql.identifier(getTableName(table))` over a hardcoded
string so a future schema rename surfaces in one helper call rather than
silently re-introducing the tautology. For correlated subqueries Drizzle
does not auto-qualify; the developer must. Tests for any correlated read
MUST seed ≥2 senders, each with ≥2 distinct timeseries rows, AND a
cross-mailbox `sender_key` collision case, and assert that each sender /
mailbox gets its OWN row.
**Rule:** Drizzle `sql` templates referencing an OUTER table inside a
subquery must use `sql.identifier(getTableName(table))` (or
`sql.raw('table.column')` if the table is irrefutably stable), never a
bare `${table.column}` interpolation. Any read-service spec that
exercises a correlated subquery must seed multi-sender + multi-timeseries
fixtures AND a cross-mailbox collision case for tenant-boundary coverage.
**Enforcement update:** Add a `silent-failure-hunter` / `architecture-guardian`
prompt rule for "correlated subquery without qualified outer identifier";
add a checklist line to the schema-migration-reviewer for read-service
specs ("seeds ≥2 entities for cross-row queries AND a cross-mailbox
collision case").

## 2026-05-26 — ARCH-DRIFT: webhooks module writes directly to sync feature's table (D204)
**PR:** N/A (post-merge audit) — `git log d4d996a..HEAD` includes the relevant commits in PR #38 (sync gate) carried forward; the cross-feature write specifically lives in `apps/api/src/webhooks/gmail-webhook.service.ts` shipped earlier and was not refactored when the sync feature module was added.
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep) — replayed architecture-guardian Check C (read-only services + cross-feature events, D204)
**What happened:** `GmailWebhookService.processVerifiedPush` ([apps/api/src/webhooks/gmail-webhook.service.ts:152-159](apps/api/src/webhooks/gmail-webhook.service.ts:152)) issues a direct `tx.update(providerSyncState).set({ lastHistoryId, historyIdUpdatedAt, updatedAt })` against the **sync** feature's table from the **webhooks** module. The table is owned by `SyncModule`; D204 requires cross-feature writes to go through the owning module's exported facade or an outbox event. The cross-module dependency is invisible at the NestJS module-graph level — `WebhooksModule` does not import `SyncModule` — so the coupling is purely schema-shared and the `architecture-guardian` PR-time gate did not see it as a cross-feature write because both files reference `providerSyncState` from `packages/db/src/schema`.
**Correct approach:** Either (a) inject `SyncService` into `GmailWebhookService` and expose an `advanceHistoryId(mailboxAccountId, incomingHistoryId): { kind: 'advanced'|'stale'|'uninitialized', ... }` method that owns the `SELECT ... FOR UPDATE` + `UPDATE` transaction; OR (b) emit a `webhook.history_advanced` outbox event the sync feature consumes. Option (a) is simpler given the transactional contract; option (b) decouples webhook latency from sync persistence and matches the outbox pattern already used elsewhere.
**Rule:** Cross-feature writes must traverse the owning module's facade (`*Service` exported from its module) or an outbox event. A direct Drizzle write to another feature's schema from inside a different module is a D204 violation, even if both files import the same `packages/db` symbol.
**Enforcement update:** Extend `architecture-guardian` Check C to flag "write to `<table>` from a module that does not import the `<table>`'s owning service module" — today it only catches explicit cross-package imports, not shared-schema writes that bypass the module graph entirely. Until the agent prompt is updated, add a checklist line to webhook-security-auditor's review template ("does this handler write to any non-webhooks table? If yes, it must go through the owner's service.").

## 2026-05-26 — ARCH-DRIFT: sync status endpoint ships without `{ data, meta }` envelope (D202)
**PR:** N/A (post-merge audit) — landed in PR #38 `feat(sync): sync status contract + read endpoint (D224)`, commit a64dac2
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep) — replayed architecture-guardian Check F (API envelope + pagination, D202)
**What happened:** `SyncController.getStatus` ([apps/api/src/sync/sync.controller.ts:49](apps/api/src/sync/sync.controller.ts:49)) returns the bare `SyncStatus` object instead of the D202-mandated `{ data, meta }` envelope. The drift is self-acknowledged at [sync.controller.ts:33](apps/api/src/sync/sync.controller.ts:33) (`TODO(D202): wrap the response in the { data, meta } envelope when the shared envelope helper lands`) — the route shipped knowingly non-compliant on the rationale that the envelope is a "non-breaking outer wrapper". The endpoint is polled every 3s by `useSyncStatus()` during onboarding (D6, D109), so the contract change becomes higher-impact the longer it sits.
**Correct approach:** The shared `ok()` envelope helper exists and is already used by autopilot/briefs/followups/senders. Sync should adopt it now rather than waiting for "the helper to land". A TODO is not a complete PR (CLAUDE.md §10 "no fake completion") when the missing piece is a D-decision requirement.
**Rule:** Every new HTTP response under `/v1/**` MUST use the `ok()` envelope (or pagination helper) on day one — no `TODO(D202)` shipped to main. If the contract can't be honored, the route is not ready to merge.
**Enforcement update:** `architecture-guardian` Check F should hard-fail (not warn) on any `@Controller('v1/...')` handler whose return type is not wrapped — the gate currently allowed PR #38 through. Until that lands, add a PR-template checklist item: "All new `/v1/*` responses use `ok()` / `paginated()` — TODO(D202) is not acceptable."

## 2026-05-26 — ARCH-DRIFT: pattern — 2 blocking findings this week — gate enforcement may be insufficient
**PR:** N/A — summary of the two entries above
**Caught by:** architecture-drift-oracle (scheduled task, 2026-05-26 sweep)
**What happened:** Two independent D204/D202 violations landed on `main` in the trailing 7-day window despite the `architecture-guardian` PR-time gate. The pattern: the gate catches *intra-PR* structure (correct imports, correct provider scoping) but not *cross-PR drift* where one PR's table becomes another module's silent write target, or where an explicit `TODO(D-number)` is allowed to ship.
**Correct approach:** Two reinforcements: (a) `architecture-guardian` should treat any `TODO(D###)` in a touched file as a blocking finding unless the touched D-row is explicitly outside this PR's scope; (b) `architecture-guardian` should run a "schema ownership" check — for every Drizzle write in the diff, the writing module must either own the schema file OR import the owning module's service.
**Rule:** When the same gate misses 2+ findings in one week, the gate's coverage is the bug, not the authors. File a `chore/distill-architecture-guardian-D204-D202` PR to tighten the agent prompt before the next sweep.
**Enforcement update:** Open a follow-up to extend `architecture-guardian.md` checks C + F per the two entries above; until then the weekly oracle is the only safety net.

## 2026-05-27 — IMPL-LOG-DRIFT: 11 PRs shipped with title D-refs missing from `Closes` lines; 21 ⬜ rows left un-flipped
**PR:** #44, #47, #48, #50, #52, #77, #102, #103, #105, #107, #108, #109 (audit) — patch in `chore/distill-closes-trailers`
**Caught by:** impl-log-drift-oracle (scheduled task, 2026-05-27 sweep)
**What happened:** Across the trailing 7-day window, 11 merged PRs cited multiple D-numbers in the PR title (e.g. `feat(api): foo (D99, D104, D105, D234)`) but the body carried only one `Closes D###` line — usually the lowest-numbered D. `pr-merged.yml` flips only Ds it finds in `Closes` lines, so 21 ⬜ rows that had actually shipped (D12, D31, D32, D33, D34, D36, D62, D63, D67, D70, D85, D86, D101, D102, D104, D105, D196, D197, D208, D226, D234) remained marked as Not-started. `IMPLEMENTATION-LOG.md` decoupled from the merge history — the artifact that's supposed to be the source of truth for plan progress lied about ~20% of the plan's recent state. Two failure modes overlap: (a) author discipline — title and body are not kept in lockstep, (b) workflow regex — `[^|]+` group in the flip pattern silently fails on D-row titles with embedded `|` (D12's `sha256("v1|" + …)` was the trigger; PR #48 carried the correct `Closes D12` and the flip still no-op'd).
**Correct approach:** Title-cited D-numbers and body `Closes` lines must always be the same set. Either tighten the author side (a PR-open gate rejecting unmatched sets) or loosen the flipper (harvest D-refs from the title in addition to the body, with a documented exemption for `chore/learnings` style PRs that intentionally cite a D without shipping it — e.g. PR #42 said `Relates to D182` deliberately). The workflow regex bug is independent and must be fixed regardless.
**Rule:** A PR title D-ref is a contract — the body MUST carry a matching `Closes D###` line for every D in the title, unless the body explicitly says `Relates to D###` (the only documented non-flipping form). The flip workflow's row-match regex MUST tolerate `|` inside titles (use non-greedy `.+?` anchored on the trailing ` | ⬜ |` token, not `[^|]+`).
**Enforcement update:** Three follow-ups filed in `FOUNDER-FOLLOWUPS.md` (2026-05-27): (1) the per-PR fix matrix is now resolved by the `chore/distill-closes-trailers` PR that this entry ships with; (2) a process-break entry asks the founder to pick "tighten the PR-open gate" vs "loosen the flipper"; (3) a separate entry tracks the `pr-merged.yml` `[^|]+` regex bug. Until the founder picks an enforcement option, the weekly oracle is the only safety net catching this drift class.

## 2026-05-28 — D204: mailboxes service joined sync's table directly (caught pre-merge)
**PR:** feat/d115-secondary-mailbox-gate (pre-merge; not shipped)
**Caught by:** architecture-guardian (GATE, local run before commit)
**What happened:** To put a per-mailbox "Syncing…→Ready" badge in the account switcher (D116), the first cut added `readiness` to `MailboxSummary` and LEFT JOINed `provider_sync_state` inside `MailboxAccountsService.listByWorkspace`. That table is owned by the sync feature — every other consumer (webhook cursor advance, `getStatus`) routes through `SyncService`. Doing it via DI would have created a Sync↔Mailboxes circular module dep, which is the boundary signalling that readiness is a sync-feature read to compose at a higher layer.
**Correct approach:** Add a batch facade `SyncService.getReadinessByMailbox(ids)` (sync owns the read), and compose `readiness` onto a `MailboxView` at the **controller seam** (`auth.controller.me`), where two independently-owned facades are already orchestrated. The mailboxes service stays pure.
**Rule:** A feature service must never read another feature's table — even a denormalized read for a list response. Expose it via the owning module's exported facade and compose at the controller. If "doing it right" would need a circular module import, that's the boundary telling you the field belongs to the other feature.
**Enforcement update:** Reinforces the existing `architecture-guardian` Check C "schema ownership" follow-up (MISTAKES 2026-05-26). This is the 3rd D204 boundary data point — the distillation trigger (recurrence ≥3) is met; a `chore/distill-architecture-guardian-D204` candidate is warranted. The gate DID catch this one pre-merge (read-side), so the PR-time net works for reads; the gap remains cross-PR drift.

## 2026-05-28 — Mailbox switch/disconnect didn't update UI until hard refresh (+ false smoke)
**PR:** feat/d115 multi-mailbox (fix on chore/distill-flow-completeness, commit fd99b3a)
**Caught by:** founder (manual), AFTER I claimed the flow was "smoked" and working
**What happened:** `resetMailboxScopedCache` used `qc.clear()` then `invalidateQueries({ queryKey: ME_QUERY_KEY })`. `clear()` empties the cache but does NOT make MOUNTED observers (AuthProvider `me`, senders list) refetch/re-render — they hold last data until a remount. And invalidating a specific key AFTER `clear()` is a no-op (the query was just removed). So switching/disconnecting a mailbox only took effect on a hard refresh. Worse: I reported it "smoked + working" the prior turn — but my smoke had done a full re-auth (hard page nav) between the switch and the check, so I verified a hard-load, not the live SPA switch. I mistook a navigation for an in-place update.
**Correct approach:** `qc.invalidateQueries()` with NO filter — marks all queries stale and refetches active (mounted) observers immediately (default `refetchType: 'active'`), so `me` + feature lists update live. Verified properly via the D206 dev-login: switch chintan↔crypt with NO navigation, breadcrumb + data changed.
**Rule:** (1) `clear()` ≠ "refetch everything" — use `invalidateQueries()` to update mounted observers; `clear()` is for logout-style resets. (2) A flow smoke MUST exercise the SPA transition itself — no page reload/navigation between the action and the assertion, or you're testing a hard load, not the feature. URL must not change.
**Enforcement update:** `flow-completeness-auditor` already flags scope-change mutations + "needs live smoke"; add "verify with NO navigation between action and assertion" to its smoke guidance. The clear-vs-invalidate gotcha is now in this entry; promote to CLAUDE.md §8 if it recurs.

## 2026-05-28 — Senders list: VIP-only bulk-actionable + `generatedBy` wire drift (shipped green)
**PR:** claude/sweet-cannon-bryBs (senders production-hardening; cites D39, D42, D43)
**Caught by:** manual two-mailbox smoke (live API + seeded data) for the wire-drift + dead-data gaps; `design-system-agent` (GATE) for the VIP-only gap introduced mid-fix.
**What happened:** Three "passed every structural gate, wrong in production" defects on the Senders read surface, plus one self-inflicted during the fix:
1. **`generatedBy` wire drift** — `DecisionHistoryRowDto.generatedBy` was typed `'llm' | 'template'` while the BE/DB enum is `'llm_haiku' | 'template'`. `GENERATED_BY_TO_SOURCE['llm_haiku']` was therefore `undefined`, so the Sender Detail decision-timeline rendered a blank source label for EVERY LLM-generated decision (the common case). Unit tests passed because they were written against the wrong `'llm'` literal — the tests encoded the bug.
2. **Dead protection surface** — the list endpoint never sent protection flags, so the row "Protected" chip, the "Protected" KPI (always 0), and the "Protect" intent bucket (always empty) were dead; VIPs/protected senders were mis-bucketed as Cleanup/People.
3. **Bypassed confidence gate** — the list `lastReview` carried no `confidence`, so `intentOf`'s gate defaulted to 1.0 and surfaced low-confidence unsubscribe verdicts as recommendations (contradicts the "don't pressure on unsure" product rule).
4. **VIP-only bulk-actionable (self-inflicted)** — when surfacing protection, I OR-ed `isVip` into the KPI + intent bucket but left the row chip/CTA + `canArchive/canLater/canUnsubscribe` reading `s.protected` alone. A VIP-only sender (`isVip:true, isProtected:false` — the flags are independent on the wire, D42/D43) was counted/bucketed as protected yet still rendered destructive verbs. The seed + fixtures masked it (their VIPs were also `isProtected`).
**Correct approach:** Surface the already-stored data on the list endpoint (protection flags + decision confidence — privacy-safe, no new storage); fix the wire enum to `'llm_haiku'`; and route EVERY "shielded from destructive action" surface (row chip, row CTA, grid-card buttons, bulk `canArchive/canLater/canUnsubscribe`, KPI, intent bucket) through ONE predicate `isStandingProtected(s) = protected || isVip` so they cannot disagree.
**Rule:** (1) A FE wire enum literal MUST match the BE enum byte-for-byte; write at least one test against the REAL BE value, never only the literal you typed. (2) When a model field gains a new flag that gates a destructive action, find ALL gates for that action and route them through a single shared predicate in the same PR — a partial roll-out where surfaces disagree is the bug. (3) Independent boolean flags (VIP vs Protect) must be seeded/fixtured independently, or the divergent case never gets exercised.
**Enforcement update:** Added `apps/web/src/features/senders/api/adapters.test.ts` (asserts `llm_haiku → 'Triage'` and that a VIP-only wire row is non-archivable + buckets to Protect); decoupled `fixtureProtectionFlags` so `isVip` and `isProtected` are independent. Candidate for `type-design-analyzer` / a wire-contract test to assert FE enum literals are a superset of the BE enum at build time — promote to a check if this drift class recurs.

## 2026-05-29 — Hand-recomputed `atlas.sum`, corrupting 15 valid hashes
**PR:** #131 (feat/d168-error-envelope-security-log)
**Caught by:** CI `atlas migrate lint` (`checksum mismatch (atlas.sum): L3: 0001 … was edited`)
**What happened:** Adding migration 0016 with no Atlas CLI available (network-blocked), I assumed `atlas.sum`'s per-file `h1:` was `sha256(name+content)` because file 0000 matched it. It was a coincidence — 0000's raw bytes are already atlas-canonical. I concluded the sum was "stale" for 0001–0015, "fully regenerated" it from raw bytes, and even wrote that false "stale/corrected" claim into the PR body + FOUNDER-FOLLOWUPS + LEARNINGS. In reality Atlas canonicalizes SQL before hashing (not reproducible from bytes), the committed sum was valid (PR #130's atlas-lint was green; the `.sql` bytes are identical to main), and my regen corrupted 15 good hashes — burning two CI cycles.
**Correct approach:** Never hand-edit `atlas.sum`. Restore main's exact hash lines; the new migration's entry needs the real `atlas migrate hash` (run in an env with Atlas, or CI). Don't assert a diagnosis ("stale") as fact in artifacts before it's verified — I should have read the CI log first instead of inferring "checksum mismatch" from job duration.
**Rule:** (1) `atlas.sum` is Atlas-CLI-owned; if you can't run `atlas migrate hash`, leave it and flag a follow-up — recomputing from bytes corrupts valid entries. (2) Read the actual CI log before diagnosing a failure; never infer the failure class from timing. (3) Don't write a hypothesis into PR/docs as established fact.
**Enforcement update:** LEARNINGS + FOUNDER-FOLLOWUPS corrected; candidate CLAUDE.md §4 line "never hand-edit atlas.sum."

## 2026-05-30 — Cited D232 when the invariant was D35/D58
**PR:** N/A (caught in `docs/handoffs/2026-05-30-bulk-actions-architecture-codex-review.md` before any code landed)
**Caught by:** Codex review (Concerns §4: "D232 is account deletion respecting undo windows")
**What happened:** Architecture proposal repeatedly cited D232 as the authority for "atomic undo per action_job, partial undo NOT supported." D232 is actually about account deletion respecting `max(now+7d, latest_undo_expires_at)` — adjacent topic, not the atomicity invariant. Atomic undo lives in D35 (persistent undo tray) + D58 (Activity row "Undo") + the `undo_journal.reverted_at IS NULL` atomic-lock pattern in the existing schema. I leaned on D232 because it FELT proximate ("undo windows!") without re-reading what D232 actually decides.
**Correct approach:** Re-read the D-body before citing. Cite the D that decides the rule, not the D that mentions the term. When unsure, search the plan (`rg "atomic"`, `rg "partial undo"`) and read the matched bodies.
**Rule:** Citation discipline — when invoking a D-number, the D's BODY must actually decide the rule you're invoking it for. "D-number adjacency by topic" is not citation; it's pattern-matching on keywords.
**Enforcement update:** None automated (citations are judgment calls). LEARNINGS already captures the pattern. Watch for repeat occurrences in PR-review and ADR PRs; if it happens twice more, distill into CLAUDE.md §3 ("Source-of-truth precedence") as an explicit citation rule.

## 2026-06-10 — "Later" shipped green but Gmail rejects label NAMES
**PR:** feat/d226-triage-mutation-wiring (Wave 1 Track A, pre-merge)
**Caught by:** manual live smoke (CLAUDE.md §8) — every structural gate, typecheck, and 281 worker unit tests were green
**What happened:** The action manifest's `buildLabelChange` for the `later` verb emits `addLabelIds: ['DeclutrMail/Later']` — a label NAME. Gmail `messages.batchModify` accepts label IDS only, and nothing ever created the label. First real Later: `400 Invalid label: DeclutrMail/Later`. Worse, the worker classified the 400 as `TransientError` and retried to the attempt cap — a retry storm against a deterministic 4xx. Unit tests passed because the fake Gmail client accepted any string as a label id.
**Correct approach:** Resolve user-label names to ids at the worker/client seam (`ensureLabelId`: list → create-if-missing → cache), feed the RESOLVED change to both `batchModify` and the local `mail_messages` label mirror, and classify provider-deterministic 4xx as permanent (fail attempt 1). Fixed in commit fd4ebbb.
**Rule:** (1) A fake provider client must reject what the real provider rejects for the contract under test — if Gmail only takes ids, the fake should throw on a non-id. (2) Any provider error taxonomy needs an explicit permanent-4xx member from day one; "default transient" turns deterministic failures into storms. (3) A verb is not "wired" until one real round-trip has run against the live provider (§8 smoke).
**Enforcement update:** `PermanentError` added to the D203 taxonomy + tests asserting attempt-1 terminal failure on Gmail 400; live-smoke step already mandated by §8 (this entry is the evidence it catches what gates cannot).

## 2026-06-10 — Stale main-checkout worker intercepted worktree jobs mid-smoke
**PR:** N/A (smoke-infrastructure hazard, no code shipped wrong)
**Caught by:** manual live smoke — a reverse job reported `done` with no trace in the worktree worker's log
**What happened:** A 3-day-old worker process from the MAIN checkout was still alive during a worktree smoke. Both processes consume the same local Redis queues, so the stale worker (old module graph) raced the worktree worker and executed an undo reverse job with 3-day-old code. `scripts/dev-up.sh --stop`'s orphan sweep greps for processes whose cwd is under the CURRENT repo root — run from a worktree it can never see main-checkout orphans (and vice versa). This is the exact MISTAKES.md 2026-06-05 stale-worker class, with a worktree twist.
**Correct approach:** Before any worktree smoke, sweep ALL DeclutrMail worker/api processes regardless of which checkout they belong to (`pgrep -f 'src/worker\.ts'` + cwd check against ~/projects/*declutrmail*-ish roots), not just the current root.
**Rule:** One local Redis = one live worker, ever. Verify with `pgrep -lf 'src/worker.ts'` (expect exactly one, in the checkout under test) before trusting any smoke that touches a queue.
**Enforcement update:** Candidate fix: widen dev-up.sh's sweep to match any process whose cwd contains the repo name across sibling worktrees (`wt-*`). Not yet implemented — follow-up; promote to CLAUDE.md §8 smoke checklist if it bites again.

## 2026-06-10 — Upstash free-tier command cap killed the entire async layer for ~41h with no alert
**PR:** N/A (prod incident; remediation on `chore/d156-vendor-billing-guardrails`)
**Caught by:** production — sync-stuck watchdog firing (downstream symptom) + manual log read. NO billing/usage alert existed for Upstash.
**What happened:** The 2026-06-08 worker flip to `min-instances=1` + `--no-cpu-throttling` (the CORRECT fix for the CPU-throttle sync stall) made 9 BullMQ consumers poll Upstash Redis 24/7 — ~150-250K commands/day at IDLE (bullmq `drainDelay` default 5s + `stalledInterval` 30s per worker + repeatable jobs incl. undo-expiry every 5 min). On top of that, the 2026-06-09 6627-sender initial sync + full score sweep. Upstash free tier = 500K commands/MONTH. First `bullmq.error` `ERR max requests limit exceeded. Limit: 500000` at 2026-06-09T01:41Z; continuous until at least 2026-06-10T18:59Z (~41h). The whole async layer was dead: syncs stalled, scoring dead, undo-expiry dead, unsubscribe execution dead. Every existing guardrail covered a DIFFERENT resource — `REASONING_RATE_PER_MIN` (Anthropic), `RATE_LIMIT_ENABLED` (HTTP), the $30 GCP budget (GCP only). Nothing watched Upstash usage; the first signal was a watchdog built for a different failure class.
**Correct approach:** (1) When a worker's lifecycle changes (min=0 → always-on), re-derive the steady-state command volume against EVERY metered backend it touches — an always-on BullMQ consumer's idle polling alone exhausts a 500K/month tier in ~2-3 days. (2) Paid floor for queue infra: Upstash Fixed plan ($10/mo flat, no command cap). (3) Tune BullMQ polling so idle command volume is bounded. (4) Alert on the provider's own rejection error (`scripts/setup-billing-alerts.sh`: log metric `bullmq_max_requests_errors` + email policy, >0 over 5 min) + a vendor-limits watchdog, so quota exhaustion pages in minutes, not 41h.
**Rule:** Every metered third-party service in the hot path needs its own usage/limit alert BEFORE the meter can run out — a guardrail on a different vendor is not coverage, and a downstream watchdog is a symptom detector, not an alert.
**Enforcement update:** `scripts/setup-billing-alerts.sh` (idempotent metric + channel + alert policy); Upstash Fixed plan + usage notifications, vendor watchdog API tokens, and vendor-side hard caps (Vercel/PostHog/Sentry) all tracked as FOUNDER-FOLLOWUPS 2026-06-10 entries.

## 2026-06-10 — Sync-stuck watchdog never passed once: fictional enum values + set -e swallowed the SQL error
**PR:** fixed on `chore/distill-billing-guardrails` (#186)
**Caught by:** manual investigation during the Upstash incident — watchdog "fired" 10/10 runs since creation, including while no sync was stuck
**What happened:** `scripts/check-sync-stuck.sh` queried `current_stage IN ('queued','connecting','syncing')`, but `'connecting'` and `'syncing'` do not exist in the `sync_stage` enum (real values: queued, fetching_metadata, building_sender_index, computing_recommendations, finalizing, ready, failed). Postgres rejected the query on EVERY run → psql exit 1 → `set -euo pipefail` killed the script at the `OUT=$(psql … 2>&1)` assignment with zero output. Every "stuck sync detected" failure email since the workflow's creation was this SQL error, not a stuck sync. The alert was treated as signal during the Upstash incident — it was noise that happened to coincide. Double silent-failure: (1) stderr merged into `$OUT` would have masqueraded a connection error as stuck rows; (2) `set -e` on the command substitution hid even that.
**Correct approach:** (1) `NOT IN ('ready','failed')` — enumerate terminal states (stable) instead of in-flight states (drifts as the enum grows). (2) psql failures exit 2 with the stderr surfaced, distinct from exit 1 = real detection. (3) Smoke an alert's GREEN path AND its FIRE path before trusting it: flip a prod row reversibly (mind `set_updated_at`-style triggers that overwrite injected timestamps — verify the row state you think you created actually persisted).
**Rule:** An alert that has never been green is not an alert — after creating any watchdog, force one PASS and one FIRE before relying on it. Column/enum literals in raw-SQL scripts must be checked against the live schema (`enum_range`), not written from memory.
**Enforcement update:** Script hardened (enum-stable predicate, error/detection exit-code split, DSN sanitization). Candidate hook: CI step that runs each `scripts/check-*.sh` against a seeded PGlite/testcontainer to catch schema-drift in watchdog SQL — promote if a second watchdog rots the same way.

## 2026-06-26 — Structural gates + green CI passed 4 HIGH correctness defects; adversarial review caught them
**PR:** #206, #220, #224 (+ mediums in #201/#219/#226) — review of Fable-5-authored stack
**Caught by:** Claude adversarial-review workflow (skeptical "try to break it" lens + independent self-verification), NOT the structural gate agents and NOT CI — every PR was CI-green and gate-clean.
**What happened:** A compliance gate pass (privacy/architecture/design/types) returned 0 blocking across 8 PRs. A second, adversarial pass over the same diffs found 4 verified HIGH defects the gates structurally cannot see:
- #224 CSV formula injection (attacker-controlled Subject `=HYPERLINK(...)` executes on export open) + a streamed export that reports a mid-stream DB failure as a successful 200 (corrupt file).
- #206 a no-op cleanup (0 messages, status=done) consumed a free lifetime unit, contradicting the PR's own counting rule; and the inbox limit was enforced only at OAuth `/start`, never at the activation mutation (TOCTOU / reconnect bypass).
- #220 `decided_at` set on ENQUEUE not terminal success → a failed async Gmail job silently dropped the sender from the Screener forever; plus a Phase-B→C graduation left a stale quarantine row (sender in Screener AND Triage); plus a ghost-pending TOCTOU (0-message-at-execution emitted no terminal event).
**Correct approach:** Structural gates verify shape (module boundaries, types, tokens, story coverage); they never run the app, so they miss correctness, races, flow-completeness, and "ships green / breaks live" defects (the §8 class). Every substantive PR needs an adversarial pass (default-to-skepticism, attack-surface-first) AND independent verification of each finding before merge — not just the compliance gates.
**Rule:** Green CI + clean structural gates ≠ correct. Run an adversarial "try to break it" review (correctness/data-loss/races/idempotency/auth/flow) + self-verify each finding before recommending merge. Diverse lenses beat one reviewer; verification filters plausible-but-wrong findings.
**Enforcement update:** This session ran the adversarial review as a Claude subagent workflow (replacing the OpenAI Codex CI of #237, closed — no metered quota). Candidate: keep adversarial review as a standard phase of every PR-review workflow. Promote to CLAUDE.md §7/§8 if a third wave of green-but-broken PRs appears.

## 2026-07-02 — cloud-smoke harness generated an invalid cookie domain (merged before caught)
**PR:** #239 (bug) → #249 (fix)
**Caught by:** Codex stop-time review, post-merge
**What happened:** scripts/cloud-smoke.sh's generated .env.local hardcoded `COOKIE_DOMAIN=localhost`, so the harness API emitted session cookies with an explicit `Domain=localhost` attribute — rejected/ignored by cookie engines (RFC 6265 host-only is the correct localhost form). It also directly contradicted .env.example:130's documented rule ("Local: leave UNSET"), which the real local env follows. The pre-merge audit reviewed the script for prod-path exposure and secrets but never diffed its generated env against .env.example's per-env rules.
**Correct approach:** Any script that GENERATES an env file must be checked variable-by-variable against .env.example's documented per-env guidance, not just for secret leakage.
**Rule:** Generated env ≠ example env — diff generated vars against .env.example's rules as part of reviewing any env-writing script.
**Enforcement update:** Comment anchor added in the heredoc (#249) pointing at .env.example:130-131; none automated (recurrence promotes a check into the script-review checklist).

## 2026-07-02 — Triage engine recommended "Unsubscribe · 95%" for every quiet sender, including the DMV
**PR:** #32 shipped it (D21 Phase C weights + confidence formula); fixed on `fix/d029-unsub-overrecommend`
**Caught by:** founder in the live triage queue (2026-07-02) — donotreply@dmv.ca.gov, American Express Travel, L&T Mutual Fund @ CAMS, Binance support and a personal-ish flexport.com address ALL surfaced as "Unsubscribe · 95%". Flagged earlier in FOUNDER-FOLLOWUPS (2026-06-06). Unit tests, gates, and CI were green the whole time.
**What happened:** Two compounding design flaws in Phase C, both faithful to the D21 spec-as-written: (1) `unsubscribe_score` was built almost entirely from ABSENCE signals — read_rate < 0.05 (+0.40) + < 0.20 (+0.30) + stale last_seen (+0.10) let pure inactivity reach 0.80 with no unsubscribe channel and no volume; (2) `confidence = winner/(winner+loser)` degenerates to 1.0 → clamp 0.95 whenever the loser scores 0, which is exactly the quiet-sender case. On the founder's real 165-sender eval set: 110/165 senders got Unsubscribe, 49 of them pinned at 95% — including senders with NO List-Unsubscribe header, where the recommendation is not even executable.
**Correct approach:** A destructive recommendation must be driven by POSITIVE evidence of actionability (sender-declared List-Unsubscribe channel + active stream volume); disengagement only corroborates. Confidence must reflect strength + margin, not a ratio that maxes out precisely when evidence is one-sided. Eval sets whose labels are auto-generated from the same philosophy as the scorer (Tier A rules ≈ old weights) cannot catch this class — the 97% "cleanup" agreement was the two heuristics agreeing with each other, not with the user.
**Rule:** Never let absence-of-engagement alone drive a destructive verdict; require the action's precondition (a real unsubscribe channel) as a hard gate, and treat any confidence formula that can hit its ceiling with zero counter-evidence as a bug.
**Enforcement update:** Cascade re-weighted with hard gate + strength/margin confidence (this PR); named regression tests pin the DMV/AmEx/newsletter/mailto personas. Candidate: score-eval.ts run with HUMAN-labeled rows (not auto-labels) as a pre-merge check for future weight changes — promote if weights are touched again.

## 2026-07-02 — "you replied" compose chip shipped as a silent no-op (URL state + BE param, no FE wire)
**PR:** D38 compose-strip PR shipped it; fixed on `fix/d038-senders-replied-filter-wire`
**Caught by:** interaction-design review (manual), 2026-07-02 — clicking the chip changed its visual state, the URL, and nothing else
**What happened:** The chip wrote URL state (`?replied=true|not` in use-compose-state.ts) and the BE list endpoint parsed + filtered the param end-to-end (senders.controller.ts `@Query('replied')` → read-service SQL), but the middle of the FE chain never carried it: `UseSendersOptions` had no `replied` field, `ListSendersParams`/`fetchSenders` never mapped it to the wire, and the senders-screen call site never passed `compose.replied`. Five of six compose axes were threaded; this one was skipped. Every layer was individually consistent, so typecheck, lint, gates, and all tests stayed green — the chip even showed a correct mailbox-wide count (`filterCounts.repliedTo`) while filtering nothing.
**Correct approach:** A filter axis is one feature spanning four seams (URL state → hook options → query key → wire params). Land all four in one PR with a cross-layer test that proves the UI toggle changes the wire request (stub returns a distinct row set only when the param is present — the #145 search-test pattern).
**Rule:** For any new list-filter axis, add a screen-level test asserting the chip/control changes the outgoing request's query param AND the rendered row set; a param accepted by the BE but absent from the FE fetcher is undetectable by structural gates.
**Enforcement update:** Regression tests added (senders.test.ts wire-encoding + senders-screen.test.tsx chip-narrows-list). Candidate: checklist item for compose-axis PRs — grep the new param name in all four seams; promote to CLAUDE.md §8 if a second dropped-axis ships.

## 2026-07-03 — Senders table expanded row shipped a seeded fake sparkline as production UI
**PR:** #146 shipped it (rich SenderRowDetail restoration into the ADR-0014 table); fixed on `fix/d049-row-detail-real-timeseries`
**Caught by:** founder-directed audit of production surfaces for fixture data, post-ship. Gates, CI, and tests were green the whole time.
**What happened:** `sender-row-detail.tsx` generated its "Last 12 weeks" chart from a char-code-seeded pseudo-random series (`s.id.charCodeAt(0) * 9301 + 49297`) scaled off `monthly` — a §10 "no fake completion / no hard-coded test data in production paths" violation. The component was written against the fixture dataset (`data.ts` demo mailbox), and the #146 restoration wired it into the real-data table without re-checking which of its inputs were still synthesized. Real per-sender history existed the whole time (`GET /api/senders/:id/timeseries`, D45, shipped #30). A user comparing the expanded row against the same sender's Detail page saw two different "histories" — the trust wedge (D7 posture) cannot afford charts that lie.
**Correct approach:** When promoting a fixture-era component into a wire-data surface, audit every rendered datum for its source; anything still derived from fixture helpers (seeded series, `sampleSubjects`-style pools) either gets wired to its real endpoint or removed. Fetch-on-expand + loading/empty/error states (D211) is the pattern; the Detail page's route/presentational split (D198) keeps the states story-coverable.
**Rule:** No chart/number in a production surface may be derived from a seed, a pool, or a fixture helper — if the real endpoint exists, wire it; if it doesn't, cut the widget rather than fake it.
**Enforcement update:** None automated. The sibling "Recent subjects" list in the same panel still renders the fixture `SUBJECT_POOL` — flagged as a follow-up task (wire to `GET /api/senders/:id/messages` or remove). Candidate hook: grep production `features/**` for imports of fixture-only helpers if this class recurs.

## 2026-07-03 — Composite preview "N /mo" inherited the buckets' INBOX scope and read "0 /mo" for archived-recent senders
**PR:** #272 (fix); shipped originally in the ADR-0020 composite-preview PR
**Caught by:** founder report during the 2026-07-03 senders smoke — D226 unsubscribe preview showed "0 /mo" for a sender whose card said 72 in last 30d
**What happened:** `previewComposite` computed every aggregate — the per-window bucket counts, the recent-subjects arrays, AND the context strip's `monthly` — over one subquery scoped to `'INBOX' = ANY(label_ids)`. The scope is required for the buckets (D226: the preview must equal what the action will move) but `monthly` means "received per month" and must match the senders-list card figure (`last30dMsgs`, label-agnostic). Any sender whose recent mail was already archived rendered "0 /mo" in the confirm modal next to a card saying 72 — two different quantities under the same "/mo" label, on the trust-critical preview surface. Specs were green because the fixture asserted the buggy semantics (`monthly = inbox msgs in 30d`).
**Correct approach:** When several figures share one FROM, check each figure's SEMANTIC scope independently — a predicate that is a correctness requirement for one aggregate is a bug for another. Any number the UI renders under an existing label ("N /mo") must be computed by the same expression as the other surfaces rendering that label.
**Rule:** Two surfaces printing the same labeled metric must share one canonical SQL expression (or one service method); a copy that "rides along" an existing query inherits that query's WHERE and silently changes meaning.
**Enforcement update:** Spec now asserts `monthly` counts a non-INBOX recent message (the regression shape). Candidate: extract shared metric expressions (last30dMsgs) into one SQL helper consumed by both read-service and actions-service if a third consumer appears.
