# Defect-class playbook — what to proactively hunt

**First compiled:** 2026-08-21 · **Method:** 8 parallel review sweeps over `apps/api`, `apps/web`,
`packages/{shared,workers,db,events}` (~178k lines of non-test code), cross-read against
135 `MISTAKES.md` entries. Every finding cited below was re-verified by hand against the
source before it was written down.

**This document is a review aid, not a status report.** It names the defect _classes_ this
codebase actually produces, so a reviewer can look for the class instead of re-deriving each
bug. Live instances are cited as evidence that the class is real and still open — the
authoritative list of open work stays in `FINDINGS.md`.

---

## 1. Why the existing checks don't catch these

Of the 131 `MISTAKES.md` entries carrying a `Caught by:` field:

| Caught by                                            | Share    |
| ---------------------------------------------------- | -------- |
| Adversarial review (Codex stop-time, second reading) | ~53%     |
| Manual smoke / two-account QA                        | ~27%     |
| Production, or the founder                           | ~26%     |
| Structural gate agents (§7)                          | ~18%     |
| **Tests, typecheck, lint**                           | **~11%** |

(Categories overlap; an entry can name more than one source.)

`tsconfig.base.json` is already maximally strict — `strict`, `noUncheckedIndexedAccess`,
`noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `noImplicitOverride`, with **no
package-level relaxation**, **zero** `@ts-ignore`/`@ts-expect-error` in production code, and
only two `eslint-disable no-explicit-any`.

That combination is the whole finding: **the defects still shipping are semantic, and a
green build is structurally incapable of seeing them.** Every class below passes typecheck,
lint, and all five gate agents.

Two structural gaps are worth closing anyway, because they make the semantic hunt cheaper:

- `eslint.config.mjs` uses `tseslint.configs.recommended`, **not** `recommendedTypeChecked`.
  There is no type-aware linting, so `no-floating-promises`, `no-misused-promises`,
  `await-thenable` and `no-unnecessary-condition` are all unenforced. (Audited: the 292
  current `void`-ed statements are all safe — `track()` and `invalidateQueries` are total
  functions — so this is a guard against future code, not a live defect.)
- `noPropertyAccessFromIndexSignature` is off, so a typo'd `process.env.NEXT_PUBLIC_API_ULR`
  reads `undefined` and silently takes its `?? ''` fallback across ~30 env reads.

---

## 2. The classes

Each class states its **shape**, **why it survives review**, the **question that finds it**,
and **live instances**.

### C1 — Sibling blindness: the class was fixed at one site, not as a class

The single most recurrent shape in `MISTAKES.md` (9+ entries: "left its sibling running",
"shipped a fourth in the same PR", "three rounds of the same defect", "each safety rule died
at the boundary of the case it was scoped to").

**Why it survives:** the fix is real, tested, and reviewed. Nobody enumerates the family.

**Question:** _Where else does this exact shape live?_ Derive the family from a structural
property (all enqueue helpers, all webhook dedup gates, all `refetchInterval` callbacks) —
never from the grep that happened to find the first instance.

**Live instances**

- `scripts/check-vendor-limits.mjs:380` counts only Sentry's `accepted` outcome; the PostHog
  check 20 lines below at `:403` correctly reports `quota-limited (data being dropped)`.
  Same file, same function family, one sibling got drop-detection.
- 4 BullMQ enqueue helpers need the `getState()` terminal-residue rule; 3 have it.
  `action-recovery.queue.ts:33` does not, and runs `removeOnFail: false`.
- 3 webhook dedup gates, 3 different shapes — Gmail inserts inside the state tx (correct),
  billing keeps `processed_at` + resumes (correct), Resend does neither
  (`resend-webhook.controller.ts:152-163`).
- The `/mo` suffix on `monthlyVolume` (a 90-day **count**) was fixed in `sender-table.tsx:570`
  with a comment explaining the 3× overstatement; `sender-list-row.tsx:56`,
  `stats-strip.tsx:85` and `review-session.tsx:604` kept it.

### C2 — Label ≠ computation: the number is right, the copy lies

The product's most expensive class. Five P0/P1 `FINDINGS.md` entries (F008–F012) plus
`MISTAKES.md` 2026-07-03 and 2026-07-27 are all this shape.

**Why it survives:** the types are correct, the SQL is correct, and the copy is grammatical.
Only tracing the query back to its `WHERE` reveals the mismatch.

**Question:** for every user-facing number, compare four things against the copy —
**population** (inbox only? all labels? outbound included?), **window** (lifetime / 90d /
since-connect?), **freshness** (live / frozen column / capped list), and **unit**
(count vs rate vs per-month).

**Live instances**

- `autopilot.read-service.ts:401` — `messages7d` joins `mail_messages` with **no
  `internal_date` predicate**; `recent` (`:394`) bounds only `rule_match_log.matched_at`.
  `observe-digest.ts:25` renders it as _"Would have archived N emails … in the last 7 days"_.
  It is the matched senders' entire current inbox backlog — and it is the number the user
  weighs before promoting a rule to unattended destructive automation.
- `sync-gate.tsx:39,55-57` derives stage labels from `progress_pct` buckets and ignores
  `current_stage` entirely, though it is on the wire. `floor(pct/100*6)` clamps to index 5 =
  _"Done — your inbox is ready"_, rendered while the worker is still at
  `computing_recommendations, 90` and the app is still gated. Violates D109 and CLAUDE.md §10.
- `activity.read-service.ts:1047-1064` — `noisePreventedPerMonth` sums `mail_messages`
  across a one-to-many join, so a sender acted on 4× contributes 4× its volume; also missing
  `is_outbound = false`. The `COUNT(DISTINCT sender_key)` beside it is correct, which masks
  it in review.
- `brief-narrative.ts:152-158` renders sender counts (post-cap, `.slice(0, 6)`) as
  _"N emails need replies"_ beside a real message count in the same sentence.
- `quiet-screen.tsx:169` promises _"Autopilot will run them afterward"_ from a count
  (`mailbox-accounts.service.ts:344`) that omits three predicates the executor applies —
  rule enabled, sender not newly Protected, daily cap.
- `reasoning.ts:103` interpolates an unrounded float: _"sends 38.666666666666664/mo"_.
- `compose-strip.tsx:159` (_"unsub'd, still emailing"_) compares against
  `sender_policies.updated_at`, which Protect/Unprotect and snooze-wake also bump — so
  Protecting a sender silently drops it out of the chip.

### C3 — Vacuous guard: the check passes because it cannot see its subject

**Why it survives:** green is green. Nobody asks what red would have required.

**Question:** _has this check ever failed?_ Prove it by moving the threshold past the
measured value, or starving the guard of its input, and watching it go red.

**Live instances**

- `check-vendor-limits.mjs:371-387` queries Sentry `groupBy=outcome` — so `rate_limited` and
  `dropped` **are in the response** — then filters to `accepted` and feeds `gauge()`, which
  is `OK` below the threshold. When the quota trips and real errors start being discarded,
  `accepted` _falls_ and the watchdog goes **greener**. It reports healthiest at the moment
  you are blindest.
- API specs assert `response.code` on the _thrown exception_; web tests mock the _response
  body_. Both pass while `AllExceptionsFilter` deletes the code in between (see C4).

### C4 — Contract stripped in transit: both ends tested, the middle untested

**Why it survives:** producer tests pass. Consumer tests pass. Nothing exercises the join.

**Question:** _what does a client actually receive?_ Run the value through the real
transformation, not past it.

**Live instances**

- `all-exceptions.filter.ts:243-259` preserves a thrown `code` only if it is a key of
  `ERROR_CODES` (42 entries). The API throws **76 distinct codes; 40 never reach the wire** —
  they are rewritten to `BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `INTERNAL_ERROR`.
  ADR-0014 names this exact bug as the reason the registry exists; it has regrown 40×.
  Consequence: `PROTECTED_SENDER` arrives as `CONFLICT`, so five client branches
  (`triage-screen.tsx:912`, `senders-screen.tsx:1005`, `sender-detail-page.tsx:544`,
  `screener-screen.tsx:463`, `use-noise-archive.ts:473`) are **dead code** — no refetch, wrong
  toast, and reopening the action replays the same 409 indefinitely.
