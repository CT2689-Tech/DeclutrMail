# Learnings — DeclutrMail

Append-only log of what worked, what surprised us, and rules to promote
into CLAUDE.md when patterns emerge.

See CLAUDE.md §11 for distillation criteria (recurrence ≥3, severity,
architectural, or cross-cutting triggers promotion).

## Entry format

```markdown
## YYYY-MM-DD — Short title
**Context:** what was being done
**Finding:** what was observed
**Rule (provisional):** what to do next time
**Distillation trigger:** "promote to CLAUDE.md §X if pattern recurs ≥3 times"
```

---

<!-- Entries go below. Newest at the top. -->

## 2026-08-14 — The root `not-found.tsx` un-statics the entire app
**Context:** Implementing Option A′ (prerender the public site). The approved spec named two dynamic reads to remove, both in `apps/web/src/app/layout.tsx`: the CSP nonce and the D117 geo header. Both were removed, the build was re-run — and `prerender-manifest.json` still listed **8 routes, all metadata assets**, exactly as before. Zero HTML files. The change appeared to have done nothing.
**Finding:** A third read was doing it: `cookies()` in `app/not-found.tsx`, reading the session cookie to pick the D140 audience-aware CTAs. Next folds the ROOT not-found into **every route's** render tree (it is the boundary any segment's `notFound()` lands in), so one per-request read there propagates to all 34 public pages — including pages that have no session concept at all. Removing it flipped 38 routes to static in a single build. Nothing in the toolchain says this: types pass, tests pass, every page renders correctly, and `next build`'s `○ ● ƒ` column is independently untrustworthy here — it marked `/blog/[slug]` and `/vs/[competitor]` as `●` (SSG) and printed "Generating static pages (71/71)" while emitting zero HTML. The only honest signal is `prerender-manifest.json`.
**Rule (provisional):** When auditing what forces dynamic rendering, the shared-node set is `layout.tsx` **plus `not-found.tsx`, `error.tsx` and `global-error.tsx`** — not just layouts. And assert prerendering against `.next/prerender-manifest.json`, never the route table (`scripts/check-prerendered-routes.mjs` does this in CI). Corollary: those root-level surfaces sit outside every route group, so anything a group's layout provides — the theme script here — has to be provided for them separately.
**Distillation trigger:** promote to CLAUDE.md §8 if a second silent prerender regression ships, or if a third root-level surface is found missing something its route-group siblings get.

## 2026-08-14 — Zod v4's JIT trips CSP on every public page
**Context:** Browser-verifying the A′ CSP split with `securitypolicyviolation` listeners.
**Finding:** Every page that loads the Zod chunk logs one `script-src blocked eval`, from `$ZodObjectJIT` calling `new Function` to compile a fast object validator. It is **pre-existing and unrelated to A′** — prod `script-src` has never carried `'unsafe-eval'` (`env.isDev && 'unsafe-eval'`), so it was blocked identically under the old nonce policy. Zod v4 catches the refusal and falls back to its interpreted parser, so nothing breaks; the cost is a console violation on public pages and a slower parse path. Separately: `page.evaluate()` in Playwright is itself subject to `script-src`, so a naive harness reports its OWN eval as an app violation — the first run blamed `/triage` for a violation that was the test's. Reading state back through DOM attributes instead of `evaluate()` removed the false positive.
**Rule (provisional):** When counting CSP violations in a browser harness, read results through attributes/title rather than `page.evaluate()`, or the harness manufactures the violation class it is measuring. And before filing a CSP violation as a regression, check whether the directive it names was ever satisfied by the previous policy.
**Distillation trigger:** promote if a third-party library's CSP interaction is misdiagnosed as a regression a second time.

## 2026-08-13 — A false comment on correct code cost a whole design round
**Context:** The D253 refund-lockout design. A fourth adversarial review raised a blocking contradiction — is a settled refund a one-way door, or can an approved refund be reversed? — and the design grew a support path to handle the reversal.
**Finding:** The blocking finding rested on a **comment**, not on behaviour. `paddle.adapter.ts` justified `UNDONE_STATUSES = {rejected, reversed}` by describing a bug where "an approved-then-reversed refund counted as neither settled nor refuted, so its verdict stood forever" — a state Paddle's documentation says cannot occur: `reversed` is set only when a `chargeback_reversal` or `credit_reversal` adjustment is created, and a refund goes `pending_approval` → `approved` | `rejected`, both terminal. The **code** was fine; the set is a harmless superset, since a refund can only ever reach `rejected` and a chargeback only `reversed`. Only the explanation was false — and it was load-bearing. A reviewer read it as evidence of a real reversed-refund path, escalated it as blocking, and the design spent a round specifying machinery for a case that cannot happen. Deleting that machinery required reading the provider's docs, not the code.
**Rule (provisional):** A comment explaining WHY a defensive branch exists is an input to future reasoning, not decoration — a wrong one manufactures work indefinitely. When a review finding rests on a comment rather than on observed behaviour or a cited source, verify the claim at its source before designing for it; and when the comment turns out to be wrong, correct it in the same change even though nothing executes differently.
**Distillation trigger:** promote to CLAUDE.md §1.3 if a third design or review round is driven by a false explanatory comment rather than by code.

## 2026-08-13 — A running dev server smoked the previous `next.config.ts`
**Context:** Verifying the retargeted V1 redirects (`/compare/unroll-me-vs-declutrmail` → `/vs/unroll-me`, `/guides/gmail-storage-full` → `/how-to/gmail-storage-full`) with host-spoofed curls against the dev server already listening on :3000.
**Finding:** Every redirect returned 301 to its OLD destination. The server was healthy, the route pages were live (hot-reloaded), and the tests were green — but `next dev` reads `redirects()` once at boot, so a config edit is invisible until restart. The smoke had passed the page changes and silently failed the config change, which is the worse half: a stale redirect map cannot be caught by any unit test, because the unit test asserts the map, not the server. A fresh server on another port returned the correct targets immediately.
**Rule (provisional):** A smoke that touches `next.config.ts` (redirects, headers, rewrites) MUST run against a server started AFTER the edit — hot reload covers `app/**` and not the config. Same rule as the G2 "foreign process served the smoke" class, one layer down: the process is yours, its configuration is not.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table (a `next.config.ts` row) if a second config-layer change is smoked against a stale process.

## 2026-08-13 — A freshness date is per artifact or it is a fiction
**Context:** Adding `/vs/unroll-me`, whose sources were read on 2026-08-13, to a comparison set carrying one global `COMPARISON_VERIFIED_ISO = '2026-07-11'` — the constant that feeds both the visible "Last verified" stamp and the WebPage `dateModified`.
**Finding:** Neither option with one constant is honest. Leaving it at July stamps a page verified today with a date nobody verified it on; bumping it to August claims six pages were re-read when they were not — under a badge that reads "Official primary sources only". Splitting it (`verifiedIso` per comparison, hub shows the oldest) cost about ten lines and made the dishonest state unrepresentable: you cannot bump a page's date without editing that page. The same shape had already appeared earlier in this pass, when article `publishedAt` / `updatedAt` had to come from `git blame` per article rather than "today for all of them".
**Rule (provisional):** A public freshness claim belongs to the artifact it describes, never to the batch. When several artifacts share one date field, the aggregate surface shows the OLDEST of them (a floor is a claim you can keep) and each detail surface shows its own.
**Distillation trigger:** promote to CLAUDE.md §2.6 if a third public-facing date claim is found sharing one constant across independently-verified artifacts.

## 2026-08-13 — An accessible-name assertion built from content is a pattern, not a literal
**Context:** A new how-to titled "Gmail storage full? How to free up space" failed the hub test that asserts a link per article, via `getByRole('link', { name: new RegExp(article.title) })`.
**Finding:** The title was being compiled as a regex, so `?` made the preceding character optional and the pattern stopped matching its own subject. The two existing answer titles ending in `?` had been quietly weakened the same way for weeks — passing, because a suffixed `?` only loosens the tail. The failure was luck: mid-string punctuation broke it loudly, tail punctuation never would have.
**Rule (provisional):** Escape any content string used to build a matcher (`text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`), or pass the literal. A matcher derived from the data under test must assert the data, not a dialect of it.
**Distillation trigger:** promote to CLAUDE.md §8 DoD if a third unescaped content-derived matcher is found.

## 2026-08-08 — The composite score was a real quantity in disguise
**Context:** The `protect_important` brief asked to rank weakly-protected senders by "how much UNREAD mail the protection is shielding (`volume x unread%`)", with two worked examples: God of Prompt (166 emails, 13% read) and GetYourGuide (34, 3%).
**Finding:** `volume × unread%` = `volume × (unread / volume)` = **unread**. The "composite score" is algebraically just the unread message count — 166 × 0.87 ≈ 145 and 34 × 0.97 ≈ 33, which are exactly those senders' unread counts in the DB. Implementing it as a weighted score would have produced identical ordering while being unexplainable to a user and untestable against a real number; implementing it as "unread inbox mail" made the ranking key a fact the row can SAY ("shielding 145 unread") and the ordering self-evident. The one substantive choice left was the denominator — lifetime indexed vs currently-in-inbox — resolved to inbox-only, because that is the set a cleanup verb would actually move, so a sender whose whole history is already archived correctly ranks as shielding nothing.
**Rule (provisional):** Before implementing a ranking formula from a brief, simplify it algebraically. If it reduces to a single quantity the product already stores, rank on that quantity and name it in the UI — a score the user cannot verify is a score nobody can debug.
**Distillation trigger:** promote to CLAUDE.md §1.2 if a second ranking/scoring spec turns out to be a disguised single quantity.

## 2026-08-08 — Two acts, one screen: separating them was cheaper than bundling them
**Context:** Acting on a Protected sender leaves the protection intact, so the action feels finished while every future bulk and Autopilot run keeps skipping the sender. The obvious fix is to bundle protection removal into the mail action and declare it in the preview.
**Finding:** The bundle is blocked by the type system, not by taste. `undo_action_kind` is `archive | unsubscribe | later | apply-rule | delete` — there is no protection kind, so an undo restores the mail and **structurally cannot** restore the shield; the user would undo, watch their mail return, and never learn the protection did not. D245 compounds it: a manual Unprotect is a STICKY override that stops auto-protection re-applying, so a bundled removal forges a user decision. Keeping the acts separate — the verb decides what happens to mail, a distinct control decides the safety state — cost one shared component and made the preview copy the whole fix.
**Rule (provisional):** When tempted to bundle a second state change into an existing action, check the UNDO record first. If the undo vocabulary cannot express the second change, the bundle is unsafe regardless of how well the preview describes it — surface the consequence instead of acting on it.
**Distillation trigger:** promote to CLAUDE.md §2.3 (action lifecycle) if a second surface proposes bundling a non-undoable state change into a D226 action.

## 2026-07-31 — A local verdict the provider cannot know needs a convergence loop, not a projector branch
**Context:** A refund/chargeback ends entitlement locally, but Paddle records the adjustment against a *transaction* and keeps renewing the *subscription* beside it. We had to make the provider stop billing.
**Finding:** The obvious home — `BillingWebhookService`, which already handles `adjustment.created` — cannot do it: the class holds no provider adapters by construction (constructor takes `db` and `catalog` only), and that is deliberate, since an outbound call inside a webhook transaction would be re-driven by the provider's own delivery retries. The shape that fits is a **convergence loop** in the periodic reconciliation sweep: select rows whose local state disagrees with the provider, act, and let the next run see the agreement and do nothing. It is idempotent for free (once Paddle reports the scheduled cancel, the predicate stops matching), retried for free (the sweep re-runs), and costs at most one sweep interval of latency.
**Rule (provisional):** When local truth must reach an external system, prefer a periodic converge-on-disagreement pass over an inline call in the event handler — unless the latency genuinely matters. Write the predicate as "states that disagree", never as "things to do", so the loop is self-terminating and needs no queue, no outbox, and no dedup table.
**Distillation trigger:** promote to CLAUDE.md §2 if a third outbound-state-sync case appears (Gmail label writes and Razorpay are the plausible next two).

## 2026-07-31 — A rejected design can become correct when a later migration removes its objection
**Context:** Making `cancel_at_period_end` sticky under a refund verdict. A 2026-07-20 FOUNDER-FOLLOWUPS entry had explicitly rejected exactly that: *"a sticky flag can never be cleared and live subscriptions would show 'cancellation scheduled' forever"*.
**Finding:** The objection was sound **for the schema at the time**. It rested on there being no way to tell a user cancel (undoable — so stickiness traps them) from a refund verdict (terminal). Migration 0051 added `cancel_source`, which supplies exactly that distinction, and the rejection quietly stopped applying. Nothing announced it: the followup still read as a standing prohibition. I only caught it because I grepped the file for prior art before writing the PR body.
**Rule (provisional):** When a design contradicts a recorded rejection, quote the rejection and state which of its premises no longer holds — in the PR body, not just in your head. If none has changed, the rejection stands. A rejected design is rejected *given* facts, and this codebase changes facts every week.
**Distillation trigger:** promote to CLAUDE.md §3 (source-of-truth precedence) if a second stale-rejection case appears — §3 currently covers conflicts between live sources, not superseded ones.

