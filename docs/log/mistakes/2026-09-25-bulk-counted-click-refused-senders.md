## 2026-09-25 — Bulk surfaces treated senders refused at the click as part of the batch

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** tests written for the execution-time skip (defects on the same surfaces, found while there)
**What happened:** A bulk enqueue answers with `skipped` (Protected or gone at the click). Senders settled every selected row with the batch outcome, so a Protected row whose mail was untouched read "Archived", and showed "Archiving…" / locked while the rest ran. Triage ignored `skipped` entirely: no word that a member was left out, and a parked batch held the refused row busy. Brief left refused senders checked, inviting the same refusal again. `NO_ACTIONABLE_SENDERS` (every sender refused) was a generic failure plus a Sentry event in Triage and Brief, and three surfaces worded it three ways.
**Correct approach:** A batch handle carries only the senders the server accepted. Click-time refusals get one toast in the pill's words (`skippedAtClickCopy`); execution-time skips come from the batch status and are said by the pill. `NO_ACTIONABLE_SENDERS` is a designed state with one shared sentence and no crash report.
**Rule:** Every surface that holds a bulk handle builds its member list from the enqueue RESPONSE, never from the selection it sent.
**Enforcement update:** Senders, Triage and Brief tests for click-time refusal, execution-time skip and `NO_ACTIONABLE_SENDERS`, negative-controlled; none to hooks.
