# D245 product clarity program

This file is the durable implementation and handoff checkpoint for the
founder-approved P0–P3 product-clarity program. Update it in the same commit as
each completed slice.

## Canonical decisions

- Privacy: one typed cumulative Gmail-data inventory, including purpose and
  retention, drives every public and in-product explanation.
- Later: current Inbox mail moves to `DeclutrMail/Later`, a wake time is
  required, future mail is unchanged, and the Snoozed page becomes Later.
- Senders: observed facts and consequences are primary; any suggestion is
  optional secondary disclosure.
- Recovery: plan-based Activity Undo is distinct from Gmail Trash recovery;
  unsubscribe is irreversible after delivery.
- Disconnect: offer **Disconnect** and **Disconnect and delete data**, with an
  exact preview of retained and deleted datasets.

## Delivery backlog

### P0 — consent, data safety, and action truth

- [ ] Add the typed cumulative data-inventory registry and generate Privacy,
      Security, onboarding, Settings, and export descriptions from it.
- [ ] Centralize action scope, consequence, future-mail behavior, and recovery
      copy for Keep, Archive, Unsubscribe, Later, and Delete.
- [ ] Make Later require a wake time end to end; rename the visible Snoozed
      destination to Later and retain route compatibility.
- [ ] Use one shared action receipt/undo model across Senders, Triage, bulk
      actions, Activity, mobile surfaces, and return states.
- [ ] Distinguish one-click, manual-in-Gmail, requested, delivered, failed, and
      irreversible unsubscribe states everywhere they appear.
- [ ] Replace absolute reversibility and account-deletion claims that conflict
      with actual behavior.

### P1 — activation, control, and recurring value

- [ ] Rework first-run consent into access → fetched → stored → action scope,
      followed by a concrete first useful sender decision.
- [ ] Make every preview identify affected mail, future-mail behavior,
      unchanged data, reversal path, and exact confirm action.
- [ ] Make Activity the canonical action record, with deadlines, status,
      failures, Gmail recovery guidance, and available Undo controls.
- [ ] Make Senders fact-first and put any optional suggestion plus its factual
      basis behind progressive disclosure.
- [ ] Explain Autopilot Observe and Active at rule level; keep Active execution
      plan-gated and build custom-rule creation behind D234's gate.
- [ ] Turn Brief into a useful return surface that says what changed and links
      each item to the relevant sender, preview, or Activity record.
- [ ] Add explicit mailbox disconnect/data-deletion choices and lifecycle
      states for reconnecting, reauthorizing, and removing indexed data.
- [ ] Let eligible users experience safe Observe/preview value before asking
      them to upgrade for automatic Active execution; keep billing truth sourced
      from the canonical entitlement contract.

### P2 — precision, recovery, and scale

- [ ] Move protocol names, raw headers, IDs, hashes, worker stages, and HTTP
      details behind a reusable **Show technical details** disclosure.
- [ ] Show data freshness and partial-sync scope anywhere counts or suggested
      actions could otherwise look complete.
- [ ] Improve bulk selection with explicit selected/matched/skipped counts,
      protected-sender reasons, and a trustworthy preview fallback.
- [ ] Unify search, temporary filters, sorting, and saved views, including
      stable zero-result recovery and shareable/restorable state where safe.
- [ ] Replace generic Close/Dismiss/icon-only accessible names with
      contextual labels; verify focus, announcements, and reduced-motion paths.
- [ ] Standardize errors around what changed, what did not change, and the next
      recovery step, with support details disclosed separately.
- [ ] Make demo/sample states unmistakable and prevent sample counts or actions
      from being confused with connected Gmail data.
- [ ] Clarify Followups as observed sent-mail state, with precise timing,
      completion, dismissal, and false-positive controls.
- [ ] Reconcile pricing, plan names, limits, trial/upgrade prompts, and feature
      availability against one entitlement source of truth.

### P3 — learnability and polish

- [ ] Add a compact in-product glossary for Sender, Gmail Preview, Protected,
      VIP, Observe, Active, Activity Undo, Gmail Trash recovery, and Later.
- [ ] Add contextual help at the privacy, action, Activity, Autopilot, and
      mailbox-management decision points instead of a generic help dump.
- [ ] Complete terminology, empty/loading/success text, contextual labels, and
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

- Last completed slice: audit-preserving high-confidence copy corrections
  committed before D245 was accepted.
- Last green checks: web tests (97 files / 918 tests), repository typecheck,
  targeted API entitlement tests, and formatting. Lint had no errors and 15
  pre-existing warnings.
- Next slice: inventory the cumulative persisted Gmail-data contract and add
  the typed shared registry with contract tests.
