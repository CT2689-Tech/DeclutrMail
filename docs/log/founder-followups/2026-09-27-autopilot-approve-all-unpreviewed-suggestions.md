### 2026-09-27 — Decide how "Approve all" stays within what its preview showed
**Source:** PR #802. Defect-class sweep of the Autopilot pending count, verified in code.
**Why:** "Approve all" sends only the rule id
(`POST /api/autopilot/rules/:id/approve-all`), and the server approves
every suggestion it can act on at click time. A suggestion that arrives
after the screen loaded is approved without ever appearing in the preview;
the Watch-first sweep runs within minutes of new mail. For an Unsubscribe
rule, that is an irreversible request to a sender the user never saw (D226:
the preview must describe what the change does).
**How:** Reply with (a) or (b).
- (a) *Recommended:* the preview sends the set it showed, and the server
  approves only that set. Below the 50-row cap it sends the ids; at the cap
  it sends a "matched before" cutoff.
- (b) Keep the current behavior and add "including any that arrive before
  you confirm" to the preview.
**Verifies by:** A test that a suggestion added between the preview and the
confirm click stays pending.
**Status:** Done 2026-09-29