- `undo.controller.ts:125-137` throws `new HttpException({ error: { code, message } })`,
  pre-wrapping the envelope the filter owns. The filter looks for a top-level `code`
  (`:302`) and a top-level `message` (`:283`); both miss, so Nest's `initMessage()` fallback
  ships the literal string `"Http Exception"` as the user-facing message. **11 sites across
  3 files** carry this shape — `undo.controller.ts` ×3 (user-facing),
  `resend-webhook.controller.ts` ×4 and `gmail-webhook.controller.ts` ×4 (machine consumers,
  lower impact but the same defect). The undo tray only survives because it branches on the
  bare `err.status === 410` — the pattern MISTAKES.md explicitly bans.
- `activity-screen.tsx:3186` reads `body.code`; the D202 envelope nests it at
  `body.error.code`. The same file reads it correctly 280 lines later at `:3466`.

### C5 — Telemetry that cannot report its own failure

**Why it survives:** observability is the one subsystem with no observer.

**Question:** _if this broke, what would tell us?_

**Live instances (the "errors aren't reaching Sentry" chain)**

1. ~60 of 72 `captureFeatureException` sites have no status gate, so designed 409s are
   captured as errors — CLAUDE.md §8's "a guard's 4xx is a designed state" invariant never
   got its telemetry counterpart.
