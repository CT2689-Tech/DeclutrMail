### 2026-09-24 — Confirm Anthropic credits are topped up, and turn on auto-reload

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-24.
**Why:** Credits ran out on 2026-09-24, so AI explanations and the Brief fell back to templates. Since then the worker stops calling and logs `llm.provider_rejected` on a refusal (#779), and a returning sign-in no longer re-scans a synced mailbox (#775). Nothing in the repo records that credits were bought.
**How:**
1. Check in the Anthropic console → Plans & Billing that the credit balance is above zero.
2. If it is not, buy credits. Consider auto-reload so it cannot reach zero again.
3. Cloud Logging, worker service: search `llm.provider_rejected` over the last 7 days.
**Verifies by:** no `llm.provider_rejected` lines after the top-up.
**Who:** Founder
**Status:** Open
