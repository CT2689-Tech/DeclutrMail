### 2026-06-05 — Use the branded id types at API and worker boundaries

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-05.
**Why:** `packages/shared/src/ids/branded.ts` already defines `ActionId`, `UndoToken`, `SenderId`, `MailboxId` and `SenderKey`, but the action and activity code still passes plain strings. Swapping an undo token for an action id is a runtime 404, not a compile error.
**How:**
1. Type the web fetchers in `apps/web/src/lib/api/actions.ts` and `activity.ts` with the brands, casting once where the response is parsed.
2. Do the same for worker job outputs that carry these ids.
3. Add a type test where `getActionStatus(undoToken)` must fail to compile.
**Verifies by:** That type test fails to compile when the arguments are swapped, and `pnpm typecheck` passes.
**Who:** Engineering (an agent can do it)
**Status:** Open
