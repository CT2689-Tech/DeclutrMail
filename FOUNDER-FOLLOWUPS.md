# Founder Follow-ups — DeclutrMail

Single source of truth for actions that only the founder can take —
repo settings toggles, secrets configuration, third-party account setup,
domain decisions outside the D-plan, anything that needs human judgment
or credentials.

See CLAUDE.md §11 for the file's lifecycle. Append-only structurally;
items physically move from **Open** to **Done** as they're addressed.

## Entry format

```markdown
### YYYY-MM-DD — Short title
**Source:** <PR #N | session | review finding | external ask>
**Why:** what this unblocks or fixes
**How:** the literal steps the founder takes (clickable URL when applicable)
**Verifies by:** how we know it's done (signal that returns to green / log line / config visible)
**Status:** Open | Done <YYYY-MM-DD> | Skipped <YYYY-MM-DD> + reason
```

When an item moves to **Done**, cut + paste the entry from the Open
section to the Done section. Do not delete entries — the trail matters.

## Open

<!-- Newest at top. -->

### 2026-05-23 — Outbox dispatcher SKIP LOCKED runtime proof (D13)

**Source:** PR `feat/d013-outbox-dispatcher` — LEARNINGS 2026-05-23.
**Why:** The outbox dispatcher uses `FOR UPDATE SKIP LOCKED` for
concurrent claim safety. The SQL-level assertion in the unit tests
proves the clause is in the query, but PGlite (single-connection) cannot
demonstrate the runtime semantics — two concurrent dispatchers cannot be
proven to grab disjoint row sets via the in-process test harness. The
behavior is standard Postgres; the gap is test coverage, not
correctness. Same gap will apply to future multi-connection features
(advisory locks for AutopilotApplyWorker, real-Postgres serializable
isolation tests).
**How:** Either (a) add `testcontainers` to a shared `packages/test-utils`
package (avoids the workers-package peer-dep collision this PR hit when
testcontainers was tried in `packages/workers/devDependencies` — see the
PR description) and write a real-Postgres test that runs two dispatchers
concurrently against 20 seeded rows; or (b) make the existing
`docker-compose.yml` (Redis-only today, Postgres-already-on-host) the
ad-hoc target by setting `OUTBOX_TEST_PG_URL` in dev/CI and gating the
test with `describe.skipIf(!process.env.OUTBOX_TEST_PG_URL)`. Option (a)
is the durable answer; option (b) unblocks the runtime proof in days
rather than weeks.
**Verifies by:** A CI run that exercises the SKIP LOCKED concurrency
test against real Postgres (visible in workflow logs as
"OutboxDispatcherWorker (real Postgres, SKIP LOCKED)" passing rather
than skipped).
### 2026-05-23 — Wire a pre-commit `prettier --check` so format never drifts on main
**Source:** PR #47 — `Format check` CI gate failed on a baseline of 5
files that had never been formatted (`docs/adr/0008-*.md`,
`packages/shared/src/contracts/{envelope,index,paginate}.ts`,
`packages/shared/src/index.ts`). The drift was on `origin/main`, not in
this PR's diff — every PR opened from main would have failed the gate.
Cleaned up in PR #47's `chore(format): prettier baseline cleanup` commit
as a pragmatic unblock.
**Why:** Local enforcement prevents the same drift from recurring. The
CI gate is the last line of defense — pre-commit catches it before the
commit even lands, so contributors don't have to re-run + amend after
a remote failure. Husky is already wired (`.husky/commit-msg` enforces
commitlint), so adding a `pre-commit` hook is the minimal next step.
**How:**
  1. Add `.husky/pre-commit` that runs `pnpm exec lint-staged` (or a
     direct `pnpm exec prettier --check $(git diff --cached --name-only
     --diff-filter=ACM)` if lint-staged isn't desired).
  2. If using lint-staged, add a `lint-staged` block to root
     `package.json` mapping `*.{ts,tsx,js,md,json,yaml,yml}` →
     `prettier --check`.
  3. Verify a deliberately mis-formatted file is rejected by the hook.
**Verifies by:** `git commit` on a deliberately mis-formatted file
fails with prettier's diff output, and `pnpm format:check` on
`origin/main` stays green for ≥5 consecutive PRs.
**Status:** Open

### 2026-05-23 — Account hard-delete execution (D205 + D232 completion)
**Source:** PR `feat/d232-undo-journal` — schedule-only scope per CLAUDE.md §9 stop-condition
**Why:** This PR ships the D232 schedule computation
(`AccountDeletionOrchestrator.computeSchedule`) but DELIBERATELY does
not execute the hard-delete. Account deletion is a CLAUDE.md §9 stop
condition — the founder must review the destructive code path. Three
pieces remain to complete D232/D205:
  1. **Persistence.** New `account_deletion_requests` table (or rows on
     `users`) recording `requested_at`, `effective_deletion_at`, the
     basis, and the waiver-token if the user typed `DELETE AND WAIVE UNDO`.
  2. **Sync pause** (D232 requirement). Once deletion is scheduled,
     pause sync regardless of OAuth state — without this, "delete inbox
     data while OAuth stays connected" silently repopulates from Gmail
     after the worker tick.
  3. **Cron-keyed deletion job** at `effective_deletion_at` via
     `cronPolicy` (D225) with `scheduled_at_minute` keyed on the
     computed time. The job hard-deletes per the existing
     `mailbox_accounts.id → CASCADE` chain (already cascades
     `provider_sync_state`, `mail_messages`, `senders`,
     `sender_timeseries`, `sender_policies`, `undo_journal`).
**How:** Open a `feat/d232-account-hard-delete` PR after this one
merges. Add the `account_deletion_requests` schema in a new migration,
extend `AccountDeletionOrchestrator` with `schedule()` (persists) +
`execute()` (runs at the cron tick), and wire the sync-pause via a
`account.deletion_scheduled` event (D204) consumed by SyncModule.
**Verifies by:** Integration test: schedule a deletion with an active
30-day undo token → effective time = now+30d, basis = `undo-window`,
sync paused. Time-travel the test clock past `effective_deletion_at` →
mailbox row + cascaded children gone.
**Status:** Open

### 2026-05-23 — D-CANDIDATE: undo-tray hook migrates to TanStack Query (D200)
**Source:** PR `feat/d232-undo-journal`
**Why:** `useUndoTray` in `packages/shared/src/components/undo-tray/`
stubs `fetch` directly because the D200 TanStack Query foundation is
not in place. The stub is correct (returns the right `UndoTrayDataSource`
shape) but lacks first-class error states, refetch-on-window-focus, and
optimistic mutation rollback — all things TanStack supplies.
**How:** When the D200 query-client provider lands, swap the stub for
`useQuery({ queryKey: ['undo', mailboxAccountId] })` + `useMutation`
for revert. The `UndoTrayDataSource` contract does not change — only
the hook's body — so consumers (UndoTray component, future Triage
integration) need no updates.
**Verifies by:** Network-failure path renders an error state instead of
silently emptying the tray; a successful revert in one tab updates the
tray in another via TanStack's stale-time invalidation.
**Status:** Open

