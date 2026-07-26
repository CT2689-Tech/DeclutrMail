# Handoff — 2026-07-26 · infra hardening, CI path filter, A2 launch blocker

**Branch:** `main` @ `7fe71b74` · **Merged today:** 10 PRs (#380–#385, #387–#389, #391)
**Production:** deployed and healthy — `/api/readyz` → `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`

---

## The one idea that explains today

Every defect fixed today was the same shape: **a surface asserting something it
had no basis to know.**

- `infra-snapshot` reported `[]` for Secret Manager — a list the CI service
  account had never been permitted to read. A permanently clean diff.
- The vendor watchdog printed `574%` of an allowance next to `net spend $0.00`
  — the alarm and its refutation in one table cell.
- The Vercel row said `transient:` on its **eighth consecutive** identical
  failure, across three days of unmonitored spend.
- The launch audit claimed A2/B3/B4 were `✅ Done` while only an uncommitted
  working tree could back it.

It also nearly recurred _inside_ the fixes, twice. Teaching the `Test` aggregate
to accept `skipped` would have made a green check mean "ran nothing." And a path
filter only ever observed returning `true` is not a verified filter. Both got
two-sided assertions instead — see below.

This is now 4+ logged instances. **CLAUDE.md §11 distillation triggers #1
(recurrence ≥3) and #4 (cross-cutting) are both met.** A candidate §2 guardrail
is written up in `MISTAKES.md` for the founder's call, since agents do not edit
CLAUDE.md:

> _A monitoring surface must distinguish "measured and fine" from "not
> measurable here", and must grade in the units of the harm._

---

## What merged

| PR   | What                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| #380 | `infra-snapshot.sh` — 9-day failure streak was **4 stacked bugs**, not one    |
| #381 | Snapshots publish to a dedicated `infra-snapshots` branch (main is protected) |
| #382 | Actions watchdog keys on **spend**, not a ratio that cannot cost money        |
| #383 | Vendor timeouts **retried** instead of labelled `transient`                   |
| #384 | An unreadable vendor **fails the run** instead of passing quietly             |
| #385 | CI skips expensive shards when no matching path changed                       |
| #387 | Records why Actions minutes are `$0` — and what reversing that costs          |
| #388 | **A2 launch blocker** + B3 + B4 (see below)                                   |
| #389 | Launch audit landed + status-updated                                          |
| #391 | A3 pricing decision + execution plan                                          |

### #388 in detail — the launch blocker

`rule_match_log` survived the initial-sync rebuild. On the founder's real mailbox
that left **6,244 unexecuted matches of which only 234 were current** — 32 sender
keys that existed nowhere, 5,978 rows the rebuild had itself re-created.

The approved-but-unapplied half was the dangerous one: already queued for
`AutopilotActionWorker`, which would have **mutated Gmail on deleted evidence**.
Active-mode matches are written already-approved, so this was not a narrow race.

Three layers landed: the rebuild deletes unexecuted matches in-transaction
(preserving dismissed and executed rows, and skipping any whose execution is
already claimed via `action_jobs`); a per-mailbox `pg_advisory_xact_lock` spans
the teardown so the apply worker's fingerprint re-check stops being
check-then-act; and `senders.created_at <= matched_at` is required by the read
layer and the action worker as defence in depth.

Verified live, in **both** directions — a guard only ever seen returning 0 is not
verified:

|                                       | API rows offered |
| ------------------------------------- | ---------------- |
| mailbox with 6,010 pending, all stale | **0**            |
| mailbox with 10 pending, all current  | **10**           |

And against a real worker + real Gmail (1,142 messages, 240 API calls):

|                                     | before | after                |
| ----------------------------------- | ------ | -------------------- |
| unexecuted matches, rebuilt mailbox | 10     | **0** (deleted)      |
| executed matches, rebuilt mailbox   | 65     | **65** (preserved)   |
| other mailbox `cc64c10f`            | 6011   | **6011** (untouched) |

---

## Things a next session should know

**`main` is protected and it works.** A bot push was correctly rejected with
`GH006`. Snapshots now go to the `infra-snapshots` branch. Do not add a bypass
token to CI to work around this.

**CI is path-filtered now (#385).** `dorny/paths-filter@v3` in a `changes` job —
_not_ an `on: paths` trigger, deliberately. Filtering at the trigger leaves
required checks pending forever and blocks every PR; filtering per-job reports
`skipped`, which GitHub counts as satisfied. Verified: a docs-only PR skips all
five test shards plus the a11y smoke and still merges CLEAN.

Every filter includes an `infra` anchor (lockfile, manifests, tsconfig, `.nvmrc`,
`packages/config`, `ci.yml`), so a dependency bump re-runs everything. `push:
main` always runs the full suite.

**Local test suites are not enough.** Playwright is not in `pnpm test`. #388's B3
change broke 5 a11y assertions and only CI caught it. Run the a11y expectation in
mind when touching shell/topbar chrome.

**Watch for branch switches under you.** `gh pr close --delete-branch` silently
switches the checkout to `main`. This invalidated a full smoke run mid-session and
briefly made a live guard look like dead code. Check `git branch --show-current`
before trusting a smoke.

**`InitialSyncWorker` short-circuits on `readiness_status = 'ready'`.** To force a
real rebuild for a smoke, set `provider_sync_state.readiness_status = 'queued'`
first (what `markQueued` does); the worker's own `markReady` restores it.

---

## Open work, in priority order

### 1. A3 — pricing rework · **decided, not implemented**

Founder decided on 2026-07-26: Free = **50 sender decisions/month** + Triage
included; **Plus removed**; Pro → **$9/mo · $90/yr** with 3 inboxes; Founding Pro
$129/yr kept as a supporter offer.

Full sequencing in **`docs/execution/a3-pricing-rework-plan.md`**. Read it before
starting — it is 65 files across four packages plus a `workspace_tier` enum
migration, and two findings there materially change the work:

- The Free quota is a **live `COUNT` over `action_jobs`**, so "50/month" is a date
  predicate — no stored counter, no reset job, no migration.
- Pro's catalog ids should be **nulled in the same commit** that drops its price;
  every price surface clamps on `razorpayPlanId !== null`, which makes the
  provider step a type-enforced precondition instead of something to remember.

**Founder step inside it:** Plus's existing live $9/$90 SKUs must **not** be
reused for Pro — they are labelled "Plus" at the provider and that lands on
customer invoices permanently. Re-provision via the `Provision billing catalog`
workflow. Free to do now only because billing is dark with zero subscribers.

### 2. A6 — billing card asserts two plans at once

The last launch blocker that is not the founder's call. Not started.

### 3. Sentry alert rules — unverified

547 accepted errors/24h are ingesting (55% of the 1,000/day warn threshold), but
**nothing confirms an alert rule fires on them**. Same shape as the `/healthz`
blind spot that hid a 46-day Redis outage.

The Sentry MCP is registered and authenticated (`sentry: ✔ Connected`, 9 tools)
but a running session binds MCP tools at start, so it needs a **fresh session** to
become usable. The claude.ai-side Sentry connector is now `hidden — same URL`.

### 4. Smaller

- **`IMPLEMENTATION-LOG.md` is stale for today's work** — D19/D38/D158 still show
  ⬜/🔵 despite merged PRs. Check whether the auto-update action ran.
- **B7** — no DB uniqueness on live subscriptions per workspace. Live evidence
  found today: the dev workspace has **two** `subscriptions` rows. Both paused, so
  nothing is double-charging, but the partial unique index is still unwritten.
- **Uncommitted strays** in the working tree, deliberately left out of today's
  PRs: `.env.example` (Paddle MCP credential docs), `AGENTS.md`, `docs/brand/`,
  `docs/handoffs/2026-07-21-declutrmail-ai-retirement.md`. Decide keep or discard.
- **Shared-SA risk** — worker shares the API service account (2 preflight WARNs).
  Accepted and documented as a launch risk; remediation is post-launch.

---

## Launch readiness

Blockers closed today: **A1, A2, A4, A5**, plus **B3, B4, B8, B9** and CASA
(approved 21 Apr 2026, recert due Apr 2027).

**Remaining: A3** (decided, needs implementing) and **A6**. Every other ❌ in the
audit's §7 checklist is now green.
