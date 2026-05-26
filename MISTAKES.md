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