### 2026-05-23 — Resume WT-A Triage screen (D29–D35, D207, D208, D226)
**Source:** overnight 8-hr autonomous run — background agent hit session limit before commit
**Why:** PR 5 (per D187) is the Triage feature slice — the critical-path
feature gating the rest of the product surface. The WT-A agent shipped
~50% (6 quality files, 1058 LoC) before being killed by the API session
limit (resets 2:20am PT).
**State on disk:** worktree `.claude/worktrees/agent-a1b6fdeaf8e452bce`,
branch `feat/d207-triage-screen` (local-only, not pushed). Files
present:
  - `apps/web/src/features/triage/data.ts` (386 LoC — fixtures + types)
  - `apps/web/src/features/triage/store.ts` (68 LoC — Zustand store: undo tokens + skipSheet pref per D34)
  - `apps/web/src/features/triage/use-triage-actions.ts` (81 LoC — verdict mutation hook)
  - `apps/web/src/features/triage/use-triage-queue.ts` (59 LoC — TanStack queue hook, mocked)
  - `apps/web/src/features/triage/action-sheet.tsx` (242 LoC — D34 modal + remember-pref toggle)
  - `apps/web/src/features/triage/action-preview.tsx` (222 LoC — D226 MANDATORY preview)
**Still missing for a complete PR:**
  1. `apps/web/src/features/triage/triage-page.tsx` orchestrator (~150 LoC) — loading / empty / error / queue states; wires the 6 existing files
  2. `apps/web/src/features/triage/triage-queue-card.tsx` (~150 LoC) — single sender card; uses `useExpandableRow` from foundation; K/A/U/L toolbar; confidence-emphasis at >0.85 (D31)
  3. `apps/web/src/features/triage/empty-state.tsx` (~50 LoC) — D33 stats + tomorrow CTA + upgrade nudge
  4. `apps/web/src/features/triage/undo-tray.tsx` (~80 LoC) — D35 persistent tray with countdown
  5. `apps/web/src/app/(app)/triage/page.tsx` route (~10 LoC)
  6. Storybook stories per component (~200 LoC; D210)
  7. `zustand` package add to `apps/web/package.json` (typecheck currently fails because feature imports zustand directly; foundation only added it to `packages/shared`)
  8. Mobile reflow proof at 380px (LEARNINGS 2026-05-19)
