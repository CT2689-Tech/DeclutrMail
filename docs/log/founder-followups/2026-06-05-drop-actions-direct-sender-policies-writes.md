### 2026-06-05 — Remove the Actions module's direct writes to sender_policies

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-05.
**Why:** `sender_policies` belongs to the Senders module (D204). The outbox event and its Senders-owned consumer exist, but `ActionsService` still writes the table directly in three places, kept as a "one release" backstop since June (`apps/api/src/actions/actions.service.ts`).
**How:**
1. Verify first, in production logs, that `outbox.dispatch.event_dispatched` appears for `actions.unsubscribe_intent_recorded` and the policy row lands within seconds.
2. The bulk path notes the unsubscribe worker later UPDATEs that row. Make sure the row exists before the worker runs once the direct insert is gone, or the sender's status never moves.
3. Remove the three direct upserts and their ADR-0008 exception notes; keep the outbox publish.
4. Add a Postgres-backed test: intent → event → consumer → row → worker update.
**Verifies by:** `grep -n "insert(senderPolicies)" apps/api/src/actions/actions.service.ts` finds nothing, and the new test passes.
**Who:** Engineering (an agent can do it)
**Status:** Open