2. That burns quota (`MISTAKES.md` 2026-08-18 records an 80%-of-volume alert).
3. Past quota Sentry drops real events — and the watchdog reads `accepted`, so it greens (C3).
4. What arrives is stripped unrecognisable: `scrubSentryEvent`
   (`sentry-scrubber.ts:491-535`) rebuilds from an allowlist omitting **`fingerprint`**, and
   the tag allowlist (`:25-47`) contains none of the five tags the filter sets
   (`cid`, `method`, `route`, `response_status`, `upstream_status`). With no fingerprint,
   grouping falls back to the stack of the synthetic `new Error('Server exception')` at
   `all-exceptions.filter.ts:151` — identical for every request. **Every 5xx in the API
   collapses into one untitled issue.** Same shape collapses ~25 worker queues via
   `safeTelemetryError`.
5. Only 6 of the filter's 24 permitted error kinds survive the scrubber's type allowlist;
   `InternalServerErrorException`, `ServiceUnavailableException`, `BadGatewayException`,
   `GatewayTimeoutException` and `HttpException` all arrive with no type. The browser
   allowlist (`:131-145`) contains only built-ins — not one of `ApiError`, `SyncNowError`,
   `BillingPayloadError` is in it.
6. Whole surfaces cannot report at all: `FeatureExceptionContext.surface` (`sentry.ts:21-31`)
   is a closed 9-value union omitting `billing`, `settings`, `followups`, `snoozed`,
   `admin-security`, `mailboxes`, `feedback`. Those screens would get a _type error_ trying.
   `followups-screen.tsx` has 1 `ErrorState` and 0 captures; `billing-screen.tsx` 5 and 0.
7. There is no funnel to catch what individuals missed — **no `QueryCache.onError`** anywhere
   in `apps/web` (only `MutationCache`), so a query that 500s and renders `ErrorState` is
   invisible by construction.
8. `sentry.ts:325-343` latches `attemptsExhausted = true` after two failed chunk loads and
   discards the pending queue, so a redeploy that purges chunks disables telemetry for the
   rest of that tab's session.

**Adjacent**

- 11 declared `EventName` literals have **zero** `track()` call sites — including
  `unsubscribe_attempted` and `rule_fired`, both documented in
  `docs/observability/event-taxonomy.md`, both querying empty in PostHog forever.