**How:** Either (a) re-launch a background agent post-session-reset with
prompt focused only on the remaining 7 items, or (b) finish manually in
~30–60 min next session. Base branch for the PR remains
`feat/d198-d200-frontend-foundation` (PR #29, stacked).
**Verifies by:** PR opened with title
`feat(triage): Triage screen + action lifecycle (D29-D37, D207, D208, D226)`,
all gates green, Storybook story count ≥ 8, `Closes D29` through `D226`
in body, no "Screen" UI strings, no body-field references.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: D156 throttle on Gmail OAuth connect routes
**Source:** architecture-guardian gate on PR `feat/d009-sync-data-capture`
**Why:** `GET /api/auth/google/start` + `GET /api/auth/google/callback`
lack `@Throttle()` decorators. Both routes are flag-gated
(`GMAIL_CONNECT_ENABLED=false`) and unauthenticated pre-D109, so the
absence is consequential the moment the flag flips on in any public
environment: an attacker can fan out `/start` (each builds an
`OAuth2Client` and sets a cookie) or replay `/callback` with random
codes to harvest error-shape differences.
**How:** Land per-route throttles before `GMAIL_CONNECT_ENABLED` goes
true anywhere. D156 picks the per-feature limit; suggested floor
`{ limit: 10, ttl: 60_000 }` per IP on both routes.
**Verifies by:** Both controller handlers carry `@Throttle({...})`; a
burst test (11 requests/min from one IP) returns 429 on the 11th.
### 2026-05-22 — D-CANDIDATE: D159 Sentry seam for background reconciler
**Source:** architecture-guardian gate on PR `feat/d009-sync-data-capture`
**Why:** `BaseDeclutrWorker.captureFailure()` is documented as the
single failure-capture point for D159 Sentry wiring. The boot/periodic
reconciler in `apps/api/src/worker.ts` runs OUTSIDE the BullMQ job
loop, so its error path (raw `console.error` with
`kind: 'reconciler.failed'`) bypasses that seam. When D159 lands on
`BaseDeclutrWorker`, the reconciler will silently miss Sentry.
**How:** When the D159 wiring PR lands, either (a) extract a shared
`captureBackgroundFailure(err, { kind })` helper that both the worker
base and the reconciler call, or (b) move the periodic reconciler
inside a long-lived `BaseDeclutrWorker` subclass so the existing seam
covers it.
**Verifies by:** A forced reconciler exception (DB unreachable in a
test env) shows up in Sentry with `kind: reconciler.failed`.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: limiter cache eviction tied to D232 account deletion
**Source:** silent-failure-hunter gate on PR `feat/d009-sync-data-capture`
**Why:** `apps/api/src/worker.ts` keeps a `limiterByMailbox: Map<id,
RateLimiter>` for the lifetime of the worker process. The map only
shrinks on process restart. After D232 ships and mailboxes can be
deleted, deleted-mailbox limiter entries leak indefinitely. Memory
creep without an error signal.
**How:** Wire into the D232 account-deletion job — emit a
`mailbox.deleted` cross-feature event (D204) the worker subscribes to
and uses to `limiterByMailbox.delete(id)`. Alternative: LRU cap on
the map (simpler, but loses sliding-window history when the cap
forces eviction of a live mailbox).
**Verifies by:** Delete a mailbox in a test env; the worker's
process-memory baseline (or a `process.memoryUsage()` exposed metric)
does not retain its limiter entry.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: DB CHECK constraints for unsubscribe URL scheme invariant
**Source:** schema-migration-reviewer gate on PR `feat/d009-sync-data-capture`
**Why:** `mail_messages.unsubscribe_url` now means "HTTPS URL"
(post-Codex iter 5 channel split) and `mail_messages.unsubscribe_mailto_url`
means "mailto URL". The contract is enforced in the worker's parser
only — a future writer that misses the docstring could insert a
`mailto:` URL into the HTTPS column. Same risk on
`senders.unsubscribe_url` (method-aligned scheme).
**How:** When the next `mail_messages`/`senders` migration ships, add:
```sql
ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_unsubscribe_url_https
  CHECK (unsubscribe_url IS NULL OR unsubscribe_url LIKE 'https://%');
ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_unsubscribe_mailto_scheme
  CHECK (unsubscribe_mailto_url IS NULL OR unsubscribe_mailto_url LIKE 'mailto:%');
```
And on senders: method-vs-url alignment via a multi-column CHECK.
**Verifies by:** A direct `INSERT mail_messages(...unsubscribe_url='mailto:x')`
SQL is rejected by the DB; `pnpm db:test` covers the constraint.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: defense-in-depth — inbound `recipient_emails IS NULL` CHECK
**Source:** privacy-auditor INFO on PR `feat/d009-sync-data-capture`
**Why:** ADR-0004 commits to `mail_messages.recipient_emails IS NULL`
when `is_outbound=false` (inbound recipients = the connected mailbox
itself, no product value, stricter privacy posture). Today the
invariant lives only in the worker's `toMessageRow()` ternary. A
future writer that bypasses that path could violate it without
detection.
**How:** Next `mail_messages` migration adds
`CHECK (recipient_emails IS NULL OR is_outbound = true)`. Combine with
the unsubscribe CHECKs above into one constraints-tightening migration.
**Verifies by:** `INSERT mail_messages(is_outbound=false,
recipient_emails=ARRAY['x@y.com'])` is rejected by the DB.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: D150 index inventory audit before launch
**Source:** schema-migration-reviewer gate on PR `feat/d009-sync-data-capture`
**Why:** `mail_messages` now carries 5 indexes — `provider_message_uniq`,
`account_sender_date_idx`, `account_date_idx`, `account_sender_unread_idx`
(partial), and the new `account_id_idx` for keyset pagination. Every
INSERT writes all five plus the PK. D150's launch index budget is
~12 across the schema; the hottest write table now consumes 5 of
them. Worth a consolidation pass before partitioning (D235) locks
the inventory.
**How:** Pre-launch perf review: `EXPLAIN ANALYZE` the keyset stream
against `account_date_idx` widened to `(mailbox_account_id,
internal_date, id)` — if it satisfies both chrono queries AND keyset
ordering, drop `account_id_idx`. Otherwise keep both, document the
write-tax trade.
**Verifies by:** Pre-launch perf review note; index count on
`mail_messages` either stays at 5 with a rationale doc or drops to 4.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: D235 partition-key decision when triggers fire
**Source:** schema-migration-reviewer gate on PR `feat/d009-sync-data-capture`
**Why:** The new `(mailbox_account_id, id)` composite — together with
the existing `(mailbox_account_id, provider_message_id)` unique
constraint used for D229 Pub/Sub dedup — entrenches
`mailbox_account_id` as the partition discriminator. When D235's
partitioning triggers fire (25M rows OR 2M/mailbox OR p95 > 150ms),
the partition ADR has to either pick hash-on-`mailbox_account_id` OR
re-justify the existing indexes against a different key (time-range
on `internal_date`, for example). The decision is no longer free.
**How:** Future partitioning ADR explicitly addresses the constraint
this index inventory imposes. Or shrink the index inventory FIRST
(see the D150 audit item above) so partition choice is unconstrained.
**Verifies by:** Partitioning ADR §"alternatives considered"
explicitly addresses the existing `(mailbox_account_id, …)` index
family.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: migrate `GoogleOAuthService.handleCallback` to D205 `AuthSignupOrchestrator`
**Source:** architecture-guardian INFO on PR `feat/d009-sync-data-capture`
**Why:** `handleCallback` now coordinates four feature concerns inside
one transaction: token decryption, mailbox upsert, sync-intent write
(`SyncService.markQueued`), best-effort BullMQ enqueue
(`SyncService.schedule`). The shape is approaching D205's
`AuthSignupOrchestrator` scope. Today documented as a deferral
("Full Idempotency-Key handling is D205's AuthSignupOrchestrator
scope") with the boundary clean (auth never touches
`provider_sync_state` directly). When AuthSignupOrchestrator lands,
this code should migrate.
**How:** Include the connect-callback migration in the AuthSignupOrchestrator PR
scope. Move to `apps/api/src/auth/orchestrators/` with an explicit
`*OrchestratorOptions` type + UnitOfWork wrapper around the existing
tx.
**Verifies by:** `GoogleOAuthService.handleCallback` shrinks to ≤20
lines; the orchestrator owns the four-step sequence.
**Status:** Open

### 2026-05-22 — CHORE: extract `SyncService.findQueued()` for reconciler
**Source:** architecture-guardian INFO on PR `feat/d009-sync-data-capture`
**Why:** `reconcileQueuedInitialSyncs` in `apps/api/src/worker.ts`
reads `provider_sync_state` directly. The worker is a separate
composition root (no Nest DI) so D204 doesn't formally apply — but
`SyncModule` claims to own that table, and a future schema change to
the durable-intent contract could silently drift the reconciler.
**How:** Extract a tiny `SyncService.findQueued(limit)` helper that
returns mailbox ids. Both the connect path and the reconciler stay
on the same query surface.
**Verifies by:** `grep providerSyncState apps/api/src/worker.ts`
returns zero hits; reconciler test covers `findQueued`.
**Status:** Open

### 2026-05-22 — DISTILL: CLAUDE.md §2.1 storage allowlist amendment (ADR-0004)
**Source:** ADR-0004 (D7 allowlist amendment — data-capture PR
`feat/d009-sync-data-capture`)
**Why:** CLAUDE.md §2.1 enumerates the D7 storage allowlist literally
(sender / subject / snippet / dates / labels / read state). The
data-capture PR adds — with founder approval — four fields:
`To`/`Cc` (outbound only), `List-Unsubscribe` URL,
`List-Unsubscribe-Post` one-click flag, and the derived `is_outbound`
column. CLAUDE.md §11 forbids agents from editing CLAUDE.md directly;
the founder distills via a separate `chore/distill-*` PR.
**How:** Open a `chore/distill-allowlist-extension` PR; amend §2.1's
"DeclutrMail stores ONLY" list to include the four new fields, with a
one-line note that each is tied to a planned feature (D9 unsubscribe;
future reply attribution); reference ADR-0004. No code change.
**Verifies by:** `rg "List-Unsubscribe" CLAUDE.md` returns the new
allowlist entries; ADR-0004 cross-references §2.1's updated wording.
**Status:** Open

### 2026-05-22 — D-CANDIDATE: periodic full re-derive backstop (after PR-D)
**Source:** session — founder ack 2026-05-22, deferred per "no users yet"
**Why:** PR-C/PR #19's initial sync is a complete derive — zero drift.
Once incremental sync (PR-D) lands, a new message arriving triggers an
*incremental* patch of that sender's aggregate (D25, trigger-based
re-score). Incremental patches can drift from truth via bug-class
issues (race, missed event after watch lapse > 7d). Founder estimate:
~0.01% case. Backstop = a cron that runs `building_sender_index`
(already a full re-derive of `senders` + `sender_timeseries` from the
persisted `mail_messages` table) periodically per mailbox. Cheap to
add — re-runs an existing function.
**How:** After PR-D ships, ratify a D for a cron (e.g. weekly per
mailbox) that re-runs `InitialSyncWorker.buildSenderIndex` on the
mailbox. No new schema; reuses the existing function. Worker policy:
`cronPolicy` (D225).
**Verifies by:** the D is ratified post-PR-D; the cron job exists.
**Status:** Open — deferred until PR-D