## 2026-07-28 — "D or ADR?" is answered by who asks later, not by when it was decided
**Context:** Two pieces of work needed a home in the decision registries: the senders wire-model rebuild (already shipped) and bulk unsubscribe (about to be built). I proposed a D-number for each, purely because "next free number" is the local pattern. The founder pushed back and asked what I would do ignoring the existing D's.
**Finding:** CLAUDE.md §11 splits the registries by *timing* — "D-decisions: product/architecture decisions made during **planning**; ADRs: technical decisions made during **implementation**." That split has a hole: a **product** decision made during **implementation** matches neither clause, and both of these did. Timing turns out to be the wrong axis anyway, because the two artifacts are consumed differently: `IMPLEMENTATION-LOG.md` tracks D-rows for build status and does not track ADRs at all. So the question a registry choice actually answers is "will someone ask whether this is built?"
**Rule (provisional):** **A D-number is something you will ask "is it built yet?" about. An ADR is a rule that constrains how code gets written.** Orthogonal to when it was decided, and it has no gap. Applied here: the wire model is already shipped and its lasting value is the constraint (rows are the server shape, extended by spread, never re-assembled) → ADR-0029, no D. Bulk unsubscribe is unbuilt and will be asked about → D248. Two candidates, one number.
**Distillation trigger:** promote to CLAUDE.md §11 now rather than on recurrence — it is a direct correction to a rule already written there, and the gap has already produced one mis-tag (PRs #339 and #343 citing `Closes D38`, which left the log asserting an unbuilt onboarding tour was shipped). Founder followup filed.

## 2026-07-07 — Trailing-edge debounce via BullMQ window-end jobId + delay

**Context:** fix/d100 — collapsing incremental-sync webhook bursts into one
Autopilot apply sweep per window without missing the window's last delta.

**Finding:** enqueueing with `jobId = ${scope}-…-${windowEndMs}` and
`delay = windowEndMs - now` gives a trailing-edge debounce entirely inside
BullMQ: every producer in the window computes the SAME id (dedup collapses
the burst into one pending delayed job) and the job runs only AT window
end, after the window's last delta has landed. The tempting alternative —
run-now + window-keyed dedup (leading edge) — silently skips any delta
that arrives later in an already-swept window: the P0 being fixed, in
miniature. Verified live: two real sync enqueues 6s apart → one delayed
apply job → promoted at the exact window boundary (19:15:00.038Z).

**Rule (provisional):** for event-paced sweeps that must both collapse
bursts AND never miss the tail, key the BullMQ jobId on the window END and
delay to it — don't enqueue immediately with dedup.

**Distillation trigger:** promote to CLAUDE.md (worker-policy section
alongside D203/D225 notes) if the pattern recurs ≥3 times.
## 2026-07-07 — cloud-smoke.sh in web-session containers: two known bootstrap gaps

**Context:** Standing up the real stack (pg + redis + api + web) in a
Claude Code web container via `./scripts/cloud-smoke.sh` to smoke the
senders polish batch (D49/D227 primary-CTA wiring).
**Finding:** Two gaps block the first `up`/browse cycle: (1) `up` fails
silently at initdb when `/tmp/dmlogs` was pre-created by root — the
`runuser -u postgres` initdb can't write its log there ("Permission
denied"), yet the API wait-loop still prints "API up" because the API
boots without a DB; `chmod 777 /tmp/dmlogs` before `up` fixes it.
(2) `cloud-seed.sql` never sets `users.onboarded_at`, so every app
route redirects to `/onboarding` and the smoke stalls;
`UPDATE users SET onboarded_at = now()` after `seed` unblocks. Also:
Playwright pinned at 1.60 wants `chromium_headless_shell-1228` which
isn't in `/opt/pw-browsers` — launch with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
**Rule (provisional):** In a web-session container run
`chmod 777 /tmp/dmlogs` (after the script's first mkdir) and set
`onboarded_at` right after `seed`; consider folding both into
`cloud-smoke.sh` (`chmod` in `up`, `onboarded_at` in the seed SQL).
**Distillation trigger:** fold into `scripts/cloud-smoke.sh` +
`cloud-seed.sql` directly if one more session trips on either gap.

## 2026-06-05 — Reuse migration SQL as worker post-pass to keep three derive paths single-sourced

**Context:** spec v1.3 + mig 0022 add `senders.replied_count` + the auto-protect-on-replied-≥3 rule. The derived state has THREE entry points: the migration's backfill (initial deploy), `InitialSyncWorker.buildSenderIndex` (full rebuild), and `IncrementalSyncWorker` (per-webhook delta). Each could implement the formula independently — and silently drift from each other.

**Finding:** Pasting the SAME SQL (`UPDATE senders … FROM (SELECT … COUNT(DISTINCT m2.id) …)`) into all three paths makes the formula a literal single source of truth — change the rule in one place, every drift surface re-applies it on its next run. `InitialSyncWorker.buildSenderIndex` runs it inside the rebuild tx; `IncrementalSyncWorker` runs it inside a dedicated tx after each batch; the migration runs it as the backfill. All converge to the same byte-for-byte result.

**Rule (provisional):** for derived-state formulas that touch >1 write path, keep the canonical statement as raw SQL — Drizzle templating + JS abstraction tempt clever de-duplication that obscures drift surface. Quote the same statement in every entry point + audit by string match.

**Distillation trigger:** promote to CLAUDE.md §X if a third migration/worker pair lands using this pattern (Brief/Activity could also).

## 2026-06-04 — `FILTER (WHERE ...)` aggregates collapse N preview queries into 1

**Context:** spec v1.2 Decision 15's composite confirm modal needs 4 time-window bucket counts (`>30d`, `>90d`, `>180d`, `>365d`) plus the un-windowed `all` count + a past-30d `monthly` figure for the sender context strip. Naïve impl = 6 separate `SELECT COUNT(*) WHERE ...` queries per modal open.

**Finding:** Postgres `FILTER (WHERE …)` clauses on `count(*)` aggregate every bucket in ONE query — one index seek on `(mailbox_account_id, sender_key, internal_date)`, six aggregate columns out. The FE chip row receives all bucket counts with the modal-open round-trip, no per-chip refetch needed. The worker resolver applies the SAME predicate (`internal_date <= now() - interval 'N days'`) so the modal preview and the worker's actual resolved set match exactly — preview truthfulness comes for free instead of needing a second confirmation step.

**Rule (provisional):** any preview surface that shows N variations of "count under filter X" should be ONE aggregate query with FILTER clauses, never N separate counts. Mirror the worker's resolution predicate verbatim so the modal's number IS the executed number.

**Distillation trigger:** promote to CLAUDE.md §X if the FILTER-aggregate pattern recurs on the Brief / Autopilot / Activity-log preview surfaces.

## 2026-06-04 — Composite cascade-undo via `composite_id` walks at undo time, not issue time

**Context:** ADR-0020 composite shape stores primary + secondary as two `action_jobs` rows linked by `composite_id`. The undo flow needs to reverse BOTH siblings when the user undoes one. Two design options: (A) issue ONE undo token at forward time that the worker uses for the whole composite, or (B) issue per-row undo tokens and walk siblings at undo time.

**Finding:** (B) is simpler AND more correct. Each forward row keeps its own `undo_token`, so the activity log + undo journal stay homogeneous with single-verb actions. At `POST /undo/:T` the controller resolves the row by `undo_token=T`, computes the primary id (`row.compositeId ?? row.id`), then `SELECT … WHERE id = $primary OR composite_id = $primary` returns the whole composite. For a single-verb action the same query returns exactly one row, so the cascade path IS the single-verb path. No undo-journal migration needed.

**Rule (provisional):** when a many-to-one or sibling relationship exists between mutation records, store the relation on the records and walk it at the SECONDARY operation (undo/revert/rollback) — don't try to denormalize the relation onto the primary record's token/handle.

**Distillation trigger:** revisit if Autopilot rules need an analogous composite (batch match revert).

## 2026-06-03 — Visual-language consolidation via single primitive (ADR-0016)

**Context:** Founder reported card↔detail navigation chrome
discontinuity + intent tone-wash creating trust hits on
financial-institution senders. Goal was visual alignment without
touching semantics (separate fact-first cut PR).
**Finding:** Four surfaces (SenderCard, SenderTable TotalCell,
SenderDetailHeader, KpiStrip) rendered Fraunces display numerics at
four different sizes (32 / 18 / 28 / 26) and weights (600 / 600 / 600
/ 600) with no shared primitive. Each surface drifted its own scale.
Replacing all four callsites with `NumericDisplay variant="..."`
collapsed the drift into one file and gave the design-system-agent a
single anchor to enforce on later surfaces (Triage, Brief, Activity).
The same pattern (sub-component eyebrow label) already drifted twice
(`Eyebrow` at 10.5/0.14em vs ADR-0016's tightened 10/0.12em — see
design-system-agent advisory) — promoting the eyebrow rule next is
likely the right follow-up.
**Rule (provisional):** When two adjacent surfaces (linked by
navigation) render the same role-of-thing (primary numeric, eyebrow,
chip, action button) with hand-rolled styles, the next surface
should NOT add a third hand-rolled style — extract a primitive in
`packages/shared/src/components/` and treat the ADR as the
spec-override per D199/D220. Don't wait for ≥3 consumers to
extract; ≥2 + a navigation link between them is sufficient.
**Distillation trigger:** Promote to CLAUDE.md §6 if the same
"two-adjacent-surfaces drifted" pattern appears ≥2 more times
(action display, magnitude bar, chip styles already candidate).

## 2026-05-27 — Drizzle 0.43+ wraps PG errors in `DrizzleQueryError` — assertions must walk `.cause`

**Context:** Rebasing dependabot PR #97 (minor+patch group, drizzle
0.38 → 0.45 among 13 bumps). One spec failed:
`gmail-webhook.service.spec.ts` asserted on
`/value too long|length|varying\(512\)/i` against a deliberate
varchar(512) overflow.
**Finding:** Drizzle 0.43 introduced `DrizzleQueryError` that wraps
the underlying PG error. The wrapper's `.message` is
`"Failed query: <SQL>\nparams: <...>"` — the original PG text
("value too long for type character varying(512)") is preserved on
`.cause.message` (and `.cause.code === '22001'` for string
truncation specifically). Tests written against drizzle ≤ 0.42 that
match on `.message` silently lose coverage on the wrapped form.
**Rule (provisional):** When asserting on PG-side error semantics
in tests, walk `.cause` or check `.cause.code` rather than
matching `.message`. Pattern that works against both versions:
```
const err = await op().catch((e) => e);
const msg = [err?.message, err?.cause?.message].filter(Boolean).join(' | ');
expect(msg).toMatch(/<invariant>/);
```
**Distillation trigger:** Promote to CLAUDE.md §10 ("things not
to do") as "Don't assert on drizzle's wrapped `.message`" if a
second test hits the same trap.

## 2026-05-26 — Reviewer model staleness — verify model IDs against live docs

**Context:** Codex review of PR #77 flagged `claude-haiku-4-5` as an
invalid Anthropic model id, suggesting `claude-3-5-haiku-20241022`
as the "current" one. Verified via context7 against the official
Anthropic Claude API model catalog — `claude-haiku-4-5` is the
correct bare alias (Haiku 4.5 shipped 2025-10-01); the Codex
suggestion was an older Haiku 3.5 id.

**Finding:** Reviewer training data lags behind model releases. An
LLM reviewer that confidently cites a "canonical" model id can be
months stale. The cost of accepting the false-positive is shipping a
working model id labeled "broken" — or worse, swapping in the older
id Codex suggested and breaking the live call path silently
(`claude-3-5-haiku-20241022` would route to a deprecated model).

**Rule (provisional):** When a reviewer flags a model id / SDK
version / library API, ALWAYS verify against live docs via context7
before changing the code. Pin the verification in the source
comment with retrieval date + canonical-catalog URL so the next
reviewer doesn't re-flag the same false positive.

**Distillation trigger:** promote to CLAUDE.md §10 ("What NOT to do")
as "do not change model ids based on reviewer claim — verify via
live docs first" if pattern recurs ≥3 times across reviews.

## 2026-05-26 — `as const satisfies T` is the canonical exhaustiveness pattern

**Context:** Codex review of PR #78 flagged that `EVENT_SCHEMAS`
declared itself "exhaustive" in its doc comment but the actual
declaration was only `as const` — no `satisfies` clause. Adding a
new topic to `TOPICS` without a schema entry would compile clean and
only fail at the runtime parity test.

**Finding:** Two patterns look interchangeable but aren't:
  - `as const` alone — preserves literal-keyed lookup type but
    skips shape check entirely
  - `: Record<EventTopic, ZodSchema>` annotation — enforces shape
    but widens away the literal keys, breaking downstream lookups
  - `as const satisfies Record<EventTopic, ZodSchema>` — both:
    literal-keyed lookups preserved AND missing-key is a compile
    error at the assignment site

**Rule (provisional):** When mapping a closed set of enum/const
keys to per-key values where downstream code does literal-keyed
lookups, ALWAYS use `as const satisfies Record<KeySet, ValueType>`.
Either alone is insufficient.

**Distillation trigger:** promote to CLAUDE.md §1.2 (Simplicity
first) as a typed-map pattern note if pattern recurs ≥3 times.

## 2026-05-26 — `onConflictDoNothing` against a partial unique idx needs `target` + `where`

**Context:** Adding ON CONFLICT DO NOTHING to the autopilot apply
worker's match insert paired with a new partial unique index on
`rule_match_log (rule_id, sender_key) WHERE resolution='pending'`.

**Finding:** Drizzle's `.onConflictDoNothing({ target, where })`
requires BOTH the column list AND the same predicate as the partial
unique idx — Postgres uses both to identify which unique constraint
backs the conflict clause. Without the `where`, the planner can't
prove the ON CONFLICT specification corresponds to a unique index
and the insert errors instead of suppressing. Mirrors the seeder
pattern in `autopilot-preset-seeder.ts:78-80`.

**Rule (provisional):** When pairing `onConflictDoNothing` with a
partial unique index, the `where` clause MUST mirror the index
predicate exactly.

**Distillation trigger:** local pattern; promote to CLAUDE.md only
if other partial-idx use sites appear and confuse contributors.

## 2026-05-25 — Cron workers iterating every mailbox need bounded fan-out from day 1

**Context:** Three new cron workers shipped during the engine PR sweep
(AutopilotApply, BriefSnapshot, FollowupCheck) all started life with the
same shape: `for (const mb of mailboxes) { try { ... } catch ... }`.
Each per-mailbox body takes 5–50ms under load; at 10K mailboxes the
serial loop is O(minutes-to-hours) per cron tick — the cron interval
becomes the bottleneck, not the work.

**Finding:** The `createLimiter(n)` helper already exists in
`packages/workers/src/reasoning.ts` and is callable: `await limiter(async
() => ...)`. Wrapping the per-mailbox body with `Promise.all(mailboxes
.map(mb => limiter(async () => { try { ... } catch ... })))` keeps the
per-mailbox try/catch intact (so one bad mailbox can't stop the others)
while capping in-flight work below the Postgres pool ceiling. Default 8,
env override clamped to [1, 32] — same shape used in ScoreWorker.

Side-finding: when running the same vitest workspace across multiple
branch checkouts in sequence (smoke driver), PGlite container init
contention can spike the first test of each branch past the default
5s testTimeout. Re-running in isolation passes in <2s. The 5s
default is fine for production CI but tight for back-to-back smoke runs.

**Rule (provisional):** Any new cron worker that iterates `mailbox_accounts`
in a loop ships with `createLimiter` bounded concurrency from the first
PR. The serial pattern is a perf regression in disguise. Default cap 8;
env override `<WORKER>_CONCURRENCY` clamped to [1, 32].

**Distillation trigger:** Promote to CLAUDE.md §2 or a new "Worker performance"
section if a 4th cron worker repeats the pattern. Count: 3/3 — promotion
candidate already.

## 2026-05-25 — Throwaway HTML prototype unlocks design conversation faster than Storybook

**Context:** Senders surface uplift exploration. Founder asked for a
"massive" visual improvement. After two rounds of plan-only design
(text + ASCII), the conversation stayed abstract. Built a standalone
HTML prototype at `apps/web/prototypes/senders-uplift.html` with
three radically different variants (A within-constitution, B
dashboard-amending, C no-constraints reimagining) toggleable via a
floating bottom bar — built per the `prototype` skill's UI sub-shape
B (no nearby route to embed in).

**Finding:** The prototype changed the founder review from "I like
the words" to "the editorial hero from C with the tables from B but
the row chart is noise" — a concrete, actionable, half-sentence
decision. Two follow-up rounds (Codex review + my pushback) produced
a Variant D synthesis with crisp scope and a 4-ADR amendment
package, all in one session.

By contrast, the same conversation in Storybook would have required
(a) extracting primitives first, (b) typechecking against real
imports, (c) building stories that compose them — at least a day of
plumbing before the founder could see a side-by-side. The HTML
prototype was ~1500 lines, built in one Write, ready to compare in
under an hour.

The cost: a throwaway file lives in the repo. Marked for deletion
in FOUNDER-FOLLOWUPS once Variant D ships.

**Rule (provisional):** When a design decision is the bottleneck and
the existing codebase doesn't have a fast story-composing path, reach
for the `prototype` skill's HTML branch *before* extracting
primitives. Use the throwaway as the conversation substrate; let the
decision come back into the real codebase as ADRs + feature PRs.

**Distillation trigger:** promote to CLAUDE.md §5 (Implementation
phase order) if pattern recurs ≥3 times — "before extracting
primitives for a redesign, prototype the composition in
`apps/{web,api}/prototypes/` and delete after ratification."

## 2026-05-25 — Codex review caught a scope leak disguised as polish

**Context:** Same Senders uplift session. After founder + Codex
review converged on Variant D, Codex's second-round review proposed
8 "micro-interactions" including #2 "smooth review-mode transition
from dashboard to one-sender-at-a-time review."

**Finding:** That transition IS the card-deck triage ritual from
Variant C, which we explicitly deferred to a later wave because it's
polarizing for power users + needs A/B testing + needs the
`triage-card-deck` primitive + state machine. Codex re-introduced it
framed as "polish," not as a scope decision. Easy to miss without
re-reading the variant-D scope. CLAUDE.md §1.3 ("surgical changes —
every changed line must trace directly to the request") applies to
agent reviewers, not just to the agent writing code.

**Rule (provisional):** When a reviewer proposes a "polish" or
"transition" item, ask: "is this an existing feature relabeled?" If
yes, push back and flag the scope. Don't accept polish framing for
work that's actually wave-N feature scope.

**Distillation trigger:** promote to CLAUDE.md §1.3 or §10 (don't
do) if pattern recurs ≥3 times — "agent reviewers may smuggle
deferred features into polish frames; check scope explicitly before
accepting."

## 2026-05-23 — Conditional-hook pattern for TanStack + static-source override

**Context:** Migrating `useUndoTray` from a stub fetch to TanStack
Query (D200) while keeping the existing `dataSource` override seam
that Storybook + tests rely on. First attempt called either
`useUndoTrayStatic(dataSource)` or `useUndoTrayQuery(options)`
conditionally — readable, but React's rules-of-hooks rule fires
generically against the `?:` even though each branch is internally
unconditional. The eslint config doesn't include
`react-hooks/rules-of-hooks` as a rule, so the disable comment
ITSELF was the lint error ("Definition for rule … was not found").
**Finding:** The pattern that compiles cleanly AND matches existing
codebase shape: always call all TanStack hooks, gate `useQuery` with
`enabled: dataSource === undefined`, and short-circuit the return
when `dataSource` is supplied. Requires that the consumer is always
under a `QueryClientProvider` — true for `apps/web` routes and
test wrappers. Storybook stories don't run yet (PR-3) so the
constraint is invisible today.
**Rule (provisional):** When migrating a stub hook to TanStack
behind an existing dataSource override, do NOT branch into a
hookless static path — always invoke the TanStack hooks and use
`enabled: false` + a return short-circuit. Document the
QueryClientProvider requirement so future consumers don't mount
the hook in a provider-less tree.
**Distillation trigger:** Promote to CLAUDE.md §1.2 if a second
stub→TanStack migration runs into the same shape (currently 1/3).
## 2026-05-23 — Observer-injection seam over base-class hardcoding for D159

**Context:** Wiring D159 (Sentry) onto `BaseDeclutrWorker` and the
periodic reconciler (FOUNDER-FOLLOWUPS 2026-05-22 — D-CANDIDATE).
Three options were on the table: (a) import `@sentry/node` directly
inside `BaseDeclutrWorker.captureFailure`; (b) move the reconciler
inside a `BaseDeclutrWorker` subclass so the existing seam covers it;
(c) extract a `WorkerObserver` interface with `setObserver(observer)`
on the base + a `captureBackgroundFailure(err, ctx)` for non-job paths.
**Finding:** (c) was the only option that kept three properties
simultaneously: `packages/workers` framework-agnostic (no @sentry/node
dep added), reconciler covered without becoming a worker (it's a
DB-state reconciler, not a job consumer), and dev/test boots
unchanged (default `NOOP_WORKER_OBSERVER` is inert). Option (a)
would have leaked the SDK into the workers package; option (b) would
have forced the reconciler into a job lifecycle it doesn't fit
(repeatable jobs already exist via D225 cronPolicy, but the reconciler
predates that and the founder ratified its sweep design in PR-D).
The cost was one extra interface file + a wiring line in the
composition root — surgical, no new tables, no new dependencies.
**Rule (provisional):** When a framework-free package needs to emit
to an opinionated infra (Sentry, Datadog, PostHog), build a small
*observer interface* in the package, default it to no-op, and have
the composition root inject the real adapter. Avoids both
"package depends on SDK" and "ifs branching on env var inside the
package". The pattern also gives unit tests a recording observer
without mocking the SDK.
**Distillation trigger:** Promote to CLAUDE.md §6 (or a new
"Observability seams" subsection) if pattern recurs ≥2 more times —
e.g., when PostHog event emission lands on workers, or when a
Datadog-style metrics sink shows up. Count: 1/3.
## 2026-05-23 — D12 normalize-email had two consumers with different semantic needs

**Context:** Overnight PR `feat/d012-sender-key-hash` — adding the
D12-mandated `+suffix` strip to `normalizeEmail` in
`packages/workers/src/sender-key.ts`.
**Finding:** `normalizeEmail` was used by TWO call sites with subtly
different needs: (1) `initial-sync.worker.ts` passes it the From-header
email to compute the dedup `sender_key` — wants the strip (collapses
`foo+notion@gmail.com` and `foo@gmail.com` to one sender). (2)
`header-parsing.ts` `parseRecipients` normalizes outbound To/Cc for
storage in `mail_messages.recipient_emails` — does NOT want the strip
(the user literally wrote to `bob+work@example.com` and a future
reply-attribution feature wants to see that). A single shared utility
served both well only because the prior contract was the
lowest-common-denominator lowercase+trim; once D12 added strip-`+`
semantics, the two consumers diverged.
**Rule (provisional):** When a "normalize X" utility serves multiple
call sites, audit them before changing the contract. Prefer giving the
extra normalization a dedicated function name (or inlining the
lowercase+trim at the second site) over silently broadening the shared
helper.
**Distillation trigger:** promote to CLAUDE.md §1.3 (surgical changes)
if the same multi-consumer-utility-drift pattern recurs ≥3 times.

## 2026-05-23 — D156 FOUNDER-FOLLOWUPS entry was stale by ~1 day

**Context:** Overnight PR `feat/d012-sender-key-hash` was briefed to
ship D156 throttle decorators on the OAuth connect routes per the
2026-05-22 FOUNDER-FOLLOWUPS entry.
**Finding:** The work was already done. PR #35 (merged 2026-05-23,
i.e. earlier same day as this overnight session) shipped both the
`RateLimitModule` infrastructure AND wired `@RateLimit('auth')` onto
both `GoogleOAuthController.start` + `.callback`. The FOUNDER-FOLLOWUPS
entry was filed before that PR landed and never moved to Done. Caught
by `grep -rn "RateLimit" apps/api/src/auth/` as the first verification
step — saved hours of duplicated work.
**Rule (provisional):** Before implementing a FOUNDER-FOLLOWUPS item,
grep the codebase for the proposed code shape FIRST — entries can go
stale between filing and the next session that picks them up. The
follow-up's "Verifies by" line is the most precise grep target.
**Distillation trigger:** promote to CLAUDE.md §9 ("What to do if
unsure") if stale FOUNDER-FOLLOWUPS items mislead ≥3 sessions.

## 2026-05-23 — Same parallel-vitest-bootstrap pattern recurred in `apps/web`

**Context:** Option-1 fan-out from CLAUDE session — foundation PR #37
(API envelope) then 3 parallel worktrees (WT-B senders BE / WT-C senders
FE wire / WT-E triage UI). WT-C + WT-E both had to write tests under
`apps/web`. The web app's pre-fan-out `test` script was
`echo 'no tests yet'` and there was no `vitest.config.ts`.
**Finding:** Both agents independently bootstrapped vitest in
`apps/web` and produced two divergent configs in the same file —
WT-C (FE) chose `happy-dom` + `@testing-library/*` + setupFiles +
extended timeout; WT-E (triage) chose `node` env + SSR-only render
(matching `packages/shared`). Both committed clean test suites
(55 + 24 passing) but the configs collide at integration. Merge order
needs WT-C's superset config kept. This is the **second** recurrence
of "parallel agents independently bootstrap missing test foundation"
— same root cause as the earlier `packages/shared` instance (entry
below). One more occurrence and the rule promotes to CLAUDE.md §11.
**Rule (provisional):** Before dispatching ≥2 parallel agents that
will each need to write tests in a package whose `test` script is a
no-op, the dispatcher (me, in foundation PR) bootstraps the
test-runner config in that package as part of the foundation. The
test-config decision (env, setup files, render mode) is one of those
"every feature module touches this" foundations that must live in
the foundation PR, not in any feature's PR.
**Distillation trigger:** Promote to CLAUDE.md §1.1 ("Think before
coding") if pattern recurs ≥1 more time (count: 2/3 today). The
promotion will read roughly: "Before dispatching parallel agents,
audit the foundation packages they will write into for missing
infra (test runner, lint config, schema migrations) — land it in
the foundation PR, not in any feature branch."

## 2026-05-23 — Two parallel agents independently bootstrapped the same vitest infra in `packages/shared`

**Context:** Dispatched 3 worktrees in parallel — WT-1 (D7+D228 privacy
badge in `packages/shared`) and WT-2 (D224 sync contract, also in
`packages/shared`). Each agent received a tightly scoped file list that
did NOT include test-runner setup. Both Definitions-of-Done required
`pnpm vitest run` for the new tests.
**Finding:** `packages/shared` had no test runner wired (its `test`
script was `echo 'no tests yet'`). Both agents independently identified
the gap, both added `vitest@^2.x` devDep + a `vitest.config.ts` +
`test`/`test:watch` scripts, both mirrored the existing `packages/db`
and `packages/workers` pattern, and both flagged the scope creep
honestly. Net result: a clean merge conflict on
`packages/shared/{vitest.config.ts,package.json}` + `pnpm-lock.yaml`,
caused entirely by missing foundation rather than by feature overlap.
Two independent agents arriving at the same scope-creep call is a
strong signal that the foundation should have existed before either
feature began.
**Rule (provisional):** When seeding a workspace package for the first
real consumer, the bootstrap (test runner + lint config + any shared
deps) should land in its own PR *before* parallel feature work begins.
For multi-worktree dispatch, audit the workspace target's
`package.json` `scripts` and devDeps in the dispatcher (this thread)
before fanning out — if any required tooling is missing, ship a
`chore/bootstrap-<package>-<tool>` PR first.
**Distillation trigger:** Promote to CLAUDE.md §5 (PR sequence) — add
"foundation-before-fan-out" as an explicit rule — if a second parallel
dispatch hits the same convergent-infra-bootstrap pattern. Single
occurrence not yet enough to promote, but the cost (manual rebase +
duplicate review) is high enough that 2× hits = promote.

## 2026-05-22 — A "harness-blocked" claim went unverified for two sessions

**Context:** FOUNDER-FOLLOWUPS carried an item to fix a stale path in
`.claude/agents/design-system-agent.md`, annotated "Editing
`.claude/agents/**` is harness-blocked (self-modification), so the agent
could not apply it." This session needed the same fix across four agent
files.

**Finding:** The claim was wrong. A single test Edit on
`design-system-agent.md` applied with no error; all four agent files were
then fixed directly. The "harness-blocked" note had been written once,
believed, and propagated as a founder action item for two sessions — work
an agent could have done immediately.

**Rule (provisional):** Treat "can't / blocked / not allowed" claims —
especially inherited ones — as hypotheses, not facts. Run the cheapest
one-shot test (one Edit, one command) before routing work to the founder
or marking it blocked. Same discipline as the 2026-05-19 "verify, don't
delegate verification" entry — this is the 2nd occurrence.

**Distillation trigger:** promote to CLAUDE.md §9 ("what to do if unsure")
on a 3rd occurrence — "verify a constraint before escalating past it"
becomes a standing rule.

## 2026-05-22 — Infra runbook written from API knowledge missed ~10 console realities

**Context:** Walking the founder through `sync-infra-setup.md` (GCP
project + OAuth, Cloud KMS, Upstash, Pub/Sub). The runbook was written
from API/D-plan knowledge without driving the actual GCP console. The
founder hit a gap roughly every other step and had to ask; each answer
became a runbook correction.

**Finding:** The misses clustered into four kinds — none were code bugs,
all were "the doc didn't match what the console actually does":

1. **Missing step.** The KMS section never created the API runtime
   service account (`declutrmail-api`) — it jumped from "create key" to
   "grant the SA access" with no SA to grant. Founder: "I created key
   until now" → step 2.4 added.
2. **Ambiguous "where".** "Record the key resource name" / "place the
   values" gave no console path. Founder asked "from where exactly to
   copy?" and "where do I place values?" → added the ⋮-menu → Copy
   resource name path and the `[local]`-now / `[gh]`+`[gcp]`-later timing.
3. **Wrong scope/level.** Runbook implied `Pub/Sub Publisher` is granted
   on a subscription; it is a topic-level role and never appears in a
   subscription's role list. Founder: "There is no Pub/Sub Publisher."
4. **Failure modes the doc never anticipated.** The Gmail-publisher grant
   is blocked by the `iam.allowedPolicyMemberDomains` org policy (default
   on new orgs); fixing it needs `roles/orgpolicy.policyAdmin`, which
   Organization **Administrator** does NOT include; and the constraint is
   easily confused with the newer `iam.managed.allowedPolicyMembers`.
   None of this was in the doc until the founder hit each wall.

Also corrected: `gmail.metadata` is wrong to add (blocks the `q`
search — `gmail.modify` alone is correct); staging/prod domains don't
exist yet (Cloud Run deferred), so those redirect URIs / the push
subscription are deploy-time, not now.

**Rule (provisional):** A founder-facing infra runbook must be written
against the live console, not from API/SDK knowledge. For every step
state (a) the exact console menu path, (b) the precise resource — name,
scope (resource vs project vs org), and role string, (c) the prerequisite
that step depends on, and (d) the likely failure (greyed-out button,
permission denial, default-enforced org policy) with its fix inline.
If the console can't be driven while writing, mark the step
"unverified — confirm in console" rather than ship it as fact.

**Distillation trigger:** promote to CLAUDE.md §8 (definition of done —
add a "founder-facing runbook" clause) if a second infra/setup doc ships
with console-reality gaps the founder has to catch during execution.

## 2026-05-20 — `next dev` timing is not a performance signal

**Context:** Profiling the Senders screen — `next dev` reported
200–280 ms per `/senders` request, which read as a latency problem
worth chasing.

**Finding:** `next dev` compiles routes on demand, runs the React dev
build (unminified, extra checks), and skips the static cache — it
re-renders every request. A production `next build` + `next start`
measurement of the same route was ~2–3 ms server time, because
`/senders` is a static prerender (`○` in the build route table). The
dev number was tooling overhead, not the app.

**Rule (provisional):** Never quote `next dev` timings as performance.
Measure `next build` + `next start`, or read the build's route table.
`next dev` overwrites `.next` with dev artifacts, so rebuild before any
`next start` measurement.

**Distillation trigger:** promote to CLAUDE.md §8 if a dev-mode metric
is mistaken for a real one again (≥2 recurrences).

## 2026-05-19 — Default to verifying, not delegating verification

**Context:** PR #4 (`chore/bootstrap-pr1b`) introduced a status legend
for PR-body Verification sections: 🟢 verified · 🔴 fail · 🟡 partial ·
🟠 needs manual verification · ⚪ n/a. On the first pass I marked 8
items 🟠 ("needs manual verification") on the assumption that
GitHub Actions runtime, Husky local behavior, and the PostToolUse hook
chain couldn't be exercised from the cloud sandbox.

**Finding:** Most of those were actually verifiable from the cloud
session — I just hadn't tried:

- GitHub Actions check runs are readable via the GitHub MCP API
  (`pull_request_read get_check_runs`). For PR #4, 9 of 11 jobs reported
  ✅ — confirming `ci.yml`, `subagent-gate.yml`, and `branch-name.yml`
  jobs all passed.
- Husky `pre-push` can be invoked manually (`bash .husky/pre-push`) and
  its branch-name regex checked against the current branch.
- Husky `commit-msg` firing is observable in retrospect — the
  `bef9e23` commit emitted a commitlint warning, which is direct
  evidence that the hook ran on that commit.
- The PostToolUse hook chain is the same Claude Code mechanism that's
  been running `verify-no-body-storage.sh` since PR #2. The hooks are
  wired in `.claude/settings.json` (`jq '.hooks.PostToolUse[0].hooks |
  length'` returns 8) and the scripts are executable — that IS
  end-to-end verification, not an assumption.

Net: 6 items flipped 🟠 → 🟢 on the second pass, 2 to 🟡 (partial), and
only 3 remained truly 🟠 (real PR-merge mechanics, founder's local mac,
founder-action settings toggles).

**Rule (provisional):** Before marking an item 🟠, run the cheapest
validation available — MCP API call, manual script invocation,
config-file inspection, log evidence — and only escalate to 🟠 if
that path genuinely can't reach the truth. Reserve 🟠 for items that
require:

1. A real external event the sandbox can't simulate (PR merge → bot
   commit; push to main triggering scheduled workflow)
2. An environment the sandbox doesn't have (founder's local machine,
   another developer's setup)
3. Credentials/secrets only the founder controls (repo settings,
   third-party accounts)
4. Subjective judgment only the founder can make (design choices,
   product trade-offs)

Bias toward 🟢 with evidence cited, not 🟠 with hand-waving.

**Distillation trigger:** Promote to CLAUDE.md §1 (behavioral
principles) or §8 (definition of done) if I default to 🟠-marking
again on a future PR despite available validation paths. Recurrence
≥2 across PRs is a strong enough signal because this is a habits
problem, not a tooling problem.

## 2026-05-21 — Future `mail_messages` index migrations need `CONCURRENTLY`
**Context:** PR #13 — the messages/senders schema. `mail_messages` got
four indexes via plain `CREATE INDEX` in migration `0001`.
**Finding:** That migration is safe *only because the table is new and
empty* — `CREATE INDEX` on an empty table takes a negligible lock. But
`mail_messages` will be the highest-volume table in the product and is
the one that hits D235's partitioning trigger first (25M rows / 2M per
mailbox / p95 > 150ms). Any migration adding an index to it *after*
launch will hold an `ACCESS EXCLUSIVE`-ish lock for the duration of a
plain `CREATE INDEX` and block writes.
**Rule (provisional):** Migrations that add an index to an
already-populated high-volume table (`mail_messages` first, later
`activity_log`, `sender_timeseries`) must use `CREATE INDEX
CONCURRENTLY`. The deferred D150 "12-index audit" PR is the first place
this applies — it adds indexes to `mail_messages` post-PR-A.
**Distillation trigger:** promote to CLAUDE.md §8 (migration PR
definition-of-done) if a second migration is caught adding a
non-concurrent index to a populated table.

## 2026-05-23 — Two-phase idempotency for revert-shaped mutations
**Context:** PR `feat/d232-undo-journal` — designing `POST /undo/:token`
to be safely retryable without double-reverting.
**Finding:** A single timestamp column (`reverted_at`) is NOT a complete
idempotency lock for a mutation that can fail mid-flight. Two timestamps
are needed:
  - `executed_at` — claimed on REQUEST arrival (atomic UPDATE WHERE
    executed_at IS NULL → that win serializes concurrent calls).
  - `reverted_at` — stamped only on SUCCESS.
This split lets a request whose Gmail call fails leave `reverted_at`
null. The next request finds `reverted_at IS NULL` and re-runs the
revert; the prior labels in the payload make the re-run a no-op when the
mutation actually succeeded the first time. Single-timestamp variants
either double-revert OR strand permanently after a transient failure.
**Rule (provisional):** any mutation endpoint that can partially succeed
(external API call) gets a two-phase claim/commit pair on its
idempotency row. The claim is atomic UPDATE; the commit is the second
stamp.
**Distillation trigger:** promote to CLAUDE.md §7 (gate network) or
add to `architecture-guardian` Check H if a second feature ships with
single-timestamp idempotency that bites under retry. Watch for Stripe
webhook handlers and the future per-verb reverters.

## 2026-05-23 — Drizzle `tx.execute()` row shape varies by driver
**Context:** PR `feat/d013-outbox-dispatcher` — the OutboxDispatcher
runs a raw SQL claim with `FOR UPDATE SKIP LOCKED` via `tx.execute(sql\`...\`)`.
The same code passed all assertions against postgres-js types but blew
up in PGlite tests with `"claimed is not iterable"`.
**Finding:** Drizzle's `execute()` returns DIFFERENT shapes per driver:
  - `drizzle-orm/postgres-js`: returns a `RowList<Row[]>` that extends
    `Array` — you can iterate directly (`for (const row of result)`).
  - `drizzle-orm/pglite`: returns `Results<Row>` shaped as
    `{ rows: Row[], affectedRows?, fields, blob? }` — iteration
    requires `result.rows`.
Both pass TypeScript because the return type is generic `T['execute']`.
The mismatch only surfaces at runtime, in the PGlite test path.
**Rule (provisional):** any call site that uses `db.execute()` /
`tx.execute()` (raw SQL escape hatches) MUST normalize the row shape:
`const rows = Array.isArray(result) ? result : (result.rows ?? []);`
Prefer Drizzle's query builder (`.select().from()`) which returns
arrays in both drivers; reserve `execute()` for SQL features the
builder doesn't expose (in our case, `FOR UPDATE SKIP LOCKED`).
**Distillation trigger:** promote to CLAUDE.md §6 (DB conventions) if
a second raw-SQL site hits the same shape mismatch.

## 2026-05-23 — PGlite cannot prove SKIP LOCKED runtime semantics
**Context:** Same PR — testing the outbox dispatcher's
`FOR UPDATE SKIP LOCKED` claim against PGlite to prove two concurrent
dispatchers split the backlog without double-claiming.
**Finding:** PGlite is single-connection (it's an in-process WASM build
of Postgres). Concurrent transactions in the test harness serialize on
the one connection, so SKIP LOCKED's "skip past locked rows" branch
never exercises — the second `tick()` always waits for the first to
commit. The clause is in the SQL (asserted via source-grep), and the
behavior is standard Postgres semantics, but the test harness can't
DEMONSTRATE the concurrency.
**Rule (provisional):** for SKIP LOCKED / advisory-lock / serializable-
isolation tests, document the gap explicitly and gate the runtime proof
on `OUTBOX_TEST_PG_URL` (or the future testcontainers harness). Don't
fake the test against PGlite — it would pass for the wrong reasons.
**Distillation trigger:** promote to CLAUDE.md §8 (test strategy) when
a second multi-connection Postgres feature lands (e.g. advisory locks
for the AutopilotApplyWorker). Pairs with adding testcontainers to the
shared test harness rather than per-package.

## 2026-05-28 — Per-query `retry` fn silently overrides the test client's `retry:false`
**Context:** Adding a "don't retry 4xx" predicate (`retryTransientOnly`) to stop 409s from being retried (the SELECT_MAILBOX storm). First cut set `retry: retryTransientOnly` per-hook on `useSenders` / `useTriageQueue` / `useTriageStats`.
**Finding:** A per-query `retry` option OVERRIDES the QueryClient default — including the test client's `retry:false` (`createTestQueryClient`). The senders 500-error tests, which rely on `retry:false` to surface the error immediately, started retrying 3× with exponential backoff and timed out (`expected false to be true` on `isError`). Prod `makeQueryClient` set no `retry`, so it was on TanStack's default (3×) — which is exactly why 409s WERE retried in the storm.
**Rule (provisional):** Put cross-cutting retry policy at the **QueryClient default** (`makeQueryClient`), not per-hook. The test client's `retry:false` then still wins (it's also a client default, not overridden), and prod gets the policy globally. Reserve per-hook `retry` for genuinely hook-specific rules (e.g. `retryUnless404` on sender-detail). Note: a per-hook `retry` fn that returns `failureCount < n` for 5xx will defeat `retry:false` in tests and make 500-error specs slow/flaky.
**Distillation trigger:** promote to CLAUDE.md §8 (test strategy) if a third query-level policy (e.g. `retryDelay`, `gcTime`) gets mis-placed per-hook.

## 2026-05-28 — Monorepo parallel test runner trips PGlite suites on timeout
**Context:** Building the async archive-action pipeline (D226). New PGlite integration specs (`label-action.worker.test.ts`, `actions.service.spec.ts`) passed in isolation (1–2s/test) but the new test + several PRE-EXISTING ones (`triage.service.spec`, `undo.service.spec`, `gmail-webhook.service.spec`) reported `1 failed` under the full `pnpm test` (`pnpm -r --parallel`), with per-file durations of 100–150s.
**Finding:** `pnpm -r --parallel test` runs every package's Vitest at once; each PGlite `beforeEach` replays all 15 migrations in WASM Postgres. Under full parallelism the CPU starves and the heaviest specs blow Vitest's default 5s test timeout. Run the same package alone → green (workers: 242 passed). It is contention, not a logic regression — confirmed by isolating the failing package.
**Rule (provisional):** A `1 failed` under `pnpm test` whose per-file duration is 100s+ is almost certainly a parallel-contention timeout, not a real failure. Re-run the affected package with `pnpm --filter <pkg> test` before treating it as a regression. Consider a higher `testTimeout` for PGlite-heavy suites or `--no-file-parallelism` for the aggregate run.
**Distillation trigger:** promote to CLAUDE.md §8 (test strategy) if a third session mistakes a parallel-timeout flake for a regression.

## 2026-05-28 — BullMQ forbids `:` in custom jobId; fake-queue tests can't catch it
**Context:** Live-smoking the archive pipeline (D226). Every gate, Codex pass, security review, and 280+ tests were green, but `POST /api/actions/archive` returned 503 on the first real request.
**Finding:** BullMQ 5.77.0's exact rule (`job.js` `validateOptions`): a custom `jobId` containing `:` is rejected UNLESS it `split(':').length === 3` (exactly 2 colons / 3 parts). My verb-namespaced keys (`archive:<uuid>`, `revert:<token>` — 1 colon, 2 parts) tripped it → `queue.add` threw → my catch marked the row `failed` + returned 503. NOTE: the existing `mailbox:sender:producedAt` score jobIds and `Worker:<ISO-minute>` cron jobIds are 2-colon/3-part and are FINE — I initially mis-flagged them as a "landmine" before reading the rule (retracted). The PGlite integration tests used a FAKE queue that recorded `add()` WITHOUT BullMQ's validation, so the bug was invisible until a live Redis. Fix: colon-free separator `-` (also normalize `:`→`-` in client keys), AND teach the fake queue to throw on `:` so the test has the same teeth as prod.
**Rule (provisional):** (1) A fake/mock for an external service must replicate its REJECTION rules, not just its happy path. (2) Read the dependency's actual validation source before declaring a repo-wide "landmine" — a partial understanding (`:` is banned) produced a false high-severity alarm; the real rule (`:` ok iff 3 parts) cleared every existing call site. Verify the claim against source, then act.
**Distillation trigger:** promote to CLAUDE.md §8 if a second mock-vs-real divergence ships a bug past green tests.

## 2026-05-28 — Deterministic two-mailbox SQL seed beats unit tests for read-screen smoke
**Context:** Battle-testing the Senders read surface for production. No real OAuth/Gmail in the container; unit tests passed but encoded a wire-contract bug (`generatedBy`).
**Finding:** A small generator (`node → SQL → psql`) that seeds two mailboxes with senders spanning every UI branch — each `volumeTrend` bucket, all 3 Weekly-Hero slice predicates (incl. a slice with <3 to prove the omission), VIP/Protected/none, every `unsubscribeMethod`, >page-size senders for pagination, a >10-message sender for detail paging, and `generatedBy` in BOTH `llm_haiku`+`template` — plus the D206 dev-login, exercised the REAL query path and surfaced four defects unit tests missed (wire enum drift, dead protection surface, bypassed confidence gate, VIP-only bulk-actionable). `sender_key = sha256("v1|"+normalizeEmail(email))` is computable in JS/SQL so the seed needs no app code. Edge states (no-active-mailbox 409, VIP-only) were forced reversibly via `UPDATE … ; <assert> ; UPDATE … <restore>`.
**Rule (provisional):** For a read-heavy screen, before trusting green unit tests, seed a deterministic dataset that hits every rendering branch + force each guard/edge state reversibly via SQL, and hit the live endpoint across BOTH connected mailboxes. Tests written against hand-typed wire literals can encode the very drift they should catch.
**Distillation trigger:** promote a committed `scripts/seed-senders-dev.*` + the smoke checklist to CLAUDE.md §8 if a 2nd read screen needs the same treatment.

## 2026-05-29 — `atlas.sum` CANNOT be hand-computed; it needs the real `atlas migrate hash`
**Context:** Adding migration 0016 (D181 security_events) where the Atlas CLI couldn't be installed (network policy blocks the download) and there's no DB/docker. I tried to hand-maintain `atlas.sum`.
**Finding (corrected — my first two attempts were based on a wrong theory):** Atlas's per-file `h1:` is NOT a simple `sha256(name+content)`. It only *looked* like that because `0000` (the one file whose raw bytes are already atlas-canonical) matched `sha256(name+raw)` — a coincidence. Every other migration (incl. newline-terminated ones like 0003) does NOT match any byte-level transform I tried (raw, ±trailing newline, CRLF↔LF, strip `--> statement-breakpoint`, strip comments, …). Atlas **canonicalizes the SQL** (parses/re-serializes) before hashing, so the hash is not reproducible from file bytes alone. Consequently:
  - My "the committed sum is stale for 0001–0015" diagnosis was FALSE. Proof it was already valid: PR #130 (added 0015) had a GREEN `atlas migrate lint`, and the 0001–0015 `.sql` bytes are byte-identical between main and my branch.
  - My "full regeneration" with `sha256(name+raw)` therefore CORRUPTED 15 previously-valid hashes → `atlas migrate lint` failed `checksum mismatch (atlas.sum): L3: 0001 … was edited`.
  - Fix: restore main's exact 16 hash lines; the new migration's entry + the total genuinely require `atlas migrate hash` (real CLI) — run it in an env that has Atlas, or in CI.
**Rule:** Do NOT hand-edit `atlas.sum`. If you add a migration and can't run `atlas migrate hash`, leave the sum for a human/CI step and say so — never recompute hashes from bytes (you'll corrupt valid entries). The `h1:` total algo `sha256(Σ name+h)` IS reproducible, but the per-file hashes are not.
**Distillation trigger:** promote to CLAUDE.md §4 (migration workflow) — "never hand-edit atlas.sum" — given this burned a full CI cycle.

## 2026-05-30 — Verb registries belong before the second verb, not after the sixth
**Context:** Designing PR #135 → PR #144 bulk-action sequence. Today's verb plumbing (archive only) lives across ~10 files (db enum, undo enum, worker label-change map, FE button arrays, microcopy maps, eligibility predicates, K/A/U/L shortcut binding). Codex review of `docs/handoffs/2026-05-30-bulk-actions-architecture-codex-review.md` validated the consolidation at 4 verbs.
**Finding:** A verb registry / action manifest pattern (single typed descriptor per verb in `packages/shared/actions/`) is justified at 4 verbs, not at 6+. Net LOC is roughly flat at 4 verbs (~200 LOC manifest replaces ~150 LOC scattered) but compounds aggressively per-verb: adding `mark_read` afterwards is 1 entry + 2 migrations (~20 LOC) vs. ~80 LOC across 10 files in the scattered shape.
**Rule (provisional):** Build a verb/action registry when you have ≥2 verbs that share a UI surface or worker pipeline. Earlier than that = speculative; later = paying retrofit cost on every screen that shipped verb-hardcoded.
**Distillation trigger:** promote to CLAUDE.md §1 (behavioral principles, simplicity-first qualifier) if pattern recurs across triage/brief/screener consolidations as expected.

## 2026-05-30 — DB enum values are append-only; never derive from a JS object
**Context:** Initial Action Manifest sketch had `pgEnum('action_verb', Object.keys(ACTION_MANIFEST) as ActionVerb[])` — DB enum derived from manifest keys at codegen.
**Finding:** Codex flagged: a manifest deletion (refactor, accidental, or mid-refactor partial commit) silently DROPS pg_enum values. Postgres rejects `DROP VALUE` on most enums; even where it doesn't, downstream rows referencing the dropped value break. Migrations must be explicit, append-only, version-controlled, hand-reviewed.
**Rule (provisional):** Pure constants module (`packages/shared/contracts/verb-constants.ts`) owns the agreement. DB schema imports the constants ONLY to write the explicit migration; manifest descriptor imports the constants for typing. Constants array is append-only; type tests assert union coverage; pg_enum migration tracks separately.
**Distillation trigger:** promote to CLAUDE.md §10 ("Do NOT" list — "Do NOT derive pg_enum values from a JS structure"). Codex correction here aligns with broader migration discipline.

## 2026-05-31 — A verb-generic descriptor is invariant; iterating its mapped registry won't widen

**Context:** P2 Action Registry. `ActionDescriptor<V>` carries
`execution: ActionExecution<V>` whose builders take `(params:
ParamsForVerb<V>)`. `ACTION_REGISTRY` is the mapped type `{ [V in
ActionVerb]: ActionDescriptor<V> }`.

**Finding:** `ACTION_VERBS.map((v) => ACTION_REGISTRY[v])` yields the
DISTRIBUTED union `ActionDescriptor<'keep'> | ActionDescriptor<'archive'>`,
which is NOT assignable to `ActionDescriptor<'keep' | 'archive'>` (the
default `ActionDescriptor`). Because `V` appears in a contravariant
position (builder param), the generic is invariant in `V`, so the union
of per-verb descriptors does not widen to the base descriptor. An inline
`(v): ActionDescriptor =>` annotation does NOT rescue it — `tsc` fails
`TS2322`. Both gate agents flagged this independently.

**Rule (provisional):** When exposing "all descriptors as a list" from a
verb-generic mapped registry, widen with an explicit array assertion
(`... as readonly ActionDescriptor[]`) at the boundary — the per-verb
element shapes ARE structurally identical at the base type; only the
deferred `ParamsForVerb<V>` index differs. Expect this again at P5 when
`archive` gains a real historic-scope param (the params stop being a
uniform empty type, but the iteration widening is unchanged).

**Distillation trigger:** promote to CLAUDE.md §X if pattern recurs ≥3 times.

## 2026-05-31 — Atlas `atlas.sum` is reproducible offline (no atlas binary needed)
**Context:** Adding migration `0018` (an `ALTER TYPE … ADD VALUE`) needed
`packages/db/migrations/atlas.sum` updated, but `atlas` is uninstallable
in the web-execution env (ariga.io egress returns 403; `go install` proxy
likewise blocked). CI's `migration-lint` runs `atlas migrate lint`, which
verifies `atlas.sum` integrity — a stale/missing entry breaks CI.
**Finding:** The `atlas.sum` hashing is reproducible with Node `crypto`
alone. Verified to byte-reproduce all 18 existing entries:
- **Per-file line** = a *cumulative* SHA-256 over `(name + content)` for
  every `.sql` in sorted order, emitting the running digest at each file
  (a single hash object, never reset — so the LAST file's hash covers the
  whole dir, and the FIRST file's is just its own). Encoded base64, prefixed `h1:`.
- **Header line** = `h1:` + base64(SHA-256 over the concatenation of
  `(name + rawBase64HashWithoutPrefix)` for every file, in order).
- File order is the sorted `.sql` list; `.rollback` files are excluded.
**Rule (provisional):** When `atlas` is unavailable, regenerate
`atlas.sum` with a Node script using the algorithm above, and ALWAYS
assert it byte-reproduces every pre-existing entry before writing (a
single mismatch means the algorithm or a source file drifted — abort).
The PGlite `migration-roundtrip` test (`packages/db/tests`) then smokes
the SQL itself (apply → rollback → re-apply) without atlas or a local PG.
**Distillation trigger:** promote to CLAUDE.md §X if a 2nd migration PR
hits the same atlas-unavailable wall.

## 2026-05-31 — A new `action_verb` must be writable into the downstream enums
**Context:** P4 tried to append `later` + `unarchive` to the `action_verb`
pg_enum. `later` typechecked; `unarchive` failed the workers build.
**Finding:** `LabelActionWorker` writes a job's `verb` straight into
`undo_journal.actionKind` (`undo_action_kind`) and `activity_log.action`
(`activity_action`). So `action_verb` is effectively a SUBSET of both of
those enums. `later` is a member of all three; `unarchive` is in neither
downstream enum, so widening `action_verb` to include it broke the
worker's insert types (`TS2769`). The registry can model `unarchive` as a
`label-modify` verb (for FE copy) without it being a valid `action_verb`.
**Rule (provisional):** Before adding a verb to `action_verb`, confirm it
already exists in `undo_action_kind` AND `activity_action` (or migrate all
three together + teach the worker). Registry membership ≠ pg_enum
membership — `keep`, `unsubscribe`, and now `unarchive` are in the
registry but not in `action_verb`, each for a documented reason.
**Distillation trigger:** promote to CLAUDE.md §2 (DB invariants) if a
verb-add breaks a downstream enum a 2nd time.

## 2026-06-10 — TanStack refetchInterval silently pauses without window focus
**Context:** Live smoke of the triage action-status poll (1s cadence until terminal) through the preview-browser harness.
**Finding:** After confirming an action, exactly one status poll fired and then nothing for ~100s — looked like a polling bug. Root cause: TanStack Query's `refetchInterval` only ticks while the window has focus (default `refetchIntervalInBackground: false`), and the automated browser loses focus between scripted interactions. With focus held, the poll ran at the designed 1s and the whole confirm→done cycle took 3s. Two implications: (a) harness evals must keep the page active (or assert on eventual consistency) when testing poll-driven flows; (b) a real user who backgrounds the tab mid-action also gets no poll until refocus — the action completes server-side and reconciles on return, which is acceptable, but worth remembering before blaming the pipeline.
**Rule (provisional):** When a poll-driven flow "hangs" in an automated browser, check `document.hasFocus()` semantics before debugging the query; consider `refetchIntervalInBackground: true` only for polls that must survive backgrounding (action status arguably qualifies — revisit if users report stuck receipts).
**Distillation trigger:** promote to a §8 smoke-harness note if it costs another debugging session.

## 2026-06-11 — Mutation-triggered refetch stomps focused form-control local state
**Context:** U15 Autopilot rules UI smoke — confidence-threshold slider (local state while dragging, PATCH commit on release/blur, rules-query invalidation on success).
**Finding:** A commit's own invalidation refetches the rules list, the refetched `committed` prop flows into the slider's "resync local state from server" effect, and that resync silently discarded the user's NEXT in-flight adjustment (live: click-commit at 74% → refetch landed mid-keyboard-adjustment → arrow keys to 85% thrown away, blur compared 74%==74% and committed nothing). Unit tests never caught it because they perform one interaction per render; only the live two-adjustments-in-a-row walk did.
**Rule (provisional):** Any "local state synced from a server prop" control whose commit invalidates the query feeding that prop MUST gate the resync on the control not being focused (`document.activeElement !== input`). Same family as the scope-reset invariants: the cache layer is allowed to update the world mid-interaction.
**Distillation trigger:** promote to CLAUDE.md §8 (flow completeness) if a second commit-resync stomp ships.
## 2026-06-11 — Concurrent-agent smoke: shared cookie jar + shared workspace row
**Context:** U13 billing-FE smoke (ports 4113/3113) during the multi-agent launch buildout, with sibling units smoking against the same shared local Postgres at the same time.
**Finding:** Two shared-state races corrupted the smoke mid-run. (1) The preview-browser harness shares ONE `localhost` cookie jar across every unit's preview server — cookies are per-host, not per-port — so when a sibling agent dev-logged-in as a synthetic user (`chintan-u22-smoke2@synthetic.test`), MY page silently became that user and `/api/auth/me` returned their workspace. (2) The founder's `workspaces.tier` row was flipped pro↔free by a sibling mid-smoke, so an archive I expected to 402 (`FREE_CAP_REACHED`) enqueued a REAL job against the founder's Gmail instead (caught: worker not running on my redis db; row deleted + redis db flushed). Mitigations that worked: re-run the dev-login immediately before each critical step; verify the precondition (`SELECT tier`) in the same breath as the UI action; enqueue-rejection paths leave no row, so `count(*)` before/after is the cheap tripwire; keep your unit's worker OFF unless the smoke needs execution.
**Rule (provisional):** In multi-agent smoke, treat `users.preferences`, `workspaces.tier`, and the browser session as VOLATILE — re-assert them immediately before every step that depends on them, and never trigger a real mutation path without first confirming the guard precondition still holds.
**Distillation trigger:** promote to CLAUDE.md §8 (smoke) if a shared-state race burns a third session (this is occurrence ~2 after the tier-flip collisions noted in sibling logs).

## 2026-06-26 — Three-pass agent review (compliance → adversarial → verify) finds what one pass misses
**Context:** Reviewing a 7-PR Fable-5-authored stack for merge-readiness, then taking it to production-ready.
**Finding:** A single review pass under-performs a layered one. Pass 1 (the repo's compliance gate agents — privacy/architecture/design/types) returned 0 blocking. Pass 2 (an adversarial workflow: 2 diverse lenses per PR — correctness/state vs security/guardrails — each finding independently re-verified by a fresh skeptic defaulting to "not real") found 4 verified HIGH defects + several real mediums, and the verify step correctly REFUTED a false positive (a claimed jsonb lost-update race). Pass 3 (re-review the fixed branches) confirmed each fix and surfaced one further medium (the ghost-pending TOCTOU) that only existed because of how the first fix interacted with the worker's 0-message branch — i.e. a fix created a new edge that a fresh adversarial read caught.
**Rule (provisional):** For merge-readiness on non-trivial PRs: (1) compliance gates for shape, (2) adversarial diverse-lens + self-verify for correctness, (3) re-review AFTER fixes (a fix can open a new edge). Lean on integration tests (PGlite + real migrations + real services) as the verification substrate when a live stack isn't available — they exercise the DB+service path faithfully.
**Distillation trigger:** promote to CLAUDE.md §7 (gate network) if the layered-review pattern keeps out-performing single-pass on ≥3 waves.

## 2026-06-29 — Security-regression sweep clean
**Context:** weekly automated sweep
**Finding:** all Section-2 hard rules held; 3 commits in last 7d, all guardrails intact
**Rule (provisional):** —
**Distillation trigger:** —

## 2026-07-01 — Stacked PRs + squash-merge: retarget base, rebase --onto, expect renamed seams
**Context:** Landing the #206→#219→#220 stack (tier enforcement → billing screen → screener) left over from the multi-agent buildout.
**Finding:** Three compounding traps. (1) Stacked PRs were based on the parent's BRANCH, so after the parent squash-merged, a plain `git rebase origin/main` replayed the parent's commits into conflicts — `git rebase --onto origin/main <parent-tip>` is the correct move, plus `gh pr edit --base main` or the merge fails with a stale-base conflict even when checks are CLEAN. (2) A sibling PR renamed a shared seam mid-stack (`lib/entitlements/free-cap` → `upgrade-gate` with a global MutationCache handler), so the child's per-hook `onError` import broke — the fix was deleting the child's wiring, not porting the import. (3) Worktrees pinned to pre-force-push tips silently rebase the OLD tip; `git switch -C <branch> origin/<branch>` first. Also real: web (Vercel) and api (Cloud Run) deploy independently, so new `/api/auth/me` fields must be optional-read on the FE (`TIER_MANIFEST[undefined]` blanked the whole shell in a test that reproduced the skew).
**Rule (provisional):** When finishing a stack after the parent squash-merges: retarget the PR base to main FIRST, `rebase --onto main <parent-tip>`, resync each worktree to origin, and grep the child for imports of files the parent/siblings renamed. FE reads of new `/me` fields get a `?? fallback`.
**Distillation trigger:** promote to CLAUDE.md §6 (naming/PR flow) if a second stack landing hits the same traps.

## 2026-07-01 — Dual ioredis resolutions masquerade as bullmq generics breakage
**Context:** Dependabot PR #236 (bullmq 5.34.0 → 5.79.2 in the 23-update minor-and-patch group) failed Typecheck with ~70 errors that LOOKED like a bullmq generics migration (`ExtractNameType`/`ExtractDataType` mismatches, `ConnectionOptions` rejecting our `Redis` instance).
**Finding:** Zero code changes were needed. bullmq pins ioredis EXACTLY (`"ioredis": "5.10.1"`), while our direct dep is a caret range — the group bump left the lockfile with ioredis 5.10.1 (bullmq's copy) AND 5.11.1 (ours). Two structurally-identical-but-nominally-distinct `Redis` classes (protected member `connecting`) fail assignability under `exactOptionalPropertyTypes`, and TS reports the mismatch through bullmq's generic aliases, which reads as an API break. `pnpm up ioredis@5.10.1 -r` (align to bullmq's exact pin) took the error count to 0.
**Rule (provisional):** When a dep bump produces "X is not assignable to X" errors naming the same type from two `node_modules/.pnpm/<pkg>@<ver>` paths, fix the version split first (`grep '<pkg>@' pnpm-lock.yaml`), and align to whatever the CONSUMER pins exactly — do not start migrating call sites. bullmq will re-split from us on future bumps because its ioredis pin is exact; expect this class of failure on the next group bump that touches either.
**Distillation trigger:** promote to CLAUDE.md §8 (or a dependabot runbook row) if a dual-resolution phantom breakage burns a second session.

## 2026-07-02 — Squarespace placeholder 200s every path: prod smoke must assert content, not status
**Context:** Post-merge prod verification of the legal pages (#199) and CSP (#201) during the merge-all pass.
**Finding:** `curl -w %{http_code} https://declutrmail.com/privacy` returned 200 and was initially read as "legal pages live" — but the apex is still the Squarespace placeholder (F10 cutover open), and Squarespace answers EVERY path with the same 1100-byte 200 page. The real app lives on app.declutrmail.com (Vercel), where a content-level check (`grep 'Full bodies fetched: 0'`) plus the CSP response header proved the actual deploy. Two adjacent lessons from the same pass: (a) Vercel marks a commit's production deployment CANCELED when a newer commit (the pr-merged log-flip bot commit lands seconds after every squash-merge) supersedes it — a CANCELED row for your merge commit is normal, not a failure; (b) the Cloud Run deploy's smoke step can fail on transient GH-runner DNS (`Could not resolve host …run.app`) while the revision serves fine — curl the service directly before assuming a broken deploy.
**Rule (provisional):** Prod verification = content assertion on the CANONICAL host (app.declutrmail.com until F10 cuts over), never a status code on the apex; treat Vercel superseded-CANCELED rows and Cloud Run smoke-step DNS flakes as verify-directly cases, not incidents.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table (prod row) if a placeholder-200 or superseded-deploy misread recurs.

## 2026-07-02 — TanStack refetchInterval pauses in unfocused windows: poll-driven UI stalls during browser-automation smokes
**Context:** Live-smoking the D159 core-loop funnel events (feat/d159-core-loop-events) by driving Chrome via MCP against the worktree's dev web server.
**Finding:** After confirming an Archive, the triage row stayed busy-grayed indefinitely and only ONE `GET /api/actions/:id` status poll ever fired, even though the worker had long finished (DB said `done 39/39`). Cause: TanStack Query's `refetchInterval` (default `refetchIntervalInBackground: false`) pauses whenever the window is unfocused — and a browser driven by automation tooling generally does NOT hold OS focus. Nothing was broken: a reload (or refocusing the window) picked up the terminal state instantly. The same applies to every poll-driven surface (action status, sync gate, undo revert polls).
**Rule (provisional):** During browser-automation smokes of poll-driven flows, verify server-side state (psql / API) before concluding a stall is a bug, and use a reload to resync the UI. Only conclude "stuck" if the state is wrong AFTER focus/reload.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table if an automation smoke misreads a paused poll as a hang again.

## 2026-07-03 — Locked design rules drift when they land on one surface and not its sibling
**Context:** Founder flagged Grid vs Table "feel like different products" + un-premium brand icons. Audit of the shipped Senders surfaces.
**Finding:** Three separate drifts, all the same shape: a decision was LOCKED and implemented on one surface while its sibling kept the pre-decision grammar. ADR-0016 A5 (one primary verb + ⋯ popover) shipped on the card, never on the table — ActionPopover's own docstring listed `sender-table.tsx` as a consumer that never materialized. The read-state "buckets, not raw %" rule (tightening brief) shipped on the table, never on the card. The trend tone map existed THREE times with `up` colored OPPOSITE ways (table amber, detail primary). Green gates caught none of it — each surface was internally consistent; the defect only exists BETWEEN surfaces.
**Rule (provisional):** When an ADR/decision changes a shared grammar (verbs, fact vocabulary, tones), grep for EVERY surface rendering that grammar and land them in one PR (ADR-0016 itself said this — "one PR per surface → drift guaranteed" — then A5 shipped per-surface anyway). A docstring "Consumed by:" list is a checklist, not documentation: verify each entry exists.
**Distillation trigger:** promote to CLAUDE.md §8 if a cross-surface drift ships again after a locked single-grammar decision.

## 2026-07-03 — Headless preview tab pauses TanStack retryer: error states unreachable in live smoke
**Context:** §8 smoke of the row-detail Recent-subjects wiring (PR #265). Tried to force the card's error state live by monkeypatching `window.fetch` to 500 the `/messages` calls before expanding a row.
**Finding:** The query stayed `isPending` forever — stuck after 2 fetch calls, never reaching the error state. Cause: the preview browser tab reports `document.visibilityState === 'hidden'` / `hasFocus() === false`, and TanStack Query's retryer pauses between retry attempts until the tab is focused (its `focusManager`/`onlineManager` gate `canContinue`). Dispatching synthetic `focus`/`visibilitychange` events after redefining `visibilityState` did NOT resume it. A real focused window exhausts the 3× backoff in ~7s and lands in the error state as designed.
**Rule (provisional):** In headless preview smokes, don't burn time trying to reach retry-gated error states live — a paused retryer looks identical to an app bug (spinner forever). Verify loading/ready/parity live; trust unit tests + Storybook for error/empty, and say so in the PR's smoke notes.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table if a second session loses time to the same freeze.

## 2026-07-03 — Controlled inputs tied to heavy screens eat keystrokes; synthetic-event repros lie
**Context:** Founder-reported "can't type more than a letter" in the senders search box (PR #271). The input was fully controlled by `SendersScreen` state — every keystroke re-rendered the 2,254-line screen incl. 50 cards.
**Finding:** Any React commit that lands later than the next keystroke re-asserts a stale `value` onto the DOM input and silently reverts natively-typed characters ("chase" → "cha", reproduced live). Two traps while diagnosing: (1) `startTransition` alone does NOT fix it — the local echo batches with the slow host render; (2) synthetic `Event('input')` + native-setter harnesses race differently from trusted key events AND a concurrent Fast-Refresh error can kill the test's timeout chain mid-run, mimicking the bug (chased a stale-HMR `ReferenceError` for two rounds). Playwright `keyboard.type` was the only faithful harness.
**Rule (provisional):** Text inputs on screens with expensive renders must be semi-controlled — DOM value from local state, host notified on a short debounce; never per-keystroke. Repro/regression-test typing bugs with real keyboard events (Playwright), not dispatched `input` events.
**Distillation trigger:** promote to CLAUDE.md if a second controlled-input surface (screener search, domain filter) regresses the same way.

## 2026-07-03 — Dark mode via var()-indirected tokens: one file flips the app, but literals are the tax
**Context:** Founder asked for dark mode (PR #271). Entire design system renders through inline styles reading `tokens.color.*` literals.
**Finding:** Rewriting `tokens.ts` values as `var(--dm-*)` references (palettes in tokens.css under `[data-theme]`) themed every component with zero component edits — including SSR markup, since vars resolve at paint. The whole cost concentrated in ~40 hardcoded literals that had drifted PAST the token system: `#FFFFFF` text on token fills (invisible once dark brightens the fill), ink-alpha `rgba(14,20,19,…)` washes/bars (vanish on dark), and 11 `var(--color-*)` reads that were never defined anywhere. Scrims/shadows could stay literal (dark-on-dark is fine).
**Rule (provisional):** For themes: token VALUES become var() references; audit for (a) literal text colors paired with token backgrounds — they must use the fgInverse family, (b) raw ink-alpha rgba washes — they must use line/border tokens. Non-DOM renderers (Satori OG images) must keep literals.
**Distillation trigger:** promote alongside a `check-microcopy`-style lint (`no-literal-ink` rule) if literals reappear in review twice.

## 2026-07-03 — cloud-seed.sql leaves onboarded_at NULL: cloud smokes bounce to /onboarding
**Context:** §8 live smoke of the verb-tone fix (fix/d049-lead-cta-verb-tones) via cloud-smoke.sh + Playwright against /senders.
**Finding:** Every /senders visit silently redirected to /onboarding step 4 — all lead-CTA locators timed out with zero errors. Cause: `useOnboardingGate` bounces any user with `users.onboarded_at IS NULL`, and `scripts/cloud-seed.sql` seeds the founder user without setting it. The gate's own docstring carries the backfill: `UPDATE users SET onboarded_at = now() WHERE …` — one statement fixes the whole smoke. (Also hit: root-owned /tmp/dmlogs breaks `runuser -u postgres` initdb logging on a fresh container — `chmod 777 /tmp/dmlogs` first.)
**Rule (provisional):** After `cloud-smoke.sh seed`, set `onboarded_at` on the seeded user before browser smokes of authed app routes (or fix cloud-seed.sql to do it — founder call, it may want to smoke onboarding itself).
**Distillation trigger:** fold into scripts/cloud-smoke.sh seed step if a second session trips on the redirect.

## 2026-07-05 — Security-regression sweep clean
**Context:** weekly automated sweep
**Finding:** all Section-2 hard rules held; 45 commits in last 7d, all guardrails intact
**Rule (provisional):** —
**Distillation trigger:** —

## 2026-07-04 — Headless preview tab never runs IntersectionObserver callbacks (2nd rendering-steps trap)
**Context:** live smoke of the senders infinite-scroll sentinel (ADR-0025 `infiniteScroll` flag). Sentinel visible, scrolled into view, no fetch; even a hand-rolled probe IO's callback never fired (30s timeout).
**Finding:** IO callbacks run during the browser's rendering steps; the preview tab reports `visibilityState === 'hidden'` and performs NO rendering steps, so IO never fires — same root cause as the 2026-07-03 TanStack-retryer freeze. Anything gated on rendering steps (IO, rAF, ResizeObserver) is untestable live in this harness.
**Rule (provisional):** Smoke scroll/visibility-triggered behavior via a unit test that drives the observer callback by hand; live-verify only the non-IO half of the chain (manual button → fetch → append). Say so in the PR smoke notes.
**Distillation trigger:** 2nd instance (retryer 2026-07-03, IO 2026-07-04) — promote a "headless preview cannot execute rendering-steps callbacks (IO/rAF/retryer)" line to CLAUDE.md §8 smoke table.

## 2026-07-07 — Page-level `openGraph` config silently drops the file-convention og:image
**Context:** D132 SEO batch — adding per-page canonical + openGraph + twitter metadata to /pricing, /privacy, /terms, /refunds (pattern copied from the landing page).
**Finding:** Next's metadata merge shallow-REPLACES the whole `openGraph` object per segment: `app/opengraph-image.tsx` attaches its image to the ROOT segment's metadata, so any page exporting its own `openGraph` (even without `images`) loses og:image + twitter:image entirely. Confirmed against a prod build (dev + prod behave the same). The landing page had shipped this way — no og:image since its openGraph block landed. Metadata unit tests can't catch it (the gap only exists in the RESOLVED head, not the config object); a curl of the built HTML found it immediately.
**Rule (provisional):** Any marketing page that declares `openGraph` must pin `images` explicitly — build page metadata via `features/marketing/page-metadata.ts` (`marketingPageMetadata()`), never a hand-rolled block. Smoke og:image with curl on the prod build whenever page metadata changes.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table if a page ships without og:image again despite the helper.
## 2026-07-07 — posthog-js silently drops ALL captures from automated browsers (bot filter)
**Context:** D147 consent-gate smoke + Playwright spec. After "Accept all" the SDK initialized (config/flags requests, ph_* storage written) but no capture EVER left the browser — no error, no log, nothing to intercept.
**Finding:** posthog-js `capture()` returns early for a "likely bot" (`isLikelyBot`): UA blocklist (contains `headlesschrome`), `userAgentData.brands`, and — decisive — `navigator.webdriver`, which is ALWAYS true under Playwright, headed or not. So an analytics e2e can never see events without countermeasures, and worse, a NEGATIVE assertion ("declined ⇒ zero posthog requests") passes vacuously against a broken gate. Neutralizing all three signals (UA override + init-script `webdriver`/`userAgentData` shims) made captures flow; found via `ph_debug` localStorage flag + reading dist source maps (`sourcesContent`) for the drop condition.
**Rule (provisional):** Any spec asserting analytics traffic (positive OR negative) must spoof non-bot signals first (see `packages/e2e/specs/cookie-consent.spec.ts`), and should pair network assertions with `ph_*` storage-artifact assertions, which survive transport quirks.
**Distillation trigger:** promote to CLAUDE.md §8 smoke table if a second analytics-observing spec trips on the bot filter.

## 2026-07-08 — Optimistic intent rows must use uncertain copy; confirmation is a separate row (D9/D226)
**Context:** wiring the `unsubscribe_confirmed` activity enum (PR #301). A one-click unsubscribe writes an intent row at click time (`actions.service`) and the worker writes an outcome row after the RFC 8058 POST.
**Finding:** Two latent honesty/correctness bugs hid in the pre-existing flow, both because the intent + outcome rows shared the `unsubscribe` action + the past-tense label "Unsubscribed": (1) a SUCCESSFUL one-click unsub wrote TWO `unsubscribe` rows → `stats.unsubscribed` double-counted every one; (2) a FAILED POST still left the intent row labeled "Unsubscribed" → a failure read as success (D9 says "Activity row records *attempt* not success ... UI copy is deliberately uncertain — never promise"). Relabeling only the worker's success row to `unsubscribe_confirmed` fixed the double-count but NOT the failed-shows-success — the INTENT row's "Unsubscribed" label was the remaining lie (caught by a Codex stop-review, not by the gates or my first pass). Fix: intent row = "Unsubscribe requested" (the attempt), outcome row = "Unsubscribe confirmed" (the only success claim, written only on 2xx).
**Rule (provisional):** When an action is async/uncertain (a POST that can fail, a manual mailto), the optimistic row written at intent time MUST use attempt/uncertain copy — never a past-tense completion. The success claim belongs on a SEPARATE outcome row written only when the outcome is actually known. Aggregate stat tiles counting intent rows are a softer overclaim — flag the metric definition rather than silently redefine it.
**Distillation trigger:** promote to CLAUDE.md §2/§10 (fake-completion) if a third optimistic-success-copy bug ships.

## 2026-07-09 — Secondary screens shipped without a responsive branch → overflow at 375px
**Context:** Wave-2 responsive audit fix — brief, followups, snoozed rows (and the app-shell topbar) used fixed multi-column `gridTemplateColumns` with `minmax` floors (e.g. `minmax(180px,1fr) minmax(220px,2fr) …`) and no `useIsAtMost`/matchMedia branch, so their combined floors exceeded a 375px viewport and clipped content. The topbar's `flexShrink:0` right cluster (sync freshness + "Sync now" + account switcher) pushed the mailbox switcher's right edge off-screen — a phone user couldn't switch/disconnect/reconnect mailboxes (§8 multi-mailbox lifecycle broken on mobile).
**Finding:** The fix mirrors the established pattern (triage-row.tsx, senders/table/sender-list-row.tsx): resolve `const isMobile = useIsAtMost('sm')` once at the screen root, thread it to the rows, and branch `gridTemplateColumns` to `auto 1fr` / `1fr` with the trailing cells spanning `gridColumn:'1 / -1'` below the breakpoint. The `sm` token (900px) is aligned across `useIsAtMost` and the shell's tokens.css media query, so the restack switches exactly when the sidebar collapses to the hamburger. For the shell topbar the collapse is CSS-driven via co-located inline `<style>` media queries (the SyncNowAnimationStyle precedent) rather than a JS hook, so there's no post-hydration flash — matching the AppShell's CSS-driven-responsive rationale. Autopilot + quiet were audited the same way and found already-responsive (flex-wrap everywhere), so they got no code changes.
**Verification without the preview MCP:** the preview/CDP MCP wasn't available and the authed app shell needs a backend + seeded mailboxes, so the layout math was verified in the pre-installed Chromium via Playwright (`executablePath: /opt/pw-browsers/chromium-1194/...`, version-mismatched bundled shell). A faithful transcription of each row's post-fix inline styles (with deliberately over-long content) measured `document.scrollWidth == innerWidth == 375` and switcher `right <= 375`; the same harness run against the PRE-fix markup overflowed (636/702/634/502px), proving it detects the failure it claims to rule out.
**Rule (provisional):** Any new feature screen with a multi-column row grid must ship a `useIsAtMost('sm')` restack branch from day one (the 5 golden screens + triage + senders already do). When the preview MCP is unavailable, verify responsive/overflow fixes by measuring `scrollWidth` at the target width in the pre-installed Chromium via Playwright, and prove the harness against the pre-fix markup so a vacuous pass is impossible.
**Distillation trigger:** promote a "screens with row grids need a `useIsAtMost('sm')` restack branch" line to CLAUDE.md §6/UI-Constitution if a 3rd screen ships without one (triage W1 was the 1st audit; this is the 2nd).

## 2026-07-13 — Dual-ioredis phantom recurred exactly as predicted; caret range is the recurrence engine
**Context:** Dependabot minor-and-patch group PR #326 (superseded mid-fix by #330 — the weekly run closed it) failed Typecheck with the same ~70-error storm as #236: `Redis is not assignable to ConnectionOptions` at every Queue/Worker construction plus `ExtractDataType`/`ExtractNameType` Queue-generic mismatches. bullmq 5.79.2 → 5.80.2 DID land a real Queue-generics refactor (3 → 6 type params) in this bump, which made the storm look like a genuine API break requiring call-site migration.
**Finding:** Still 100% the 2026-07-01 dual-resolution phantom — zero code changes needed. A minimal single-file repro (`new Queue<Data>()` assigned to `Queue<Data>`) FAILED against the split tree (ioredis 5.10.1 for bullmq + 5.11.1 for our caret deps) and PASSED bit-identical once the lockfile held a single ioredis@5.10.1. Even the "unreduced conditional default" errors that name-drop bullmq's new generics are downstream of the nominal `Redis` split, not of the generics refactor. A `createQueue` factory + 28 call-site edits were built on the misdiagnosis and reverted after the repro was re-run against the aligned tree — re-verify any minimal repro AFTER fixing the version split, because the repro itself is contaminated by the split. The #241 fix (lockfile-only realign, spec left at `^5.10.1`) guaranteed this recurrence: dependabot's group bumps re-resolve in-range lockfile entries, so every weekly run re-splits ioredis while bullmq pins it exact. This time the spec is pinned exact (`"ioredis": "5.10.1"`) in apps/api + packages/workers, so dependabot can only move ioredis via an explicit package.json bump PR — which fails typecheck loudly if bullmq's pin hasn't caught up.
**Rule (provisional):** When a dep the codebase shares with an exact-pinning consumer (bullmq→ioredis) fails typecheck with "X not assignable to X", align the lockfile AND pin our spec to the consumer's exact version; a caret range next to an exact-pinning consumer is a standing re-split invitation. Never trust a "real API break" diagnosis made against a split tree.
**Distillation trigger:** third occurrence — promote a dependabot-runbook row ("group bump red on Typecheck ⇒ grep pnpm-lock for dual resolutions FIRST") to CLAUDE.md §8 now; founder's call.

## 2026-07-15 — Data migrations racing still-deployed old workers: encode the new rule as self-healing, not migration-only
**Context:** D245 tuning — the `gmail_important` auto-protect signal was narrowed to Primary-category senders, with migration 0045 demoting the 176 non-primary protections. During the dev smoke, the demotion was applied while the OLD worker process (pre-gate code) was still running; it executed a sync at the moment of the dev-up restart and silently re-protected all 176 rows under the old rule — caught only because the post-smoke state query re-ran.
**Finding:** Prod has the identical window structurally: "Migration apply" completes in ~22s while the Cloud Run deploy takes ~4min, so an old-code worker can process a sync between migration and deploy and resurrect exactly the rows the migration just cleaned. A data migration that removes rows an old writer still knows how to write back is not a fix — it's a race entry. The durable fix: the sweep (`applyAutomaticProtection`) now reconciles first (withdraws sweep-authored importance protection from non-Primary senders) before escalating, so any stale-worker resurrection is undone by the next new-code sweep, and later Gmail category drift self-corrects too. The migration remains for the write-once legacy classes (engagement_based/vip) that no current code path writes.
**Rule (provisional):** When a rule change demotes/deletes state that the OLD code actively (re)writes, ship the reconciliation IN the new writer (idempotent, every run), and reserve the data migration for state no current writer produces. Verify by re-querying the cleaned state AFTER services restart, not just after the migration applies.
**Distillation trigger:** promote to CLAUDE.md §8 (smoke table / migration PR additions) if a second migration-vs-old-writer race ships.

## 2026-07-20 — The money-path e2e spec rots silently when it isn't in CI
**Context:** D117 upgrade-flow redesign (PR #367). DoD required the billing-upgrade Playwright spec green. First run failed twice for reasons that predated the branch: (1) PR #362's signed custom_data attribution made the spec's synthetic webhook 503 BILLING_WEBHOOK_UNRESOLVED (helper sent unsigned attribution); (2) two stale copy selectors ("Archive <n>" confirm button, "cleanup actions" modal title) that shipped copy changes had orphaned. The spec needs a dedicated stack (:4183/:3183 + billing env), so nothing runs it automatically and no one had re-run it since those changes merged.
**Finding:** A spec that guards the revenue path but requires manual bring-up gives a false sense of coverage — both breakages were on surfaces "protected" by the spec. Repairs: e2e helper now signs attribution exactly like paddle.adapter.ts (`paddleAttributionSig`), selectors match shipped copy, and the spec now also asserts the deep-link funnel (UpgradeModal CTA → /billing?plan=…&cycle=… with the D226 confirm open).
**Also learned:** cloudflared QUICK tunnels rotate hostnames per restart, so the Paddle sandbox notification destination silently goes stale; `curl 127.0.0.1:20241/quicktunnel` + the tunnel request counter tell you in seconds whether provider webhooks can even arrive before you burn time debugging the app.
**Rule (provisional):** After any change to webhook auth/attribution or user-facing copy on the money path, re-run the billing-upgrade spec the same day; before any sandbox-purchase smoke, verify the tunnel hostname against the Paddle destination first.
**Distillation trigger:** promote a "billing e2e must run in CI (dedicated job with its own stack)" item if this spec is found rotten a 2nd time.

## 2026-07-26 — Retiering a capability can wake a dormant concurrency bug
**Context:** A3 `/grill-me` session. Among the decisions: move the `multi-sender` (explicit bulk) selector from `tier: 'plus'` to `tier: 'free'`, so Free's 50/month quota is its only gate. Codex stop-time review flagged "Free bulk can exceed its monthly quota under concurrent requests" against a change that had not been written yet.
**Finding:** Correct, and dormant only by accident of the tier map. `actions.service.ts` has two cleanup-enqueue paths with different concurrency discipline. The single-sender path (`:243-252`) runs `db.transaction` → `lockCleanupWorkspace(…, tx)` → capacity check → `insertJob`, all on one transaction, so the workspace `FOR UPDATE` is held across count and write. The bulk path (`:920`) calls `assertCleanupCapacity` with the DEFAULT root executor and no transaction — the service's own docblock warns that "its statement-scoped lock cannot serialize a later separate write" — and its replay check sits outside the lock too. Two concurrent bulks both read `used`, both pass, both insert N. It cannot fire today ONLY because `assertCleanupCapacityForWorkspace` early-returns on `limit === null` and `multi-sender` required Plus, so every caller that could reach the unlocked path had an unlimited quota. Moving the selector to Free routes the sole finite-quota tier onto it, with an overrun of N units per racing request instead of 1.
**Rule (provisional):** A tier/entitlement retier is not a config-only change. Before moving a capability into a tier that carries a FINITE limit, grep every code path that capability unlocks for quota checks that early-return on `limit === null` — those paths have never been exercised under a limit, so their concurrency, replay, and error handling are all unverified by construction. Diff the transaction discipline of the newly-reachable path against a path that was already reachable under the limit.
**Distillation trigger:** promote to CLAUDE.md §2 or the §8 smoke table if a second entitlement move exposes an unexercised path; the general shape ("guard whose only observed answer was the trivial one") is the same class as the 2026-07-26 infra findings, so it may fold into that guardrail instead.

## 2026-07-27 — Readiness must key on fetch state, never data presence
**Context:** Finding 5.3 — every confirm surface derived "live preview ready" from `data !== undefined`/`isLoading`, so a reopened modal armed on a CACHED preview while the refetch was in flight (TanStack v5: `isLoading = isPending && isFetching` is false on a cache hit).
**Finding:** Four surfaces (senders modal, sender detail, triage sheet + inline, screener) shared the bug because each re-derived readiness locally; none consulted `isFetching`.
**Rule (provisional):** A gate that authorizes a mutation must read the QUERY LIFECYCLE (`isFetching` settled), not the presence of data; and a readiness predicate used by >1 surface belongs in one place.
**Distillation trigger:** promote to CLAUDE.md §8 if a cached-data-arms-action bug recurs.

## 2026-07-27 — A quota's counting rule must survive every selector it can reach
**Context:** A3 opened the messages selector to metered Free. The cleanup counting derivation grouped sender-selector rows by (composite, senderId) but let messages-selector rows fall back to their OWN row id — so one composite click counted 2 units the moment Free could reach it.
**Finding:** A counting rule written when a path was unreachable silently became wrong when entitlements moved; the unit invariant ("one click, one sender, one unit") was only tested on the selectors the old tiers could use.
**Rule (provisional):** When a tier change makes a code path newly reachable, re-run that path's INVARIANTS, not just its happy tests — reachability is a semantic change.
**Distillation trigger:** promote if another entitlement move exposes a dormant-path bug.

## 2026-07-27 — Rendering the classification, not the sentence, caught three copy bugs
**Context:** Fixing the "71 /mo above five zero chips" preview bug across the senders
confirm modal and the screener decide preview.
**Finding:** Splitting the helper into `describeInboxScope` (returns a discriminated
union) and `inboxScopeNoticeCopy` (renders it) paid off three times in one session.
Because the classification was data, the modal could branch LAYOUT on it — suppressing a
window chip row whose five zeros no choice could change — while the screener rendered
the same kind as one line. And because the screener passes `olderThanDays: null`, the
`empty-window` branch is unreachable there by construction, so a surface with no window
control can never render "widen the window" copy. Three copy defects only became
visible once real data flowed through it in a live smoke: `All 1 that arrived … are`,
`Nothing from this sender` on a 13-sender bulk sheet, and — worst — naming the PRIMARY
verb on a composite, which produced the flatly false "Unsubscribe only acts on mail
still in the inbox" about the one verb that never touches inbox mail.
**Rule (provisional):** Return the classification, not the string. Then smoke every
cardinality (0 / 1 / many) and every composition (single / composite / bulk) against
real data — unit tests written from the same mental model as the code will not catch a
sentence that is grammatical and false.
**Distillation trigger:** promote to CLAUDE.md §8 if a third copy-truth defect survives
green tests and is caught only by live smoke.

## 2026-07-28 — The local mirror inside the terminal transaction is a free pre-state snapshot
**Context:** ADR-0028 all-mail Delete needs undo to restore each message to where it
was (inbox vs archive), which requires knowing which resolved ids carried INBOX at
forward time — durably, across worker retries.
**Finding:** No new column was needed. The label worker only rewrites the local
`mail_messages.label_ids` mirror inside the SAME transaction that inserts the undo
journal row, so a SELECT on the mirror at journal-build time — before the UPDATE
statement in that transaction — reads the pre-action state even when Gmail was already
mutated by a crashed prior attempt. Atomicity makes the mirror a durable snapshot for
free; the only loss window is an incremental sync overwriting the mirror during the
narrow crash-retry gap, which degrades (restore to archive) but never destroys.
**Rule (provisional):** Before adding a column to preserve pre-mutation state, check
whether an existing mirror is rewritten atomically WITH the consumer of that state —
transaction ordering may already preserve it.
**Distillation trigger:** promote if a second feature derives pre-state from the
mirror's tx ordering.

## 2026-07-31 — A browser-automation tab is `hidden`, so the entry `$pageview` never fires

**Context:** smoking the PostHog capture change on main. `$pageview` fired for the route I navigated to, but not for the page I arrived on — which reads exactly like "the entry pageview is missing, Web Analytics will undercount". I reported it as a defect.
**Finding:** posthog-js has two pageview capture sites. The history-change one fires on navigation; the INIT one is gated on `document.visibilityState === 'visible'` and defers until the page becomes visible. The preview/automation tab reports `visibilityState: "hidden"`, `hasFocus: false` — so that capture legitimately never ran. Overriding `visibilityState` and dispatching `visibilitychange` made the entry `$pageview` appear immediately, for the entry URL, scrubbed. No product defect existed; the harness manufactured it. Same family as the known TanStack `refetchInterval` focus pause.
**Rule (provisional):** before reporting "event X never fires" from a browser smoke, check `document.visibilityState`. Anything gated on visibility, focus or `requestIdleCallback` is suspect in an automation tab — force the state and re-observe before writing it up.
**Distillation trigger:** promote to CLAUDE.md §8 with the focus-pause note if a third visibility/focus-gated false positive appears.

## 2026-07-31 — A grep over a compressed payload is vacuously clean

**Context:** verifying that the `/flags/` privacy fix stopped an address reaching PostHog. The leak check printed "CLEAN — no address, no sender_q in any payload".
**Finding:** it proved nothing. posthog-js had switched that batch to gzip, so the log held compressed bytes and the pattern could not have matched whether or not the address was there. Worse, the echo server was accumulating the body with `body += chunk`, which utf-8-mangles binary and destroys the gzip irrecoverably — so even decompressing afterwards failed, and a "0 matches" still printed. Fixing the server to collect Buffers and `gunzipSync`, then asserting `decoded > 0` BEFORE trusting the search, turned the same check into real evidence (4/4 payloads decoded, genuinely clean).
**Rule (provisional):** any assertion of absence must first prove its input was readable. Print the count of successfully parsed records next to the verdict, and treat `parsed == 0` as INVALID, never as PASS.
**Distillation trigger:** this is the BLIND-GUARD class again (a check that appears to verify and does not) — fourth occurrence. A CLAUDE.md §8 line is now overdue.

## 2026-08-10 — Injecting an error into a story requires retryOnMount: false

**Context:** Storybook stories for error states drive the REAL query hooks
by prefetching a rejection onto the exact cache key (the snoozed-screen
pattern). A new story injected `{ code: 'NO_ACTIVE_MAILBOX' }` to render
the designed 409 state — and rendered the generic error instead.
**Finding:** an ERRORED query is refetched on mount by default
(`retryOnMount: true`, unaffected by `refetchOnMount: false`). The mounted
hook's own queryFn then runs against Storybook's absent API, fails with a
404/network error, and the component renders THAT error — the injected
value never survives to the branch under test. Every existing error story
only looked correct because any error reaches its single generic error UI.
**Rule (provisional):** a story client that injects errors pins
`retryOnMount: false` alongside `retry: false`; and an error story for a
surface with MORE than one error branch must assert the branch-specific
copy, not just "an error rendered".
**Distillation trigger:** promote to a shared `storyClient()` helper if a
third story file hand-rolls the same defaults block.

## 2026-08-11 — Two more blind guards, both from checking a tool the wrong way

**Context:** building the gate-network workflow. Two verification steps in one
session appeared to pass and had verified nothing — the same class LEARNINGS
already logs at four occurrences.

**Finding:** (1) `node --check .claude/workflows/gate-network.js` reported
`SyntaxError: Illegal return statement`. The script is fine; the Workflow runtime
wraps the body in an async function, where top-level `return` is legal, and a bare
ESM parse is simply not that environment. Wrapping the body before checking gave
the true answer. A harness that differs from the runtime produces confident,
inverted results — here a false alarm, but the same mismatch just as easily hides
a real error. (2) `pnpm generate-impl-log >/dev/null 2>&1; git diff` showed no
diff, which I first read as "the log is current, the CI failure is not mine". The
generator had actually exited 3 — `gh` is absent in the web container, and it
refuses to compute rather than silently demote every derived row. Its loud,
well-designed failure was invisible because I had redirected it and then read
`$?` from `tail` in a pipeline instead of from the command.

**Rule (provisional):** two halves of one rule. Check a script with the harness
that will actually run it, not the nearest available parser. And never infer
success from a side effect that absence-of-output can mimic — read the command's
own exit status and message, not a pipeline's, and treat "no output, no diff" as
*unknown* until the tool has said something.

**Distillation trigger:** this is the BLIND-GUARD class for the fifth and sixth
time, and the 2026-07-31 entry already called a CLAUDE.md §8 line overdue at four.
Promote now — a §8 sentence along the lines of: *a check that cannot show what it
inspected has not run; print the evidence next to the verdict and treat an
unproven input as INVALID, never as PASS.*

## 2026-08-12 — I reported a capability limit I never tested

**Context:** verifying whether a real $9 production Paddle purchase had actually
been ingested by our webhook. I checked `.env.local`, found only the dev
`DATABASE_URL`, and told the founder "no prod DB pointer locally, so I can't
check" — handing them a query to run themselves. They pushed back: *you already
have Supabase connected, why can't you run queries, do gcloud log lookup etc.*

**Finding:** three separate prod-read paths existed and I had probed exactly one
— the weakest.

- `.env.local` → dev only. True, but it is not where prod access lives.
- `gcloud` → authed as `admin@declutrmail.ai` on `declutrmail-ai-prod`, and
  `secrets-inventory.md:152` documents the prod DSN at Secret Manager
  `database-url-prod`. Two real blockers, neither the one I reported: the
  permission classifier denies reading a prod credential, and the auth token had
  expired needing an interactive `gcloud auth login`.
- **Supabase MCP → authed and working.** `list_projects` returned
  `declutrmail-prod` (`hewwqjkvrngxbihciewr`) and `execute_sql` answered the
  question in two calls. This is the prod read path for this repo.

The answer took ~90 seconds once I looked. The founder had been asked to do it
manually for no reason.

**Rule (provisional):** "I can't reach X" is a claim about the world and needs
the same evidence as any other finding — enumerate every configured path and
*try* the plausible ones before reporting a limit. One negative probe is not a
limit, it is one negative probe. And state the blocker that actually fired: here
"blocked by the permission classifier" and "gcloud token expired" are both
actionable by the founder, while my "no local DATABASE_URL" was true, useless,
and pointed at the wrong fix.

Concretely for this repo: **prod reads go through the Supabase MCP**
(`declutrmail-prod` = `hewwqjkvrngxbihciewr`), not psql + Secret Manager.

**Distillation trigger:** this is the BLIND-GUARD family again — a verdict
issued without inspecting the input — but pointed at my own tooling rather than
at a script. The §8 line already queued for promotion covers it if worded to
include capability claims: *an unproven input is INVALID, never PASS* extends to
an unprobed tool being UNKNOWN, never UNAVAILABLE. Promote to CLAUDE.md §8
alongside the existing overdue line if this recurs once more.

## 2026-08-14 — A dev server writing `.next` corrupts a concurrent production build
**Context:** measuring `experimental.optimizePackageImports` on the marketing
bundle. `next build` was run while `next dev` was still up from an earlier
smoke, both pointed at `apps/web/.next`.
**Finding:** `next start` against that build threw
`EvalError: Code generation from strings disallowed for this context` from the
edge middleware on every request — 500s across all 19 public pages. It looked
exactly like a real regression caused by the config change. It was not: with the
dev server stopped, the same config builds and serves cleanly, and so does the
baseline. The dev server had been rewriting `.next` under the build.
**Rule (provisional):** stop `next dev` before `next build` when both target the
same app, and A/B any suspected build regression by rebuilding BOTH sides from a
quiet tree before believing either result.
**Distillation trigger:** promote to CLAUDE.md §8 if a session again attributes a
build failure to a code change that a quiet-tree rebuild clears.

## 2026-08-14 — An axe scan that starts at first paint measures the animation, not the page
**Context:** adding a public-route accessibility lane. The desktop project
(motion enabled) reported a serious colour-contrast failure on
`.dm-mkt-hero-note`; the mobile project (reduced motion) did not.
**Finding:** the element is fine — it settles at 5.11:1 light and 6.04:1 dark,
over the 4.5:1 floor. The landing reveals fade over 0.7s with up to 0.24s of
stagger and the hero sequence runs `8s 1 forwards`, so a scan triggered as soon
as the `h1` is visible sampled a partially transparent element and reported its
blended colour. A ready signal that proves *content exists* does not prove
*presentation has settled*.
**Rule (provisional):** for any axe lane over an animated surface, emulate
`prefers-reduced-motion: reduce` — it takes the global override in
`tokens.css:386` and scans the settled state, which is what contrast rules
govern — or explicitly await the animations. Verify by running the matrix twice
and requiring identical results.
**Distillation trigger:** promote to CLAUDE.md §8 if a third timing-dependent
gate ships with a ready signal weaker than the property it asserts.

## 2026-08-15 — A dynamic route in Next ships an empty `<head>`
**Context:** Building D160's never-built Lighthouse gate. `/` and `/pricing` scored SEO 91 while `/security` and `/how-to/*` scored 100. The failing audit was `meta-description` — on pages whose metadata is demonstrably present.
**Finding:** The tags are emitted, just not in `<head>`. Measured on a production build: on `/`, `<title>` and `<meta name="description">` land at byte ~37,800 while `</head>` closes at byte ~2,045. Next defers ALL metadata past `</head>` on a DYNAMIC route, for React to hoist during hydration — `og:title`, `og:image`, `twitter:card` and `rel=canonical` too. Google executes JS and copes. X, LinkedIn, Slack and Discord do not: they read raw `<head>` and stop, so every share of the homepage rendered a blank card. Moving the per-request read into a `<Suspense>` boundary does NOT help — the deferral follows the ROUTE being dynamic, not the component tree (verified: still deferred). So it is binary per route.
**Rule (provisional):** Any public page that gets shared as a link must be statically rendered, full stop — a per-request read costs it every `<head>` tag, not just its cache. Assert it: the static URLs in `lighthouserc.cjs` are pinned at `seo: 1.0` precisely because `meta-description` drops the score to 0.91 the moment metadata leaves the head, which is the cheapest available detector for this.
**Distillation trigger:** promote to CLAUDE.md §8 if a second SEO/meta regression ships from a rendering-mode change.

## 2026-08-15 — `assertMatrix` in the wrong place is a gate that passes everything
**Context:** Adding per-URL Lighthouse thresholds so the static pages could be held to a stricter SEO floor than dynamic `/pricing`.
**Finding:** `assertMatrix` belongs at `ci.assert.assertMatrix`. Placed one level up at `ci.assertMatrix` it is silently ignored: `lhci autorun` runs the collection, prints "Done running autorun", and **exits 0 having asserted nothing** — no warning, no "0 assertions" line, and the run looks identical to a passing one. Only `lhci assert` standalone says anything at all ("No assertions to use"). It was caught by a positive control — raising a threshold above the measured value and checking for a non-zero exit — not by reading the output, which was indistinguishable from success.
**Rule (provisional):** A newly added gate is not proven by a green run; it is proven by a red one. Always run a positive control — move a threshold past the measured value and confirm a non-zero exit — before claiming a check gates anything. Applies equally to lint rules, CI assertions and hooks.
**Distillation trigger:** promote to CLAUDE.md §8 "Definition of done" if a second silently-inert check is found.