- Neither vendor is proxied (`next.config.ts:135` `tunnelRoute: undefined`; `posthog.ts:72`
  `api_host` → `us.i.posthog.com`), so blocker-equipped users are silent from both ends.
- `triage-undo-tray.tsx:216` embeds a literal `U+0000`, so `grep`/`rg` treat the file as
  **binary and skip it** — any repo-wide telemetry audit silently omits the file that owns
  `undo_clicked`.

### C6 — `console.error` mistaken for observability

Sentry initialises with `defaultIntegrations: false` + `integrations: []`
(`observability/sentry.ts:119-120`), so there is no console capture. **32 non-rethrowing
catches in `apps/api` + `packages/workers` output only `console.*`**, against 25 that reach
Sentry. There are also **no** `process.on('uncaughtException'|'unhandledRejection')` handlers
in either entrypoint, and **no `Sentry.flush`** anywhere — so the two paths deliberately
wired to Sentry (`worker.ts:2551`, `:2501`) lose their event to `process.exit(1)`.

Sharpest instance: `db/mailbox-action-lock.ts:96-118` is the advisory-lock leak detector,
added _because_ the 2026-08-12 pooler incident hid inside an untested `catch {}`. Its own
comment reads _"This is the leak detector; it must be loud."_ It reports via `console.error`.

**Question:** _which channel does this failure land in, and who is subscribed to it?_

### C7 — Count the failure, return success

The dominant worker shape: a per-item `catch` increments a `*Failed` counter and the job
returns normally, so BullMQ records success and the D203/D225 retry and dead-letter policy
never engages.

**Question:** _what makes this loud at 100% failure instead of 1%?_ If the exit code is the
same either way, there is no answer.

**Live instances** — `autopilot-apply.worker.ts:445-461`, `brief-snapshot.worker.ts:288-300`,
`followup-check.worker.ts:186-198`. Worst: `autopilot-action.worker.ts:760-776` — a user
approves an Autopilot suggestion, the Gmail mutation fails deterministically, the match is
retried every sweep forever and never marked failed. No Activity row, no toast, no Sentry
event; the approved Archive simply never happens. The sibling at `:1240-1265` does it right.

### C8 — Sequence inversion around a failure boundary

A guard, safety net, or state cleanup ordered on the wrong side of the step that can fail.

**Question:** _if the next line throws, what is left behind — and does it commit?_

**Live instances**

- `auth/sessions.service.ts:131-151` — **security.** Refresh-token-reuse detection writes
  `is_revoked = true` and then `throw`s **inside the same `db.transaction` callback**. The
  throw triggers `ROLLBACK`, so the revoke is discarded and the replayed session stays live;
  the D155 defense is a no-op. The comment says _"Do it inside the SAME tx so the revoke is
  atomic with the detection"_ — exactly inverted. `rotate()` has **zero** test coverage.
- Prior recurrences: undo's safety net armed after the failing step (2026-08-10); triage
  cleared pending state before the re-entry guard (2026-08-12); `queue.add` inside a
  `db.transaction` publishing before commit.

### C9 — Designed 4xx with no route to recovery

`MISTAKES.md` records this three times (2026-07-26 ×3). Still open on the **read** side.

**Question:** for every 4xx the user can resolve — _what refetches after they resolve it?_

**Live instances**

- No `QueryCache.onError`, so `resetMailboxScopedCache` never runs for a failing read.
  `query-client.ts:36-38` justifies the omission by asserting _"the app shell renders the
  reconnect gate off `me`"_ — but `refetchOnWindowFocus: false` is the global default 20 lines
  below, and `use-me.ts:4-5` documents a focus refetch **it does not configure**. Nothing
  refreshes `me` after an out-of-band scope change.
- Consequence: disconnect the active mailbox in a second tab → `me` stays stale →
  `hasActiveMailbox` stays true → the always-mounted sync banner polls a dead mailbox every
  3s, rendering `null` on error so the storm is **invisible in the UI**.