### 2026-05-22 — D-CANDIDATE: streaming aggregation for >1M-message mailboxes
**Source:** session — Gmail-API architecture review 2026-05-22
**Why:** `InitialSyncWorker` collects every message id into memory
(`const ids: string[]`) + loads the FULL `mail_messages` table into
memory in `buildSenderIndex` to fold per-sender. Fine at 250K
(~tens of MB); a single 1M+ mailbox could pressure the worker process
(hundreds of MB of strings + rows). D235 partitioning is deferred
until 25M rows aggregate; this is a *per-mailbox* memory ceiling
distinct from that. Rare edge — most mailboxes are well under 1M.
**How:** Switch the fetch's id-collection + `buildSenderIndex`'s
mail_messages SELECT to streaming/cursor-based aggregation (process
chunks, fold incrementally, never materialise the full list). Ratify a
D when a real 1M+ mailbox arrives or we forecast one.
**Verifies by:** the D is ratified + the worker can sync a synthetic
1M-message mailbox without OOM.
**Status:** Open — deferred until a 1M+ mailbox actually exists

### 2026-05-22 — D-CANDIDATE: onboarding sync UX — D224 5-stage indicator vs timing reality
**Source:** PR [#18](https://github.com/CT2689-Tech/DeclutrMail/pull/18) (`feat/d006-sync-timing-logs`) — timing data
**Why:** D224 locked a 5-stage sync indicator (D109 onboarding gate)
implying roughly comparable stages. Measured reality (327-msg backfill):
`fetching_metadata` = **99.5%** of wall-clock; `building_sender_index`,
`computing_recommendations`, `finalizing` are each <15ms. The
stage-by-stage indicator shown while a user connects their account is
cosmetic — they watch one stage for ~99% of the wait. This holds at
scale: the cheap stages (in-memory fold + batched upserts) stay tiny
regardless of mailbox size; `fetching_metadata` (one `messages.get` per
message) dominates at every size.
**How:** Founder decision on the onboarding sync UX —
(a) keep the stage enum as a backend state machine, but have D109 render
message-count progress ("Scanning 12k / 50k"); `progress_pct` is already
count-driven during fetching, so this is a `useSyncStatus`/D109 contract
tweak; or
(b) recent-first sync + background backfill of the remainder — opens the
app fast, but changes D6's strict full-block gate (D191 territory).
Ratify as a D, or amend D224/D109.
**Verifies by:** D-decision recorded; the onboarding sync UX reflects
what the backend actually does (one long stage, not five equal ones).
**Status:** Open

### 2026-05-22 — D-CANDIDATE: `sync_runs` per-account sync-timing history table
**Source:** session — founder ask (2026-05-22)
**Why:** Sync duration is the product's load-bearing trust signal (D6
onboarding gate). PR-C's timing follow-up (`feat/d006-sync-timing-logs`)
emits per-stage timing on the `worker.succeeded` log line, but logs hold
no queryable history. To answer "is sync getting slower for this
account," compare accounts, or find the slow stage over time, a per-run
history table is needed — `provider_sync_state` is current-state only
(one row per mailbox) and cannot hold run history.
**How:** Ratify a new D-decision for a `sync_runs` table — one row per
sync run: `mailbox_account_id` (FK), `attempt`, `started_at`,
`finished_at`, `status`, `stage_timings jsonb`, `messages_synced`,
`senders_indexed`, `gmail_api_calls`, `error_code`. A follow-up PR then
adds the migration and the worker persists `InitialSyncResult` (already
shaped 1:1 to these columns). No privacy concern — timings + counts
only, no Gmail content; D7 unaffected.
**Verifies by:** the D is ratified + numbered; a follow-up PR ships the
table + the worker writes a row per run; sync timing is queryable per
account over time.
**Status:** Open

