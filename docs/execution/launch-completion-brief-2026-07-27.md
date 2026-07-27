# DeclutrMail — launch completion brief

**Cut:** 2026-07-27 · **main:** `4b044a1d` · Hand this whole file to the agent.

You are finishing DeclutrMail for production launch. Read `CLAUDE.md` first — it
is binding, especially §2 (guardrails), §8 (definition of done + smoke), §9
(stop conditions) and §10 (what not to do). This brief tells you WHAT is left.
CLAUDE.md tells you HOW.

Use parallel agents. Each work item below is scoped to be independently
ownable. Serialize anything that touches a shared file or a migration.

---

## 0. Standing rules for this run

- **Never fabricate a value.** Query it, or label it a placeholder.
- **Two-sided tests.** A flag only ever observed set is not a verified flag.
  Every new assertion needs its negative case, and you must prove a new test
  fails without its fix before you claim it passes with it.
- **Smoke before "done".** Green CI is necessary, never sufficient. §8's table
  says what smoke each change type needs. Authed flows use the D206 dev
  test-login; force edge states reversibly via SQL and **restore afterwards**,
  printing the restore verification.
- **Real mailbox smokes need permission.** The founder's workspace has two live
  Gmail accounts. Archive is reversible via undo and is the default smoke verb.
  **Never** send a one-click unsubscribe (D58, irreversible) or empty Trash as a
  smoke. Use a `mailto` or `none` sender when you must exercise an unsubscribe
  path — nothing is auto-sent.
- **Fix the predicate, not the instance.** The dominant defect class in this
  repo is a surface asserting what it does not know. Its sibling is fixing the
  one call site you were shown instead of the rule behind it. When you change
  what an error, flag, or count MEANS, enumerate every consumer of that meaning.
- **An HTTP status says how it failed, never why.** Branch user-facing copy and
  recovery on the D202 envelope's `error.code` (`apiErrorCode()` in
  `apps/web/src/lib/api/client.ts`), and check which guards in front of the
  route share that status. Note that some hooks translate `ApiError` into
  domain errors (`SyncNowError`) — follow the code, not the class.
- **Stop conditions are real.** §9 lists changes you must NOT decide alone
  (OAuth scopes, token crypto, prod migrations, billing webhooks, account
  deletion, retention, destructive Gmail without preview+undo, webhook auth,
  security headers). Flag and wait.

---

## 1. Count divergences — 14 open

Source of truth: **`docs/execution/action-surface-findings-2026-07-26.md` §5**,
which has the exact file:line and mechanism for each. Read it. Below is
priority and framing only.

The recurring shape: **a count filtered one way (time window, `is_outbound`,
protection, page cap, label set, time basis) rendered next to an action
resolved another way.**

### Tier 1 — can move mail the user did not agree to. Do these first.

**5.3 — confirm enabled on a stale cached preview.**
`useCompositePreview` (`apps/web/src/lib/api/use-action.ts:156`) sets
`staleTime: 0` but inherits TanStack's **default 5-minute `gcTime`** — the
client factory (`lib/query-client.ts`) sets only `staleTime`. So reopening the
confirm modal on the same sender within 5 minutes gets a **cache hit**, which
makes `livePreviewReady` true in `confirm-action-modal.tsx`, which **enables
confirm on counts that may be minutes old**. ⌘⏎ before the refetch lands
executes against the live set. This is a D226 violation: the mandatory preview
is present but is not describing the mutation that runs.
_Shape of the fix:_ the preview must not be confirmable from cache. `gcTime: 0`
is the blunt version; better is gating `livePreviewReady` on
`isFetching === false && isStale === false` so a background refetch holds the
button. Pin it with a test that reopens within the window and asserts confirm
is disabled until the refetch resolves.

