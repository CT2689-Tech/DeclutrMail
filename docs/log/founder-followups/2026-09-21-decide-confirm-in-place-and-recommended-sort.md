### 2026-09-21 — Decide confirm-in-place and the unused "recommended" sort

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-21.
**Why:** Two of the six redesign questions are still open. Confirm in place (confirming in the row instead of the modal) changes the D226 preview surface, so it was not built. `SenderListSort` still names `'recommended'` (`apps/api/src/senders/senders.types.ts:469`), but the API rejects it (`SUPPORTED_SORTS`, `apps/api/src/senders/senders.controller.ts:90`). The other four are settled: the size sort shipped, Sender Detail shortcuts are bound, "sync" is a banned UI word, and Senders and Triage may suggest different verbs by design (D245).
**How:**
1. Confirm in place: answer yes or no. Verify first: Triage already confirms in the row when the sheet is skipped (`apps/web/src/features/triage/triage-screen.tsx:1449`); the question is whether Senders gets the same. If yes, an agent builds it and smokes it on a test mailbox, not a real one.
2. Recommended sort: answer "build it" or "delete it". Deleting unused prelaunch code is the D245 default.
**Verifies by:** both answers recorded on this entry, and one PR that builds or removes each.
**Who:** Founder
**Status:** Open
