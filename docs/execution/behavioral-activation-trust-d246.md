# D246 — Behavioral activation and calibrated trust

Status: Accepted for implementation — 2026-07-15

Branch: `codex/d246-behavioral-activation-trust`

## Outcome

Help a new user reach one small, truthful cleanup result without turning their
mailbox into another infinite obligation. Then help the user grant automation
more authority only after its observed behavior matches their intent.

The program optimizes for relief, comprehension, and calibrated reliance. It
does not optimize for time in app, streaks, raw messages moved, or maximal
automation adoption.

## Scope decisions

### D246.1 — Resolve the launch-plan mismatches

- Brief generation uses the owning user's IANA timezone and materializes the
  local day's Brief only after 08:00. UTC is the documented fallback when no
  valid timezone is stored.
- Browser push is evidence-gated post-beta. The app must not request browser
  notification permission without a complete subscription and delivery path.
  Sync-ready email remains the launch notification.
- Offline mail-changing actions are not persisted in browser storage. The app
  remains explicitly online-only and preserves inputs for an immediate retry;
  server idempotency, queue retries, and Activity remain the recovery contract.
- These are explicit supersessions of D163 and the queued-action portion of
  D171. Native mobile, mobile push, and PWA cached views remain V2.1+.

### D246.2 — First relief is finite and user-directed

- Onboarding asks for one current goal: reduce newsletters, protect important
  senders, or clear old promotions.
- The goal chooses the initial explanation and ordering, never an automatic
  mail-changing action.
- The first session contains at most five real sender decisions and has a clear
  completion state. It may end early when fewer eligible senders exist.
- Completion copy says the user is done for today and offers a voluntary next
  step. It does not present Inbox Zero, a streak, guilt, or a fabricated time
  saving.

### D246.3 — Measure relief and trust, not activity volume

The closed analytics contract records only bounded enums, booleans, counts,
and durations. It never records email addresses, subjects, provider IDs,
capability tokens, or message content.

Required funnel and guardrail events:

- activation goal selected;
- first-relief session started and completed;
- first confirmed action and session decision count;
- user-labelled expected or surprising automation outcome;
- weekly review viewed;
- pattern suggestion shown and decided.

Undo, recovery, protected-sender conflicts, manual overrides, and surprising
outcomes are guardrails. Raw messages moved and time in app are not success
metrics.

### D246.4 — Automation authority increases through evidence

- Existing Observe mode remains the default trust boundary.
- After a bounded repeated-decision threshold is met, DeclutrMail may propose
  one narrow preset-compatible if–then pattern using observed facts.
- The proposal states the trigger, action, scope, evidence count, exclusions,
  and recovery path. It starts in Observe and never silently activates.
- Expected/surprising feedback is available on automatic Activity outcomes.

This does not reverse D197. The general custom-rule builder, arbitrary AND/OR
conditions, and new Gmail scopes remain evidence-gated V2.1 work.

### D246.5 — Weekly review is factual and in-app first

- The review summarizes completed, skipped, failed, recovered, and protected
  outcomes from canonical Activity data.
- It uses exact counts and links to the filtered Activity rows that support
  them. It never invents hours saved or “emails prevented.”
- Email delivery remains opt-in post-beta and is not part of this program.

### D246.6 — Deferred feature boundaries remain intact

This program does not add `gmail.send`, Followup Nudge/reminder sending, native
mobile, mobile push, automated mailto unsubscribe, message-level snooze, a full
searchable Help Center, or the unrestricted Autopilot rule builder. Each still
requires its recorded demand, privacy, OAuth, or compliance trigger.

## Implementation checklist

- [x] Reconcile D163/D171 user-facing behavior and stale Brief documentation.
- [x] Generate Briefs at the user's local 08:00 boundary with UTC fallback.
- [x] Add the privacy-bounded D246 analytics contract and taxonomy.
- [x] Persist the selected activation goal in the existing preferences bag.
- [x] Implement a finite first-relief session and calm completion state.
- [x] Add expected/surprising feedback for automatic Activity outcomes.
- [x] Remove streak/speculative-impact claims and make re-entry voluntary.
- [x] Add the Observe-first repeated-pattern suggestion and decision telemetry.
- [x] Add the factual in-app weekly review with Activity evidence links.
- [x] Add focused unit/integration/accessibility coverage for completed slices.
- [x] Run repository-wide validation and independent diff review.

## Commit and handoff protocol

Every commit completes one checklist slice, runs its narrow checks, ends with
`(D246)`, and is pushed immediately. Before handoff, update the checkpoint
below with the last commit, green checks, and exact next unchecked slice.

## Current checkpoint

- Last completed slice: two-account dev-environment smoke (2026-07-15,
  both connected Gmail accounts). The smoke reproduced two regressions,
  both fixed on this branch with red→green regression coverage:
  - `4ccf55e2` — postgres.js rejects a JS Date bound next to a raw `sql`
    expression (only column encoders map Dates). The skipped/protected
    weekly-review evidence links returned 500 and every support-bundle
    export truncated mid-stream (HTTP 200, corrupt zip). PGlite specs
    accept Dates, so the suites stayed green — a driver-parity spec now
    asserts no raw Date reaches the driver.
  - `df8af6aa` — the support-bundle CSV labelled skipped/protected Observe
    dismissals with execution fallbacks ("Moved to Later" / "Completed"),
    claiming an action that never ran. The CSV now mirrors the Activity
    screen wording ("Skipped" / "Protected").
    All other checklist sections passed: account-switch isolation, weekly
    review exact counts + fail-closed malformed filters, bundle privacy
    (masked default, opt-in technical JSON, no tokens/bodies), feedback
    truthfulness + mailbox scoping, pattern-suggestion mechanics (Observe
    accept, independent Not-now, per-account impressions — organic evidence
    did not exist, exercised via labelled reversible fixtures), goal-driven
    onboarding (≤5 real decisions, calm completion), entitlement fail-closed
    (Free/Plus 402 on nonempty preset picks, empty allowed, Pro permitted),
    persisted-timezone Brief authority with UTC fallback, recovery evidence
    (failed→recovered once, zero-message provenance, terminal failure time
    incl. export), and a Gmail archive→Undo round trip.
- Dev-environment repairs made during the smoke (local DB only): applied
  migrations 0036–0044 (backfilled 84 legacy terminal `later` rows with
  `wake_at = created_at + 3 days` before the 0036 CHECK, then
  `atlas migrate set 0036`), and added the D245 `protection_reason` enum
  values (`replied`, `starred`, `gmail_important`) that the in-place 0006
  edit introduced after this dev DB had already applied the old 0006 —
  this also cleared the failing auto-protect sweep / red sync banner.
- Base: `9bc6b739` (`origin/main`, merged PR #333).
- Last commit: `df8af6aa` (`fix(activity): export review rows truthfully
(D246)`).
- Next slice: founder review of the smoke report, then move draft PR #334
  to ready.