- `brief-screen.tsx:968` shows _"We couldn't load your Brief. Try again in a moment."_ with a
  Retry that re-issues the identical 409 with the identical header.
- `apiRequest` (`client.ts:204`) has **no timeout**. If the API accepts the connection and
  never responds, every screen sits on its skeleton forever.

### C10 — `refetchInterval` reads `data`, not query state

A dedicated entry because it is mechanical, repeated, and trivially greppable.

`if (!data) return POLL_MS` treats _errored_ as _not loaded yet_. `retry` is correctly
suppressed; the interval re-issues anyway.

**Live instances** — `use-sync-status.ts:62-67` (3s, chrome-level, both consumers render
`null` on error), `use-action.ts:66-69` and `:229-232` (1s + `refetchIntervalInBackground`;
safe today only because all 17 consuming surfaces independently clear on `isError`),
`step-preset-pick.tsx:91` (2.5s, also loops on a legitimately-empty result, under copy
promising _"Your suggestions are still being prepared"_).

The correct pattern already exists at `use-activity.ts:129`.

### C11 — Boundary cast without a validator

67 Zod contracts exist in `packages/shared/src/contracts/`; only 7 files in `apps/web/src`
call `safeParse`/`parse`, against 95 typed `apiGet`/`apiPost` call sites.

**Tell:** a module imports a contract's **type** without its **schema**
(`use-sync-status.ts:25` is representative).