**5.5 — the preview and the mutation count different mail.**
`previewComposite` (`apps/api/src/actions/actions.service.ts:250,:282`) is the
**only** count in the entire pipeline that filters `is_outbound = false`.
`countSenderInboxWithWindow` (`:972`), which produces the count actually
enqueued, does not. Neither does the bulk preview. Neither does the worker. So
self-sent / self-CC mail (in both `SENT` and `INBOX`) is **under-counted in the
preview and over-executed by the worker**.
Compounding it, `confirm-action-modal.tsx` gates its "nothing to act on" branch
off the _unfiltered_ `archivePreview.inboxCount` while the headline renders the
_filtered_ `compositeCount` — so the modal can read **"0 emails currently
match" with confirm enabled, then move 1**.
_Shape of the fix:_ pick ONE definition of "mail from this sender in the inbox"
and use it in preview, enqueue count, bulk preview and worker. Decide
deliberately whether outbound belongs in it (recommendation: exclude it
everywhere — a user does not think of their own sent mail as "from" the
sender), then make the other three match. Add a contract test that asserts all
four agree for a seeded sender with self-sent mail.

### Tier 2 — a destructive button sitting next to a wrong number.

- **5.1** Autopilot Observe banner — `autopilot.read-service.ts:382`; the 7-day
  filter constrains match rows, not messages; dismissed matches contribute; the
  stale-evidence guard is applied to `pendingTotal` but not `senders7d`/`messages7d`.
- **5.2** Screener heading + `screener_shown` analytics — `screener-screen.tsx:392`
  falls back to `state.rows.length` (the server page size) when the count query
  is in flight or errored. A 3,000-sender backlog renders "50 new senders
  waiting" and fires `pending_count: 50`.
- **5.4** Triage domain-batch card — `domain-batch.ts:76-96` groups without
  filtering protection while `domain-batch-card.tsx:48` counts only unprotected;
  with ≥2 protected in the run the card offers "1 senders … decide together?",
  the bulk preview is disabled at length 1, and the sheet sits at "Counting the
  inbox…" with confirm permanently disabled.

### Tier 3 — receipts and headings that contradict themselves.

5.6 (`requestedCount` stamped at enqueue vs `affectedCount` at execution →
"3 of 47 changed" on a clean success), 5.7 (bulk denominator sums siblings →
permanent `'partial'` reading "N of 2N"), 5.8 (messages-vs-actions unit mismatch
in the Autopilot activate modal), 5.9 (`lastRunActions` writes candidates, not
the `onConflictDoNothing` insert count), 5.10 (page-capped "N waiting" with no
`+` above an uncapped "Approve all"), 5.11 (lifetime `total_received` beside an
INBOX-only preview), 5.13 (selection bar counts senders, modal counts emails),
5.14 (by-design window mismatch that reads as a bug), 5.15 (`monthlyVolume ?? 0`
coalescing a nullable to a factual 0 — latent, PLAUSIBLE not confirmed).

> **Caveat you must respect:** 5.5–5.15 were confirmed _in code_ by an
> investigating agent and **never independently re-verified, never repro'd
> live**. Treat them as leads. Re-verify each against primary sources before
> changing anything, and say so if one turns out to be wrong.

---

## 2. A3 — pricing and tiering

**Plan:** `docs/execution/a3-pricing-rework-plan.md` (rewritten 2026-07-26,
opens with a SUPERSEDES block). Decisions are locked; nothing here is open for
re-litigation. **Zero code exists.**

### PR A — the config file plus the ladder

The founder's constraint, verbatim: _"We don't want to sweep/touch lot of files
(65 in this case) when pricing/feature needs to move around as much as
possible. It should be simple."_

Build `pricing.config.ts` as the single edit point, with `SELECTOR_TIERS`,
`SELECTOR_CAPS` and `COUNTS_AS_CLEANUP`. Success criterion: **moving one feature
between tiers, or changing one price, is a one-file diff.** The plan documents
four leaks that currently prevent that; close all four.

