# D245 product clarity program

This file is the durable implementation and handoff checkpoint for the
founder-approved P0–P3 product-clarity program. Update it in the same commit as
each completed slice.

## Canonical decisions

- Privacy: one typed cumulative Gmail-data inventory, including purpose and
  retention, drives every public and in-product explanation.
- Later: current Inbox mail moves to `DeclutrMail/Later`, a wake time is
  required, future mail is unchanged, and the visible destination is Later.
  Failed/missed returns notify in the app and can be retried on every plan;
  successful returns stay silent. A future success notification must use a
  durable event plus an explicit default-off preference.
- Senders: observed facts and consequences are primary; any suggestion is
  optional secondary disclosure.
- Safety: **Protected** is the sole visible safety state. Protected
  senders are excluded from bulk and automatic mail-changing actions. The
  overlapping VIP state is removed from the UI, contracts, and persistence.
  Strong observed signals may set protection automatically: at least three
  replies, a recent explicit star, or at least three recent Gmail-important
  messages. The exact reason is visible, read/open rate is excluded, and a
  manual Unprotect is a sticky override.
- Priority: Brief priority comes from observed engagement and Gmail importance.
  If manual priority is needed later, add a clearly named **Pin in Brief**
  control; never reuse Protected for ranking.
- Recovery: plan-based Activity Undo is distinct from Gmail Trash recovery;
  unsubscribe is irreversible after delivery.
- Disconnect: offer **Disconnect** and **Disconnect and delete data**, with an
  exact preview of retained and deleted datasets.

## Prelaunch reset rule

DeclutrMail is not live and has no production users or production data. Product
decisions in this program should therefore update the current schema, routes,
contracts, fixtures, and canonical docs directly. Do not retain obsolete
behavior as a compatibility or migration path unless it is required by a
current technical invariant rather than by hypothetical existing users.

## Delivery backlog

### P0 — consent, data safety, and action truth

- [x] Add the typed cumulative data-inventory registry and generate Privacy,
      Security, onboarding, Settings, and trust copy from it.
- [x] Disclose Anthropic's selected-field processing and standard API
      retention in the registry, Privacy policy, Settings, and product FAQ.
- [x] Generate an honest export manifest and export descriptions from the
      registry; identify the current downloads as subsets instead of full exports.
- [x] Add one typed K/A/U/L/D semantics contract for current scope,
      destination, future-mail behavior, scheduling, Activity Undo, Gmail recovery,
      finality, and result labels.
- [x] Migrate every preview, receipt, Activity row, mobile surface, and return
      state to generated action semantics instead of local consequence copy.
- [x] Make Later require a wake time end to end and rename the visible Snoozed
      destination to Later.
- [x] Use one shared action receipt/undo model across Senders, Triage, bulk
      actions, Activity, mobile surfaces, and return states.
- [x] Distinguish one-click, manual-in-Gmail, requested, delivered, failed, and
      irreversible unsubscribe states everywhere they appear.
- [x] Replace absolute reversibility and account-deletion claims that conflict
      with actual behavior.

### P1 — activation, control, and recurring value

- [x] Rework first-run consent into access → fetched → stored → action scope,
      followed by a concrete first useful sender decision.
- [x] Make every preview identify affected mail, future-mail behavior,
      unchanged data, reversal path, and exact confirm action.
- [x] Make Activity the canonical action record, with deadlines, status,
      failures, Gmail recovery guidance, and available Undo controls.
- [x] Apply conservative automatic protection from strong, explainable
      engagement signals, preserve the exact reason, and honor manual override.
- [x] Make Senders fact-first and put any optional suggestion plus its factual
      basis behind progressive disclosure.
- [x] Explain Autopilot Observe and Active at rule level; keep Active execution
      plan-gated and build custom-rule creation behind D234's gate.
- [x] Show a pre-activation consequence report with actionable senders and
      messages, Protected skips, observed or labelled-estimated weekly volume,
      the daily safety cap, and action-specific recovery truth.
- [x] Turn Brief into a useful return surface that says what changed and links
      each item to the relevant sender, preview, or Activity record.
