## 2026-10-24 — Validate navigation state before clearing a loading review

**PR:** Follow-up to [the Senders walkthrough](https://github.com/CT2689-Tech/DeclutrMail/pull/1112);
these behaviors predate that change.
**Caught by:** Read-only signed-in production walkthrough.
**What happened:** Exiting during the native-detail return's sender read deleted
the saved selection before restoration. Waiting for loading hid the defect.
Suggested Guided Review also emphasized Archive when current Inbox count was zero.
**Correct approach:** Restore validated selection IDs before ending an unloaded
review, preserving identity/scope/expiry guards and loaded action-owner clears.
Remove an inapplicable Archive suggestion while keeping the existing action and
fresh preview.
**Rule:** Exercise cancellation while a read remains pending; check recommendations
against current counts independently of action availability.
**Enforcement update:** Regression tests for early exit, validation boundaries,
intentional clears and zero/unknown/current-versus-historical count presentation.
