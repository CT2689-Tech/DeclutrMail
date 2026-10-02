## 2026-10-02 — Verify browser mailbox before testing
**PR:** Cleanup flow audit, branch `codex/flow-audit-cleanup` (D226 follow-up).
**Caught by:** User report.
**What happened:** QA continued in an older authenticated browser session after the user connected another account in Incognito. Similar routes and returning-user history were mistaken for identity evidence. The only mutation in the older account, a reversible Archive, was undone; UI counts returned and Activity showed Undone. Provider restoration was not independently checked. Testing then switched to the visibly verified intended account.
**Correct approach:** Verify account identity in the current browser and action preview before every live mutation; keep account/environment evidence separate.
**Rule:** Never infer account identity from URL, plan, window order or previous observations.
**Enforcement update:** The reusable flow-audit runbook requires identity checks; cleanup previews show the Gmail account outside collapsed Details.
