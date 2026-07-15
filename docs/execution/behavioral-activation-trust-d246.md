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
- The first session contains at most ten real sender decisions and has a clear
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
- [ ] Add expected/surprising feedback for automatic Activity outcomes.
- [ ] Add the Observe-first repeated-pattern suggestion and decision telemetry.
- [ ] Add the factual in-app weekly review with Activity evidence links.
- [x] Add focused unit/integration/accessibility coverage for completed slices.
- [ ] Run repository-wide validation and independent diff review.

## Commit and handoff protocol

Every commit completes one checklist slice, runs its narrow checks, ends with
`(D246)`, and is pushed immediately. Before handoff, update the checkpoint
below with the last commit, green checks, and exact next unchecked slice.

## Current checkpoint

- Last completed slice: onboarding now pins at most five candidates in stable,
  goal-ranked order and presents them as a finite first-relief session. The
  session removes batching and daily chrome, permits an honest early stop,
  ends calmly, and attributes preview/confirmation/completion without sender
  identifiers.
- Last green checks: onboarding service tests (24); first-relief/Triage
  analytics tests (12); API/web typechecks; formatting and diff checks.
- Base: `9bc6b739` (`origin/main`, merged PR #333).
- Next slice: add first-party expected/surprising feedback to automatic
  outcomes in Activity, Brief, and Followups.