### 2026-05-22 — RATIFY: D203 vs D225 `WORKER_POLICIES` name collision (plan-drift)
**Source:** PR-C (`feat/d157-initial-sync-worker`) — implementation finding
**Why:** Two D-decisions define a thing called `WORKER_POLICIES`
differently. D203's body lists retry/backoff config objects
(`standard`, `gmailApi`, `criticalAudit`, `lowPriority`, `nonRetryable`).
D225 (later — the HC-3 audit pass) says D203's set is
`{webhookPolicy, perMailboxPolicy, batchPolicy}` and expands it with
`cronPolicy` + `adminPolicy`. The `architecture-guardian` agent enforces
D225's 5-name enum. PR-C followed D225 per CLAUDE.md §3 (latest D wins)
and folded D203's retry/backoff/timeout fields into each named policy.
The collision should be resolved in the plan text so a future session
does not re-litigate it.
**How:** Amend the plan: add an `[AUDIT PATCH on D203]` marker (or edit
D203's body) stating the policy NAMES are D225's five
(`webhookPolicy | perMailboxPolicy | batchPolicy | cronPolicy |
adminPolicy`) and D203's retry/backoff/timeout fields are properties OF
each named policy — not a separate set. No code change needed; PR-C's
`packages/workers/src/worker-policies.ts` already implements the merged
shape.
**Verifies by:** the plan's D203/D225 text describes one coherent
5-policy set; a future worker PR finds no naming ambiguity.
**Status:** Open

### 2026-05-22 — GATE: do not deploy the API before the D109/D224 auth layer
**Source:** PR [#16](https://github.com/CT2689-Tech/DeclutrMail/pull/16) (PR-B) — Codex adversarial review; ADR-0002
**Why:** PR-B's Gmail OAuth connect flow is unauthenticated — it bootstraps
a `workspace` + `user` from the connected Gmail address because no app
auth layer exists yet. Safe **only** because the app is not deployed.
Exposing it on a network before D109/D224 would allow anonymous tenant
creation. This is an accepted, documented limitation — see
`docs/adr/0002-pr-b-unauthenticated-oauth-connect.md`.
**How:** Do not deploy `apps/api` (Cloud Run) until the D109/D224
onboarding/auth layer ships and the OAuth connect binds to an
authenticated principal. The connect routes are off by default
(`GMAIL_CONNECT_ENABLED` unset → `GoogleOAuthModule` not loaded) — keep
them off in any shared/deployed environment until then.
**Verifies by:** D109/D224 ships; the connect flow rejects unauthenticated
callers and reconnect re-validates mailbox ownership; only then is
`apps/api` deploy-eligible.
**Status:** Open

### 2026-05-21 — RATIFY: `sender_timeseries.opens` renamed to `read_count` (D-candidate)
**Source:** PR [#13](https://github.com/CT2689-Tech/DeclutrMail/pull/13) — schema review finding
**Why:** The D-plan's draft timeseries schema names the read column
`opens`. The Gmail API exposes **no message-open events** — the only
read signal is the `UNREAD` label. PR-A shipped the column as
`read_count` (count of a month's messages without `UNREAD`) rather than
silently encode a metric that cannot be populated honestly.
**How:** Amend the plan's `sender_timeseries` schema definition: rename
`opens` → `read_count`, noting it is UNREAD-derived, not open-tracking.
No code change needed — PR-A already ships `read_count`.
**Verifies by:** the plan's timeseries-table definition reads `read_count`;
a future session finds no `opens`/`read_count` mismatch.
**Status:** Open — **founder ratified the rename 2026-05-21.** PR-A already
ships `read_count`. Remaining: the plan-file edit (`opens` → `read_count`),
which rides with the 2026-05-20 reconciliation-pass plan edit below.

### 2026-05-21 — SETUP: provision Gmail sync infrastructure (PR-B/C/D blockers)
**Source:** session — Senders backend plan (`docs/execution/senders-backend-plan.md` §9)
**Why:** PR-B (OAuth), PR-C (initial sync), and PR-D (incremental
webhook) need external infrastructure that does not exist yet. Code can
be written against `.env.example` placeholders but cannot run without
these.
**How:** Follow the step-by-step runbook at
**`docs/ops/sync-infra-setup.md`** — it covers, in order:
  1. **GCP project + OAuth client (D4)** — confirm V1 reuse; collect
     `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `GOOGLE_CLOUD_PROJECT_ID`.
  2. **`TOKEN_ENCRYPTION_KEY`** — generate a 256-bit AES key
     (`openssl rand -base64 32`); store in GCP Secret Manager.
  3. **Upstash Redis** — create the instance; collect `REDIS_URL`.
  4. **Pub/Sub** — topic `gmail-push` + push subscription + OIDC service
     account; collect `GMAIL_PUBSUB_TOPIC` / `PUBSUB_OIDC_AUDIENCE`.
  5. Place all values in GitHub Actions secrets + GCP Secret Manager;
     never commit (CLAUDE.md §10).
**Verifies by:** PR-B/C/D run end-to-end in staging — a connected mailbox
backfills, and a new message triggers the webhook.
**Status:** Open

### 2026-05-20 — Reconcile plan vs. the Senders-screen design rebuild (D1/D2/D227/D187)
**Source:** session — Senders rebuild (PR-A `feat/d001-design-foundation`; PR-B to follow)
**Why:** The founder approved rebuilding the canonical DeclutrMail-v2 Senders
screen, which knowingly diverges from four locked decisions. Build proceeded on
a "build now, reconcile after" basis — CLAUDE.md + the plan must now be updated
to match reality so future sessions don't read the divergence as plan-drift.
**How:**
  1. **D1** — replace "Geist Sans/Mono" with the adopted stack: Inter (UI) +
     JetBrains Mono (mono) + Fraunces (display). Update CLAUDE.md §4 + the D1
     body in the plan.
  2. **D2** — replace "Cool/Vercel palette" with the warm-newsprint palette
     (`#FAFAF7` paper, `#006B5F` deep-teal accent). Update CLAUDE.md §4 + D2.
  3. **D227 / §2.2** — the rebuild renders Keep / Archive / Unsubscribe / Later
     (canon) plus **Protect** as a distinct VIP/lock operation; "Mute" is
     relabelled to "Later"; "Trash" and "Digest" are dropped. Decide whether
     §2.2 formally permits Protect (and any non-triage verbs) on management
     surfaces, and update the guardrail wording accordingly.
     **Resolved this session — "Later" behavior:** Later routes a sender's
     _future_ mail to a `DeclutrMail/Later` Gmail label (skips the inbox);
     existing inbox mail is untouched unless the confirm modal's "also clear
     historic" toggle is used; the sender then exits the triage queue.
     Distinct from Keep (mail stays in the inbox). Implemented in the Senders
     rebuild — Later now routes through the D226 confirm preview. Ratify into
     D20's verdict definition + D227 + §2.2.
  4. **D187 / §5** — this work defers Storybook and builds the Senders screen
     ahead of the named 5 golden screens. Decide whether to amend D187's PR-3
     definition or log this as an approved detour. Note: the `design-system-agent`
     gate may flag a primitive library shipped without Storybook stories — the
     PR bodies call this out as intentional.
  5. **D220 / §6** — the rebuilt primitive library renames and extends the
     locked component inventory (`Kbd`, `Card`, `Eyebrow`, `Spark`, `Avatar`,
     `Button`, `ScreenIntro`, `Sidebar`, `AppShell`, `Toast`, `SenderSearch`);
     only `EmptyState` matches the D220 allowlist. Reconcile the D220 inventory
     with the shipped primitive set.
**Verifies by:** CLAUDE.md §2.2/§4 + the plan's D1/D2/D187/D227 entries describe
the shipped design; a fresh session reading them finds no contradiction with
`apps/web`.
**Status:** Open

### 2026-05-19 — (Optional) Configure ATLAS_CLOUD_TOKEN to unblock Atlas v0.38+
**Source:** PR #5 — `migration-lint.yml` `setup-atlas` step
**Why:** Atlas v0.38 (April 2026) gated `atlas migrate lint` behind a paid /
login-required Pro plan. We pinned `setup-atlas` to **v0.37.0** to keep the
community lint working without a token. Adding `ATLAS_CLOUD_TOKEN` lets us
upgrade to the latest Atlas (security patches + newer rules) AND get the
Atlas Cloud dashboard with migration history + drift detection.
**How:** Create a free account at https://auth.atlasgo.cloud/login, generate a
token under Settings → API Tokens, and add `ATLAS_CLOUD_TOKEN` to
https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions.
Then edit `.github/workflows/migration-lint.yml`:
  1. Remove the `version: v0.37.0` pin from the `setup-atlas` step
  2. Add an `atlas login` step using the token before `atlas migrate lint`
  3. Or pass `cloud-token: ${{ secrets.ATLAS_CLOUD_TOKEN }}` to setup-atlas
**Verifies by:** `atlas migrate lint` check still passes with the latest Atlas
release; lint reports appear at atlas.ariga.io.
**Status:** Open
**Reference:** https://atlasgo.io/blog-v038#change-in-v038-atlas-migrate-lint

### 2026-05-19 — Decide on project-scoped MCP servers
**Source:** PR #4 — `.mcp.json` shipped as empty scaffold.
**Why:** Project-scoped MCP servers (Supabase, Sentry, Postgres, etc.)
in `.mcp.json` are shared with every collaborator + cloud session. The
right time to add them is when each underlying service is actually
configured for the project (Supabase project provisioned, Sentry org
created, etc.).
**How:** As each service comes online, add its MCP server config to
`.mcp.json`. Reference: https://code.claude.com/docs/en/mcp.
**Verifies by:** `.mcp.json` contains entries for the live services;
cloud sessions auto-discover them on startup.
**Status:** Open

## Done

<!-- Items move here when completed. Keep the original entry, add the
"Status: Done <date>" line. -->

### 2026-05-22 — D-CANDIDATE: D159 Sentry seam for background reconciler
**Source:** architecture-guardian gate on PR `feat/d009-sync-data-capture`
**Why:** `BaseDeclutrWorker.captureFailure()` is documented as the
single failure-capture point for D159 Sentry wiring. The boot/periodic
reconciler in `apps/api/src/worker.ts` runs OUTSIDE the BullMQ job
loop, so its error path (raw `console.error` with
`kind: 'reconciler.failed'`) bypasses that seam. When D159 lands on
`BaseDeclutrWorker`, the reconciler will silently miss Sentry.
**How:** When the D159 wiring PR lands, either (a) extract a shared
`captureBackgroundFailure(err, { kind })` helper that both the worker
base and the reconciler call, or (b) move the periodic reconciler
inside a long-lived `BaseDeclutrWorker` subclass so the existing seam
covers it.
**Verifies by:** A forced reconciler exception (DB unreachable in a
test env) shows up in Sentry with `kind: reconciler.failed`.
**Status:** Done 2026-05-23 — option (a) shipped on
`feat/d203-base-declutr-worker`. `BaseDeclutrWorker` now accepts an
injectable `WorkerObserver` via `setObserver()`; the observer interface
exposes `captureFailure(err, ctx)` for the BullMQ job loop AND
`captureBackgroundFailure(err, ctx)` for failures outside it. The
reconciler in `apps/api/src/worker.ts` calls
`observer.captureBackgroundFailure(error, { kind: 'reconciler.failed' })`
right after the existing structured log; `tick_unexpected`,
`worker.shutdown_failed`, and `worker.boot_failed` paths route through
the same seam. With `SENTRY_DSN` unset the observer is a no-op
(matches the API's `initSentry` posture). Verification deferred to a
manual staging exercise once `SENTRY_DSN` is provisioned — the test
suite covers the wiring (`packages/workers/src/base-declutr-worker.test.ts`
asserts the "exactly once per terminal failure" contract; the no-DSN
branch is unit-tested in `apps/api/src/observability/sentry-worker-observer.spec.ts`).
### 2026-05-22 — D-CANDIDATE: D156 throttle on Gmail OAuth connect routes
**Source:** architecture-guardian gate on PR `feat/d009-sync-data-capture`
**Why:** `GET /api/auth/google/start` + `GET /api/auth/google/callback`
lack `@Throttle()` decorators. Both routes are flag-gated
(`GMAIL_CONNECT_ENABLED=false`) and unauthenticated pre-D109, so the
absence is consequential the moment the flag flips on in any public
environment: an attacker can fan out `/start` (each builds an
`OAuth2Client` and sets a cookie) or replay `/callback` with random
codes to harvest error-shape differences.
**How:** Land per-route throttles before `GMAIL_CONNECT_ENABLED` goes
true anywhere. D156 picks the per-feature limit; suggested floor
`{ limit: 10, ttl: 60_000 }` per IP on both routes.
**Verifies by:** Both controller handlers carry `@Throttle({...})`; a
burst test (11 requests/min from one IP) returns 429 on the 11th.
**Status:** Done 2026-05-23 — PR #35 (`feat(api): Redis token-bucket
rate limiter + decorator (D156)`, merged 2026-05-23) shipped the D156
infrastructure AND wired `@RateLimit('auth')` onto both
`GoogleOAuthController.start` + `.callback` (`apps/api/src/auth/google-oauth.controller.ts`
lines 32, 48). The `auth` bucket default is `5 / 60s per IP` —
stricter than the originally-suggested `10 / 60s` floor, deliberately
chosen for the OAuth surface in `rate-limit.types.ts:37`.
`rate-limit.interceptor.spec.ts` covers the runtime 429 + Retry-After
behavior; `google-oauth.controller.spec.ts` (added in this PR
`feat/d012-sender-key-hash`) is the route-level metadata-presence
guard against future decorator removal. The followup was authored
2026-05-22, after PR #35 was opened but before this Done-move was
filed; recording resolution now.

### 2026-05-19 — Fix `Flip D-rows ⬜ → 🔵` workflow — failing silently on every merge
**Source:** PR #5 + PR #7 — both merged with `Closes D###` in body, but
`IMPLEMENTATION-LOG.md` was never updated. `pr-merged.yml` showed
`conclusion: failure` for both runs. D11, D152, and D160 had to be
flipped via a manual PR.
**Why:** The bot's `git push origin main` was rejected — confirmed from the
run log: `GH013: Repository rule violations found for refs/heads/main`. The
`main` ruleset ("protect main", not a classic branch-protection rule) carried
a rule at the time that blocked the `github-actions` bot's push.
**How:** No code or settings action was needed in the end. The `main` ruleset
was edited on 2026-05-19 22:36 — 25 min after the last failure (22:11) —
relaxing it to just `deletion` + `non_fast_forward` rules. Those allow the
bot's fast-forward push while still blocking force-pushes (CLAUDE.md §10). The
three "pick one" options originally listed (bypass actor / rewrite to open a
PR / PAT) were never needed.
**Verifies by:** `pr-merged.yml` has 6 consecutive successful runs since
2026-05-19 22:43 — including PR #13 on 2026-05-22 (`D150: 1 row(s) flipped`,
`70cb2db..2debc50 main -> main` push OK).
**Status:** Done 2026-05-19 — self-resolved by the ruleset edit; verified
green through 2026-05-22 via the run logs (this session). The earlier
"founder chose option 1" note was based on a stale diagnosis — corrected.

### 2026-05-20 — Gate-agent `.md` scope/description sections omit `src/`
**Source:** session — `chore/d173-rename-ui-to-shared`, PR 3 prep; broadened 2026-05-22
**Why:** The original finding: `design-system-agent.md`'s Scope section
listed `apps/web/{components,features,app}/**` without `src/`. Recon on
2026-05-22 found the same drift in three more gate-agent files —
`privacy-auditor.md`, `schema-migration-reviewer.md`, and
`webhook-security-auditor.md` — across `description` frontmatter, Scope
lists, and example `git diff` / `rg` commands (e.g. `git diff
packages/db/schema/` would diff an empty path). Doc-level only — the
functional gate router is `subagent-gate.yml` — but the example commands
an agent runs would silently match nothing.
**How:** All four files corrected to `src/` paths and the real schema
filename (`mail-messages.ts`). `architecture-guardian.md` needed no change
(`apps/api/**` is recursive). The earlier note that `.claude/agents/**`
edits are harness-blocked proved incorrect — the edits applied normally.
**Verifies by:** `grep -rnE 'apps/api/[a-z]|packages/db/schema' .claude/agents/`
returns nothing outside `src/` paths.
**Status:** Done 2026-05-22 — all four agent files fixed in PR #14.

### 2026-05-20 — subagent-gate.yml gate-path filters stale vs the `src/` tree
**Source:** session — `chore/d173-rename-ui-to-shared`, review finding
**Why:** `.github/workflows/subagent-gate.yml`'s path filters were written
against a pre-`src/` layout. The `privacy` filter (`apps/api/gmail/**` etc.,
`packages/db/schema/*.ts`), the `schema` filter (`packages/db/schema/**`),
and the `webhooks` filter (`apps/api/webhooks/**`) would all miss the real
tree once `apps/api/src/` exists — `privacy-auditor`, `schema-migration-reviewer`,
and `webhook-security-auditor` would silently not trigger. The original entry
spotted only the `privacy` filter; recon found `schema` and `webhooks` had the
identical drift.
**How:** PR #14 corrected all three filters to the `src/` paths
(`apps/api/src/{gmail,messages,senders}/**`, `packages/db/src/schema/{mail-messages,senders}.ts`,
`packages/db/src/schema/**`, `apps/api/src/webhooks/**`) and the matching
CLAUDE.md §7 gate-table rows.
**Verifies by:** A PR touching `apps/api/src/gmail/**` (PR-B) shows
`privacy-auditor` in the subagent-gate scope report.
**Status:** Done 2026-05-22 — filters + CLAUDE.md §7 fixed in PR #14; PR-B confirms the scope report.

### 2026-05-21 — DECISION: token-encryption scheme for Gmail refresh tokens
**Source:** session — Senders backend plan, PR-B spec (`docs/execution/senders-backend-plan.md` §4)
**Why:** PR-B stores Gmail OAuth refresh tokens. Token encryption is a
CLAUDE.md §9 stop-condition.
**How:** An "app-level AES-256-GCM" option was floated to the founder and
initially OK'd — but a plan check then found **D14 already decided this:
Google Cloud KMS envelope encryption**, and D14 explicitly rejects an
env-var-class key. The conflict was surfaced (CLAUDE.md §3 plan-drift);
the founder confirmed **D14 stands — Cloud KMS envelope.** KEK in Cloud
KMS, per-token DEK, `dek_encrypted bytea` column; local dev uses an
`ENCRYPTION_LOCAL_KEY` fallback (D14-sanctioned). Recorded in
`docs/execution/senders-backend-plan.md` §4; provisioning in
`docs/ops/sync-infra-setup.md` Step 2. PR-B implements it.
**Verifies by:** PR-B ships a real KMS-envelope `TokenCryptoService` with
a round-trip unit test (local-key fallback); `architecture-guardian`
sees a real encrypt path.
**Status:** Done 2026-05-21 — D14 Cloud KMS envelope confirmed (no plan amendment needed).

### 2026-05-21 — DECISION: attachment metadata — ratify or reject a D7 allowlist extension
**Source:** session — founder asked for attachment size + a "find larger attachments" feature
**Why:** The founder asked whether DeclutrMail can fetch attachment size /
has-attachment. `has_attachment` is feasible body-free (`q=has:attachment`);
per-attachment byte size is NOT (needs `format=full` = body fetch = breaks
"Full bodies fetched: 0", D7/D228). Both `has_attachment` and
`size_estimate` would be new fields beyond the D7 allowlist — a
privacy-posture change.
**How:** Founder decided to **skip it** — keep the D7 allowlist as-is. If
users later demand a "large attachments" feature, revisit then: ship
`has_attachment` (body-free) as a ratified allowlist extension; the
per-attachment byte-size feature stays permanently rejected (cannot be
done body-free).
**Verifies by:** PR-A's `mail_messages` ships no attachment columns (true).
**Status:** Skipped 2026-05-21 — deferred until user demand; D7 allowlist unchanged.

### 2026-05-19 — Configure ANTHROPIC_API_KEY in repo secrets
**Source:** PR #4 — `.github/workflows/subagent-gate.yml` documents this
as the wiring point for real Claude API invocation.
**Why:** The 8-agent gate network (CLAUDE.md §7) is defined as files but
the GH Action currently only reports which agents WOULD run on a given
PR's changed paths. Real semantic review by privacy-auditor /
architecture-guardian / schema-migration-reviewer / design-system-agent /
webhook-security-auditor needs the Claude API key to be available to
the workflow.
**How:** Open https://github.com/CT2689-Tech/DeclutrMail/settings/secrets/actions
and add `ANTHROPIC_API_KEY`. Then update `subagent-gate.yml` to invoke
the agents (a follow-up PR — current workflow has the wiring point
marked).
**Verifies by:** A PR touching `apps/api/gmail/**` (for example) shows
privacy-auditor's actual findings in CI, not just a "would-run" report.
**Status:** Done 2026-05-19

### 2026-05-19 — Enable Code Security in repo settings
**Source:** PR #3 CodeQL upload failure (https://github.com/CT2689-Tech/DeclutrMail/actions/runs/26113120364/job/76795270201)
**Why:** CodeQL's analysis step succeeds, but the SARIF upload fails with
"Code Security must be enabled for this repository to use code scanning."
Until this is on, every PR shows a red CodeQL check that's actually a
config warning, not a code issue. Adds noise + risks ignoring real
findings later.
**How:** Open https://github.com/CT2689-Tech/DeclutrMail/settings/security_analysis
and enable **Code scanning** (Default / CodeQL setup). For private repos
this requires GitHub Advanced Security; for public repos it's free.
**Verifies by:** Next PR's CodeQL check ends ✅ instead of ❌, and
findings (if any) show up under the Security tab.
**Status:** Skipped 2026-05-19 — private repo; GitHub Advanced Security is paid. CodeQL workflow removed in PR #7 to eliminate the noise. Revisit if repo goes public or Advanced Security is purchased.