**Live instances** — `client.ts:252` / `server.ts:76` validate the envelope wrapper and
assert the entire payload; `activity.ts:197` Zod-parses the pagination meta and passes the
rows through untouched; `billing-catalog.ts:59` casts parsed env JSON on a money path
(a typo'd provider key parses cleanly and silently falls back to the manifest price);
`base-declutr-worker.ts:203` hands `job.data` to `processJob` with no schema hook, though
BullMQ payloads outlive deploys; `outbox-dispatcher.worker.ts:441` casts a `jsonb` read into
a discriminated union.

Two sub-rules worth stating separately:

- **`Record<FiniteUnion, V>` is an unchecked lookup and `noUncheckedIndexedAccess` does not
  cover it** (it only covers index signatures). `activity-screen.tsx:2139` indexes
  `VERB_DOT` with an unvalidated wire value — and `ActivityActionSchema`
  (`contracts/activity.ts:64`) is **module-private**, so the FE cannot validate against it
  even in principle.
- **Prefer `null` to a sentinel at a boundary.** `gmail-client.service.ts:290` coerces a
  missing `internalDate` to `'0'` → epoch-0 → the message counts as 56 years old in every
  age bucket (`actions.service.ts:300-303`), so it silently joins the "older than 1 year"
  set of a bulk archive or delete. The same file models the right answer for `sizeEstimate`
  two fields below.

### C12 — Scope-change reset that names only part of the reset set

`resetMailboxScopedCache` (`reset-mailbox-cache.ts:31`) resets the QueryClient only. The
triage Zustand store keeps `sessionDecidedCount`, `sessionMessagesMoved`, `expandedRowId`
and `pendingAction` (which carries a `rowId`) across every switch.

Worse, the scope can change **without the client doing anything**: disconnect clears
`preferences.activeMailboxId`, and `current-mailbox.guard.ts:116` then falls through to
`active[0]` — so a session-resolved read **succeeds against a different mailbox** instead of
409ing, and stale rows from mailbox A merge into unpartitioned keys under mailbox B. No guard
trips, because nothing failed.

**Question:** _what refreshes the client's copy when the server changes scope out of band?_
If the answer is "a 60s `staleTime` and nothing else", that is the finding.

---

## 3. The review checklist

Ten questions. Each maps to a class above and each has caught a real defect here.

1. **Where else does this shape live?** Enumerate the family structurally. (C1)
2. **For every number: population, window, freshness, unit — does the copy match?** (C2)
3. **Has this check ever gone red?** Prove it with a positive control. (C3)
4. **What does the client actually receive?** Run the value through the real transform. (C4)
5. **If this failed, what would tell us?** Name the channel and its subscriber. (C5, C6)
6. **What makes this loud at 100% failure, not 1%?** (C7)
7. **If the next line throws, what is left behind — and does it commit?** (C8)
8. **For every designed 4xx: what refetches after the user resolves it?** (C9, C10)
9. **Which line rejects a wrong shape at this boundary?** A `typeof` on one field is not
   validation of the others. (C11)
10. **What refreshes client state when the server changes it out of band?** (C12)

### Greps that pay for themselves

```bash
# C10 — poll predicates that ignore error state
rg -n "refetchInterval" --type ts -A3 apps/web/src | rg -n "!data|state\.data"

# C4 — thrown codes that never reach the wire
# (bundled short flags like -ohN break on some rg builds; spell them out)
rg --only-matching --no-filename --no-line-number "code: '[A-Z][A-Z_]{3,}'" apps/api/src \
   -g '!*.spec.ts' -g '!*.test.ts' -g '!**/__tests__/**' \
   | sed "s/code: '//;s/'//" | sort -u        # 76 today; compare against ERROR_CODES (42)

# C4 — hand-rolled envelopes (needs -U; the call spans lines)
rg -nU --multiline-dotall "new HttpException\(\s*\{\s*error:" apps/api/src --glob '!*.spec.ts'

# C6 — catches that only log
rg -n "catch" -A3 apps/api/src packages/workers/src | rg "console\.(error|warn)"

# C11 — type imported without its schema
rg -n "import type \{ \w+ \} from '@declutrmail/shared/contracts'" apps/web/src

# C5 — declared events with no emitter
rg --only-matching "^  \w+:" packages/shared/src/observability/events.ts \
   | tr -d ' :' | sort -u        # diff against the `track('…')` call sites

# NOTE: pass `-a/--text`. `triage-undo-tray.tsx` contains a U+0000 and is skipped as binary.
```

---

## 4. Recommended automation

Ranked by defects-prevented per hour of work.

1. **Contract test: every thrown `code` is registered.** Assert each `code:` literal in
   `apps/api/src` satisfies `isErrorCode`. Closes C4's 40 dead codes and stops regrowth —
   ADR-0014's original fix lacked exactly this. _(~1h)_
2. **Contract test: capture-site fields survive the scrubber.** Assert `fingerprint`, every
   tag key the filter sets, and every error-class name the app throws round-trip through
   `scrubSentryEvent`. Producer and consumer allowlists are declared in three files with no
   shared contract. _(~2h)_
3. **Fix the vendor watchdog to alert on `rate_limited`/`dropped`, not `accepted`.** One
   filter change; removes the blindfold in front of everything else. _(~15m)_
4. **Add `QueryCache.onError`** mirroring the existing `MutationCache` recovery, and make
   `refetchInterval` callbacks take query state. Closes C9 + C10 at the policy layer so a new
   consumer cannot reopen them. _(~2h)_
5. **Enable `recommendedTypeChecked`** for `apps/api` and `packages/workers` at minimum.
   _(~half a day incl. fallout)_
6. **Test: every `EventName` has ≥1 `track()` call site.** _(~30m)_
7. **Ship the three mailbox-lifecycle e2e specs** already scoped in `FOUNDER-FOLLOWUPS.md`
   and closed as "Done" without being written. The acceptance criterion is stated there:
   disabling the cache reset must make spec (b) fail. Findings under C9/C12 are all invisible
   to unit tests because each is an integration between a correct helper and a wrong consumer.

---

## 5. Findings by severity

Needs a founder decision before any code moves (CLAUDE.md §9 stop conditions):

| #   | Finding                                                                                           | Where                              |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Refresh-token-reuse revoke rolled back by its own `throw`; D155 defense is a no-op; untested      | `auth/sessions.service.ts:131-151` |
| 2   | 40 of 76 error codes stripped in transit; 5 `PROTECTED_SENDER` branches dead; 409 replays forever | `all-exceptions.filter.ts:243-259` |
| 3   | Every API 5xx collapses into one untitled Sentry issue (no fingerprint, no tags, no type)         | `sentry-scrubber.ts:491-535`       |
| 4   | Sentry quota watchdog greens when events start dropping                                           | `check-vendor-limits.mjs:380`      |

High — user-visible or destructive:

| #   | Finding                                                                                      | Where                                            |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 5   | Observe digest promises a 7-day figure computed over an all-time backlog                     | `autopilot.read-service.ts:401`                  |
| 6   | Approved Autopilot action retried forever, never marked failed, never reported               | `autopilot-action.worker.ts:760-776`             |
| 7   | Sync gate renders "Done — your inbox is ready" while still syncing (D109, §10)               | `sync-gate.tsx:39,55-57`                         |
| 8   | Read-side 409 has no recovery; stale `me` + 3s invisible poll storm                          | `query-client.ts:25-63`, `use-sync-status.ts:62` |
| 9   | Missing Gmail `internalDate` → epoch-0 → message joins every "older than" bulk-action bucket | `gmail-client.service.ts:290`                    |
| 10  | Resend webhook drops a bounce permanently if suppression fails after the dedup commit        | `resend-webhook.controller.ts:152-163`           |
| 11  | `/onboarding?mailbox=<unowned>` → permanent "Setting up — 0%", no error state, no exit       | `onboarding/page.tsx:82,346-351`                 |
| 12  | Queue-down / not-implemented / billing-dark thrown as 5xx: honest copy erased + Sentry paged | `all-exceptions.filter.ts:109-159`               |

Medium and below — the remaining ~25 findings (cross-tab wrong-mailbox reads, `noisePreventedPerMonth`
join fan-out, brief narrative units, quiet-hours over-promise, timeseries gap compression,
`updated_at` as a domain timestamp, deletion `effective_at` freeze, lock-pool overcommit,
counter-reconciliation lost update, `/admin/security` wrongly gated, missing `assertUuid`,
data-export 401 dead end, 11 dead PostHog events) are documented inline under their classes above.

---

## 6. What is already good, and should be protected

Findings are the point of a review, so it is worth recording what the sweeps found solid:

- **Null-vs-zero discipline post-F009 is exemplary** — `computeReadRate` returning `null` at
  `volume === 0`, `readRateLifetime`, `laterCount`. The bar to hold: a new `?? 0` on a
  _count_ is fine; on a _rate, ratio, or capability_ it is the F009 shape.
- **77 empty-or-comment-only catch blocks, and the sweep judged none of them material** —
  every one is a documented best-effort path.
- **Error narrowing is essentially perfect** — ~25 `catch` sites all use
  `err instanceof Error ? … : String(err)`; zero `.message` on an unnarrowed `unknown`.
- **`outbox-consumer-router.ts:241-244`** pairs a `never` binding with a _throwing runtime_
  `default` — the correct shape when the discriminant comes from storage.
- **`retryTransientOnly`** is correct and no hook re-arms 4xx retries; all 20 local overrides
  are `retry: false` or stricter.
- **`isUserScopedRoute`** is exact-match, not a prefix — the 2026-07-09 regression is
  genuinely closed.
- **`unreadInboxCount`'s comment** (`senders.read-service.ts:318-325`) — _"MUST stay
  row-for-row equal to `senderInboxActionWhere` … Change one, change both"_ — is the pattern
  C2 wants generalised to every forward-looking count.
- **The privacy posture holds.** No sweep found a body, attachment, or non-allowlisted header
  crossing a boundary; the D7/D228 scrubbers are thorough. The Sentry findings above are
  cases where privacy scrubbing was applied _correctly_ and grouping was lost as a side
  effect — the fix is to preserve a grouping key, never to loosen the scrub.