- [x] Add explicit mailbox disconnect/data-deletion choices and lifecycle
      states for reconnecting, reauthorizing, and removing indexed data.
- [x] Let eligible users experience safe Observe/preview value before asking
      them to upgrade for automatic Active execution; keep billing truth sourced
      from the canonical entitlement contract.
- [x] Show Quiet's held Autopilot action count and exact release time, including
      indefinite and inactive states without implying that Quiet owns all
      pending work.

### P2 — precision, recovery, and scale

- [x] Move protocol names, raw headers, IDs, hashes, worker stages, and HTTP
      details behind a reusable **Show technical details** disclosure.
- [x] Show data freshness and partial-sync scope anywhere counts or suggested
      actions could otherwise look complete.
- [x] Improve bulk selection with explicit selected/matched/skipped counts,
      protected-sender reasons, and a trustworthy preview fallback.
- [x] Unify search, temporary filters, sorting, and saved views, including
      stable zero-result recovery and shareable/restorable state where safe.
- [x] Replace generic Close/Dismiss/icon-only accessible names with
      contextual labels; verify focus, announcements, and reduced-motion paths.
- [x] Standardize errors around what changed, what did not change, and the next
      recovery step, with support details disclosed separately.
- [x] Persist Later return attempts/failures, distinguish returning, retrying,
      and missed states after a two-sweep grace, and provide an all-tier app
      alert plus immediate retry without noisy success notifications.
- [x] Make demo/sample states unmistakable and prevent sample counts or actions
      from being confused with connected Gmail data.
- [x] Clarify Followups as observed sent-mail state, with precise timing,
      completion, dismissal, and false-positive controls.
- [x] Reconcile pricing, plan names, limits, trial/upgrade prompts, and feature
      availability against one entitlement source of truth.

### P3 — learnability and polish

- [x] Gate representative authenticated routes in CI at desktop and 375×812,
      with reduced motion, serious/critical Axe checks, control names,
      overflow, and keyboard-dialog focus behavior.

- [x] Add a compact in-product glossary for Sender, Gmail Preview, Protected,
      Observe, Active, Activity Undo, Gmail Trash recovery, and Later.
- [x] Add contextual help at the privacy, action, Activity, Autopilot, and
      mailbox-management decision points instead of a generic help dump.
- [x] Complete terminology, empty/loading/success text, contextual labels, and
      mobile microcopy cleanup left after the shared-system migrations.

## Commit and handoff protocol

Branch: `feat/d245-product-clarity`

Each commit must:

1. Complete one coherent vertical slice.
2. Update the relevant checkbox(es) here only when the slice is truly complete.
3. Add or update tests for changed behavior and copy contracts.
4. Run the narrowest relevant checks before commit, then push immediately.
5. End the commit subject with `(D245)` (or include another applicable D-number).

Before handoff, record the latest green checks and the exact next unchecked
slice below. A new agent should start with this file, D245 in the implementation
plan, and `git log --oneline origin/feat/d245-product-clarity..HEAD`.

## Current checkpoint

- Last completed slice: Activity is an outcome-aware recovery center for failed
  Archive, Later, and Delete actions. It verifies current Gmail label state,
  previews partial/already-applied/missing outcomes, and creates a new linked
  attempt only after confirmation. Reconnect is actionable; unsubscribe never
  exposes a generic retry.
- Idempotency: exact confirmation fingerprints, database lineage constraints,
  stable BullMQ job ids with enqueue-ack recovery, and convergent Gmail label
  mutations prevent duplicate work and preserve the failed audit row. Recovery
  attempts count once against the original cleanup intent.
- Last green checks: all-workspace typecheck; DB recovery + migration round-trip
  tests (8); worker verifier/queue tests (11); API recovery tests (9), Activity,
  Gmail-minimal-read, and entitlement tests (92); web Activity/API tests (47).
- Last pushed checkpoint before this slice: `dc2b1c9e` on
  `feat/d245-product-clarity`. This recovery slice is the next commit/push.
- Next proposed opportunity: exportable, human-readable Activity support bundles
  with technical identifiers disclosed only on request.
