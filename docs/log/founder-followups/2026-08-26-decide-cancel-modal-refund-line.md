### 2026-08-26 — Decide whether the cancel screen mentions the refund window

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-26.
**Why:** On 2026-07-31 you chose not to mention refunds on the cancel screen, so it does not invite a refund request at the moment people leave. A later question asked you to add a refund link without saying it would reverse that choice. Since then the refund policy changed to 14 days, once per customer (`POLICY` in `pricing.config.ts`), which may change the answer.
**How:**
1. Reply with one answer: "add it" (a line shown only inside the 14-day window, linking to the support address already on `/refunds`) or "keep 2026-07-31".
2. An agent then edits `cancel-modal.tsx` and its docstring, or closes this entry as re-affirmed.
**Verifies by:** The modal shows the in-window refund line and the docstring records the reversal, or this entry closes as re-affirmed.
**Who:** Founder
**Status:** Open