Ladder (prices unchanged — deliberately, the at-market rung already exists and
this needs zero provider work): Plus $9/$90 · Pro $19/$190 + 3 inboxes ·
Founding $129. Free gets **50 cleanup actions per month**, resetting on the
user's own **signup anniversary** (paid subscriptions renew on the anniversary;
two different reset clocks would be indefensible). One unit = one sender
decided, so a 50-sender bulk selection is 50 units. Keep is free. Multi-sender
selection moves to Free. The Later apparatus moves to Free.

**Step 8 is mandatory and is a real bug, not a hardening nicety.**
`actions.service.ts:920` takes its `FOR UPDATE` on the **default root
executor**, so the lock is statement-scoped, not transaction-scoped — concurrent
requests can each pass the quota check. It is dormant today only because
`limit === null` early-returns for unlimited tiers. **Making Free metered wakes
it.** Fix the lock in the same PR that introduces the meter, and prove it with a
concurrent-request test.

### PR B — the provisioner money bug

`apps/api/scripts/provision-billing-catalog.ts:154` (Paddle) and `:209`
(Razorpay) skip on matching SKU **without comparing the amount**. A price change
would silently not apply — you would edit the manifest, run the provisioner,
see success, and ship the old price. Compare amount and currency; fail loudly on
a mismatch rather than skipping.

**Billing is dark-launched behind three kill switches** (`BILLING_ENABLED` +
webhook secrets + null catalog ids). Nobody can upgrade until the founder runs
the go-live sequence in
`docs/execution/billing-go-live-runbook-2026-07-17.md` §9. Billing webhooks are
a §9 stop condition — do not touch live billing state.

---

## 3. Landed this session (do not redo)

Merged to main as #393, #394, #395:

- Single-sender Archive silently discarded the time window (`.strict()` dropped
  `olderThanDays`; preview said 121, mutation archived 335). Legacy
  `POST /api/actions/archive` deleted; everything rides the composite endpoint.
- Delete restored to Sender Detail and the table row detail (both read
  `VERB_REGISTRY` now).
- Availability split from recommendation: `canX` vs `canBulkX`. Protected
  constrains bulk and automatic actions only (D245), never an explicit click.
- The Protected "act anyway" acknowledgement + `override` across Senders,
  Sender Detail, Triage and Screener — including the Screener's read model,
  which previously carried no protection fact at all.
- The unsubscribe backlog secondary now carries the override (it was a partial
  execution with an irreversible first half).
- Conflict handling reads `error.code`, not the bare 409, and mailbox-scope
  conflicts route to their recovery via one global `MutationCache.onError`.
- Later's "also act on past emails" chip row removed (Unsubscribe only).

Four `MISTAKES.md` entries from this session share one shape: **fixing the
instance instead of the predicate.** That is past §11's recurrence trigger and
is a CLAUDE.md §2 guardrail candidate — but distillation is founder-only, so
raise it, do not do it.

---

## 4. Founder-only — you cannot close these

`FOUNDER-FOLLOWUPS.md` has **129 open entries**. Read the Open section; do not
attempt these, and do not report the product as launch-ready while they stand.
The operational gates from the 2026-07-22 launch audit (CONDITIONAL GO — app
code was judged launch-grade, the gates are operational) include: bouncing
`support@`/`privacy@`, zero database backups, zero outage detection,
unprotected `main`, unrecorded CASA assessment, and the undecided billing
middle. There is also a live entry for suspended production Redis.

If your work depends on one of these, say so and stop at that boundary.

---

## 5. Definition of done for this run

Per CLAUDE.md §8, plus:

- `pnpm typecheck` (8/8), `pnpm lint` (0 errors), all suites green.
  `packages/db` uses testcontainers and fails under parallel `pnpm test`
  contention — verify it alone before calling it a regression.
- Every PR body carries `Closes D###`. Branches follow §6
  (`<type>/d<NNN>-<kebab>`, zero-padded). Commit subjects carry `(D###)` —
  commitlint enforces it. Never `--no-verify`.
- Each PR states its smoke explicitly, including what you restored afterwards.
- If a fix turns out to be wrong or a listed finding does not reproduce, say so
  plainly and skip it. Do not manufacture a change to close a line item.
