### 2026-08-28 — Decide how QA can press Unsubscribe safely

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-28.
**Why:** Unsubscribe is the only verb with no undo (D58), and it is the one surface QA never drives: `.claude/commands/ct-qa.md` bans pressing `U`. `UNSUB_SEND_ENABLED` is a sound off switch, but every gate built on it predicted a refusal instead of making a real send impossible. The worker's `UNSUB_ALLOW_INSECURE_TARGETS` only opens localhost; it is not an allowlist.
**How:** pick one.
1. A (recommended): build a dev-only target allowlist in `UnsubExecutionWorker`. Outside production it refuses any host not on a local list, so a stray flag cannot reach a real sender. Then lift the `U` ban in `ct-qa.md`.
2. B: leave `U` unpressed. Costs nothing now; the coverage gap stays permanent.
Not urgent: nothing ships broken while it waits.
**Verifies by:** with A built, a dev `U` press against a real sender logs a refusal naming the blocked host and makes no outbound request.
**Who:** Founder
**Status:** Open
